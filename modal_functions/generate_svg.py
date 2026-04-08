"""
Modal function: generate_svg

Calls the Anthropic Claude API to generate (or revise) a single physics SVG
for the GIST library. Logs the call to the `generation_sessions` table in
Supabase, including token counts and cost.

ARCHITECTURE
------------
This function is invoked from the Vercel `api/generate.ts` proxy (Task 6).
The proxy validates the user's Supabase JWT and forwards the request along
with the user's `auth.users.id` as `requested_by`.

For Task 3, the proxy doesn't exist yet. Test directly with `modal run`:

    modal run modal_functions/generate_svg.py \\
        --object-name wooden_block \\
        --requested-by 00000000-0000-0000-0000-000000000000

SECRETS
-------
Two Modal secrets are required. Create them once with the Modal CLI:

    modal secret create anthropic-secret \\
        ANTHROPIC_API_KEY=sk-ant-...

    modal secret create supabase-gist-credentials \\
        SUPABASE_DATA_URL=https://xxxxx.supabase.co \\
        SUPABASE_SERVICE_ROLE_KEY=eyJ...

DEPLOY
------
    modal deploy modal_functions/generate_svg.py

PROMPT TEMPLATE
---------------
The system prompt is duplicated here from src/lib/constants.js
(`buildSystemPrompt`). The two languages don't share runtime, so when you
edit one keep the other in sync. The prompt rarely changes; if it starts
changing often, move it to a shared .txt file or a Supabase config table.
"""

import json
import os
from typing import Optional

import modal

app = modal.App("gist-generate-svg")

# Pricing for claude-sonnet-4-20250514 (USD per million tokens).
# Update if Anthropic changes their pricing.
INPUT_PRICE_PER_MTOK = 3.00
OUTPUT_PRICE_PER_MTOK = 15.00

CLAUDE_MODEL = "claude-sonnet-4-20250514"

# The container image: Python with the two HTTP clients we need.
image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "anthropic==0.39.0",
    "supabase==2.9.1",
)


def build_system_prompt(library_names: list[str]) -> str:
    """Mirror of src/lib/constants.js `buildSystemPrompt`. Keep in sync."""
    return (
        "You generate SVG icons for the GIST project (LLM \u2192 JSON \u2192 Planck.js). Rules:\n"
        "- 64x64 viewBox, simple silhouettes, Tailwind-inspired fills\n"
        "- No external deps, inline styles only\n"
        "- Monochromatic 3-tone (light/mid/dark from same hue)\n"
        "- People: modeled after traffic sign pictograms, no faces or details\n"
        "- Categories: vehicles, projectiles, blocks, people, connectors, "
        "planes, pendulums, everyday, lab, space, air resistance\n\n"
        f"Library ({len(library_names)}): {', '.join(library_names)}"
    )


def build_user_prompt(
    object_name: str,
    feedback_history: Optional[list[str]],
    color_palette: Optional[dict],
    current_svg: Optional[str],
) -> str:
    """Build the user prompt for either a fresh generate or a revision."""
    parts = []
    if current_svg:
        parts.append(f'Revise the "{object_name}" SVG.')
    else:
        parts.append(f'Generate a new SVG for "{object_name}".')

    if feedback_history:
        joined = "; ".join(feedback_history)
        parts.append(f"Feedback so far: {joined}")

    if color_palette:
        parts.append(
            f"Use the {color_palette['name']} 3-tone palette "
            f"({color_palette['light']}/{color_palette['mid']}/{color_palette['dark']})."
        )

    if current_svg:
        parts.append(f"Current SVG:\n{current_svg}")

    parts.append("Return only the SVG markup, no commentary.")
    return "\n\n".join(parts)


def extract_svg_from_response(text: str) -> str:
    """
    Pull the SVG out of Claude's response. Claude usually returns just the
    markup, but if it wraps the SVG in a code fence we strip it.
    """
    text = text.strip()
    if text.startswith("```"):
        # Strip the opening fence (with optional language tag) and closing fence.
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("anthropic-api"),
        modal.Secret.from_name("supabase_for_svg_gen"),
    ],
    timeout=120,
)
def generate_svg(
    object_name: str,
    requested_by: str,
    svg_id: Optional[str] = None,
    feedback_history: Optional[list[str]] = None,
    color_palette: Optional[dict] = None,
    current_svg: Optional[str] = None,
) -> dict:
    """
    Generate or revise a physics SVG via Claude.

    Args:
        object_name: snake_case identifier (e.g. "wooden_block").
        requested_by: auth.users.id of the user who initiated this call.
                      Used as `requested_by` on the generation_sessions row.
        svg_id: physics_svgs.id (UUID) if revising an existing SVG, else None.
        feedback_history: list of feedback strings collected so far.
        color_palette: optional dict with keys {name, light, mid, dark}.
        current_svg: existing SVG markup (for revision), else None.

    Returns:
        {
          "svg": "<svg>...</svg>",
          "session_id": "uuid",
          "input_tokens": int,
          "output_tokens": int,
          "cost_usd": float,
        }
    """
    from anthropic import Anthropic
    from supabase import create_client

    anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    supabase_client = create_client(
        os.environ["SUPABASE_DATA_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # 1. Build prompts. Pull the current library names from Supabase so the
    #    system prompt's "Library (N): ..." section is always accurate.
    library_result = (
        supabase_client.from_("physics_svgs").select("name").execute()
    )
    library_names = sorted(row["name"] for row in (library_result.data or []))
    system_prompt = build_system_prompt(library_names)
    user_prompt = build_user_prompt(
        object_name, feedback_history, color_palette, current_svg
    )

    # 2. Open a generation_sessions row in 'pending' state. We do this BEFORE
    #    the Claude call so that even on failure we have an audit row.
    session_insert = (
        supabase_client.from_("generation_sessions")
        .insert(
            {
                "svg_id": svg_id,
                "requested_by": requested_by,
                "model": CLAUDE_MODEL,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "status": "pending",
            }
        )
        .execute()
    )
    session_id = session_insert.data[0]["id"]

    try:
        # 3. Call Claude. We use the non-streaming API for Task 3 since we
        #    only need the final SVG. Streaming gets added when the Vercel
        #    proxy lands and the UI wants progressive rendering.
        message = anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )

        response_text = "".join(
            block.text for block in message.content if block.type == "text"
        )
        svg_markup = extract_svg_from_response(response_text)

        input_tokens = message.usage.input_tokens
        output_tokens = message.usage.output_tokens
        cost_usd = (
            input_tokens * INPUT_PRICE_PER_MTOK / 1_000_000
            + output_tokens * OUTPUT_PRICE_PER_MTOK / 1_000_000
        )

        # 4. Mark the session row 'completed' with the response and cost.
        supabase_client.from_("generation_sessions").update(
            {
                "response_svg": svg_markup,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost_usd, 6),
                "status": "completed",
                "completed_at": "now()",
            }
        ).eq("id", session_id).execute()

        return {
            "svg": svg_markup,
            "session_id": session_id,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost_usd, 6),
        }

    except Exception as exc:
        # 5. On any failure, mark the session 'failed' with the error string
        #    and re-raise so the caller (and Modal logs) see the failure.
        supabase_client.from_("generation_sessions").update(
            {
                "status": "failed",
                "error_message": str(exc)[:1000],
                "completed_at": "now()",
            }
        ).eq("id", session_id).execute()
        raise


@app.local_entrypoint()
def main(
    object_name: str,
    requested_by: str,
    feedback: str = "",
):
    """
    Local entry point for `modal run modal_functions/generate_svg.py ...`.

    Example:
        modal run modal_functions/generate_svg.py \\
            --object-name wooden_block \\
            --requested-by 00000000-0000-0000-0000-000000000000

    Optional:
        --feedback "Make it bigger and use more contrast"
    """
    feedback_list = [feedback] if feedback else None
    result = generate_svg.remote(
        object_name=object_name,
        requested_by=requested_by,
        feedback_history=feedback_list,
    )
    print(json.dumps({k: v for k, v in result.items() if k != "svg"}, indent=2))
    print("\n--- SVG ---")
    print(result["svg"])
