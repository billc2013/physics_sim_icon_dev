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
The system prompt lives in shared/system_prompt.json at the repo root.
That single file is consumed by both this module (for actual Claude calls)
and src/lib/constants.js (for the SystemPrompt overlay in the web app).

The JSON is baked into the Modal image via `add_local_file` below, so any
edit to the JSON requires `modal deploy modal_functions/generate_svg.py`
to push the new content to Modal. The Vite side picks up edits on the
next dev reload / build automatically.
"""

import json
import os
from pathlib import Path
from typing import Optional

import modal
from pydantic import BaseModel

# Resolve the shared system-prompt JSON relative to this file so that
# `modal deploy` works from any working directory. This is evaluated at
# parse time on the deploy machine; `add_local_file` below then bakes the
# file into the container image at /root/system_prompt.json.
SYSTEM_PROMPT_LOCAL_PATH = (
    Path(__file__).resolve().parent.parent / "shared" / "system_prompt.json"
)
SYSTEM_PROMPT_REMOTE_PATH = "/root/system_prompt.json"

app = modal.App("gist-generate-svg")

# Two-tier model selection. The frontend sends a `model_tier` string and the
# backend maps it to the actual Anthropic model ID plus per-MTok pricing.
# Prices are USD per million tokens — update if Anthropic changes them. The
# `cost_usd` column in generation_sessions uses these for an audit estimate,
# not for billing, so mild pricing drift is tolerable.
MODEL_TIERS = {
    "standard": {
        "model": "claude-sonnet-4-6",
        "input_price_per_mtok": 3.00,
        "output_price_per_mtok": 15.00,
    },
    "advanced": {
        "model": "claude-opus-4-8",
        "input_price_per_mtok": 5.00,
        "output_price_per_mtok": 25.00,
    },
}
DEFAULT_MODEL_TIER = "standard"

# The container image: Python with the two HTTP clients we need.
# fastapi/pydantic come with Modal but we pin them here so the local parse
# of this file (during `modal deploy`) can also see pydantic.
# The shared system-prompt JSON is baked into the image via add_local_file
# so the function can read it at /root/system_prompt.json inside the sandbox.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "anthropic==0.91.0",  # bumped from 0.39.0: supports current models; works with httpx 0.28 (no proxies= bug)
        "supabase==2.28.3",  # >=2.28 accepts the new sb_secret_ key format (2.9.1's regex rejected non-JWT keys). Prereq for the key migration; Modal secret still holds the legacy service_role JWT — swap pending, see Dev_Tasks.md task 11.
        "fastapi==0.115.0",
        "pydantic==2.11.7",  # bumped from 2.9.2: supabase 2.28.3 -> realtime requires pydantic>=2.11.7
    )
    .add_local_file(
        local_path=str(SYSTEM_PROMPT_LOCAL_PATH),
        remote_path=SYSTEM_PROMPT_REMOTE_PATH,
    )
)


class GenerateRequest(BaseModel):
    """Request body shape for the HTTP endpoint. Mirrors generate_svg's args."""

    object_name: str
    requested_by: str
    svg_id: Optional[str] = None
    feedback_history: Optional[list[str]] = None
    color_palette: Optional[dict] = None
    current_svg: Optional[str] = None
    model_tier: Optional[str] = DEFAULT_MODEL_TIER


class BatchGenerateRequest(BaseModel):
    """Request body for the batch HTTP endpoint. Two modes:

    category: Generate `count` new SVGs for a given category. Claude picks
              the names. Returns [{name, svg, collider}].

    color_variants: Generate an existing object in multiple color palettes.
                    Returns [{color, svg}].
    """

    mode: str  # "category" or "color_variants"
    requested_by: str
    model_tier: Optional[str] = DEFAULT_MODEL_TIER
    # Category mode
    category: Optional[str] = None
    count: int = 10
    # Optional style references — list of {name, svg} objects included
    # verbatim in the user prompt so Claude matches the visual style.
    reference_svgs: Optional[list[dict]] = None
    # Color variant mode
    object_name: Optional[str] = None
    svg_id: Optional[str] = None
    current_svg: Optional[str] = None
    feedback_history: Optional[list[str]] = None
    color_palettes: Optional[list[dict]] = None  # [{name, light, mid, dark}]


def build_system_prompt(library_names: list[str]) -> str:
    """
    Render the system prompt from shared/system_prompt.json.

    The JSON is baked into the Modal image at SYSTEM_PROMPT_REMOTE_PATH, so
    edits to the file require `modal deploy` to take effect on the Python
    side. The JS side (src/lib/constants.js `buildSystemPrompt`) reads the
    same file and must render identically — keep the two renderers in sync.
    """
    with open(SYSTEM_PROMPT_REMOTE_PATH) as f:
        config = json.load(f)
    rules = "\n".join(f"- {rule}" for rule in config["rules"])
    collider_rules = "\n".join(
        f"- {rule}" for rule in config.get("colliderRules", [])
    )
    categories = f"- Categories: {', '.join(config['categories'])}"
    library = (
        config["librarySection"]
        .replace("{count}", str(len(library_names)))
        .replace("{names}", ", ".join(library_names))
    )
    prompt = f"{config['header']}\n{rules}\n{categories}"
    if collider_rules:
        prompt += f"\n\nCollider rules:\n{collider_rules}"
    prompt += f"\n\n{library}"
    return prompt


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

    parts.append(
        'Return ONLY a JSON object with two keys: '
        '"svg" (the SVG markup string) and "collider" (the physics collider object). '
        "No commentary, no code fences."
    )
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


def extract_svg_and_collider(text: str) -> dict:
    """
    Extract both SVG markup and collider from Claude's JSON response.

    Expected format: {"svg": "<svg>...</svg>", "collider": {...}}

    Falls back gracefully:
    - If JSON parse works → returns {"svg": ..., "collider": ...}
    - If JSON parse fails but SVG is present → returns {"svg": ..., "collider": None}
      (Claude may have returned raw SVG instead of JSON)
    """
    text = text.strip()

    # Strip code fences if present.
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    # Try direct JSON parse.
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and "svg" in parsed:
            return {
                "svg": parsed["svg"],
                "collider": parsed.get("collider"),
            }
    except json.JSONDecodeError:
        pass

    # Try to find a JSON object in the text (Claude may have added commentary).
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        try:
            parsed = json.loads(text[first_brace : last_brace + 1])
            if isinstance(parsed, dict) and "svg" in parsed:
                return {
                    "svg": parsed["svg"],
                    "collider": parsed.get("collider"),
                }
        except json.JSONDecodeError:
            pass

    # Fallback: treat the whole response as raw SVG (no collider).
    return {
        "svg": extract_svg_from_response(text),
        "collider": None,
    }


def build_batch_user_prompt_category(
    category: str,
    count: int,
    reference_svgs: Optional[list[dict]] = None,
) -> str:
    """Build the user prompt for the category batch mode.

    If reference_svgs is provided, their full SVG markup is inlined so
    Claude can match the visual style. Each ref is {"name": ..., "svg": ...}.
    """
    parts = [
        f'Generate {count} new physics SVG icons for the "{category}" category.'
    ]

    if reference_svgs:
        parts.append(
            f"Match the visual style of these {len(reference_svgs)} reference "
            f"object{'s' if len(reference_svgs) != 1 else ''}:"
        )
        for ref in reference_svgs:
            name = ref.get("name", "unnamed")
            svg = ref.get("svg", "")
            parts.append(f"- {name}:\n{svg}")

    parts.append(
        "For each new item, pick a unique snake_case name that doesn't "
        "already exist in the library listed in the system prompt."
    )
    parts.append(
        'Return ONLY a JSON array where each element is '
        '{"name": "snake_case_name", "svg": "<svg>...</svg>", '
        '"collider": {collider object per the collider rules}}. '
        "No commentary, no code fences."
    )
    return "\n\n".join(parts)


def build_batch_user_prompt_colors(
    object_name: str,
    color_palettes: list[dict],
    current_svg: Optional[str],
    feedback_history: Optional[list[str]],
) -> str:
    """Build the user prompt for the color-variant batch mode."""
    parts = [f'Generate the "{object_name}" SVG in each of these color palettes:']
    for pal in color_palettes:
        parts.append(
            f"- {pal['name']}: light={pal['light']}, mid={pal['mid']}, dark={pal['dark']}"
        )
    if feedback_history:
        parts.append(f"\nFeedback so far: {'; '.join(feedback_history)}")
    if current_svg:
        parts.append(f"\nCurrent SVG:\n{current_svg}")
    parts.append(
        '\nReturn ONLY a JSON array where each element is '
        '{"color": "palette_name", "svg": "<svg>...</svg>"}. '
        "No commentary, no code fences."
    )
    return "\n".join(parts)


def extract_json_from_response(text: str) -> list[dict]:
    """Pull a JSON array out of Claude's response.

    Claude usually returns just the JSON, but may wrap it in code fences
    or add commentary before/after. We try several strategies:
    1. Direct parse
    2. Strip code fences then parse
    3. Find the first '[' and last ']' and parse that substring
    """
    text = text.strip()

    # 1. Direct parse
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass

    # 2. Strip code fences
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        fenced = "\n".join(lines).strip()
        try:
            result = json.loads(fenced)
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    # 3. Bracket extraction
    first_bracket = text.find("[")
    last_bracket = text.rfind("]")
    if first_bracket != -1 and last_bracket > first_bracket:
        try:
            result = json.loads(text[first_bracket : last_bracket + 1])
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    raise ValueError(
        f"Could not extract JSON array from Claude's response. "
        f"First 200 chars: {text[:200]}"
    )


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
    model_tier: Optional[str] = DEFAULT_MODEL_TIER,
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
        model_tier: "standard" (Sonnet 4.6, default) or "advanced" (Opus 4.8).
                    Controls which Anthropic model handles the generation.

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

    # Resolve the model tier. Reject unknown values with a clear error so a
    # typo in the client doesn't silently fall back to the default.
    tier_key = model_tier or DEFAULT_MODEL_TIER
    if tier_key not in MODEL_TIERS:
        raise ValueError(
            f"Unknown model_tier '{tier_key}'. "
            f"Expected one of: {sorted(MODEL_TIERS.keys())}"
        )
    tier = MODEL_TIERS[tier_key]
    model_id = tier["model"]
    input_price_per_mtok = tier["input_price_per_mtok"]
    output_price_per_mtok = tier["output_price_per_mtok"]

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
    #    the Claude call so that even on failure we have an audit row. The
    #    `model` column records the tier-resolved model id, so you can look
    #    back at the DB later to see which tier produced a given SVG.
    session_insert = (
        supabase_client.from_("generation_sessions")
        .insert(
            {
                "svg_id": svg_id,
                "requested_by": requested_by,
                "model": model_id,
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
            model=model_id,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )

        response_text = "".join(
            block.text for block in message.content if block.type == "text"
        )
        extracted = extract_svg_and_collider(response_text)
        svg_markup = extracted["svg"]
        collider = extracted["collider"]

        input_tokens = message.usage.input_tokens
        output_tokens = message.usage.output_tokens
        cost_usd = (
            input_tokens * input_price_per_mtok / 1_000_000
            + output_tokens * output_price_per_mtok / 1_000_000
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
            "collider": collider,
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


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("anthropic-api"),
        modal.Secret.from_name("supabase_for_svg_gen"),
    ],
    timeout=120,
)
@modal.fastapi_endpoint(method="POST")
def generate_svg_http(payload: GenerateRequest) -> dict:
    """
    HTTPS POST endpoint version of generate_svg. Called by the Vercel proxy
    `api/generate.ts`. The Vercel function validates the user's Supabase JWT
    and sets `requested_by` from the authenticated user_id before forwarding,
    so the browser cannot impersonate another user.

    Body: GenerateRequest (see Pydantic model above).

    Auth: NONE at the Modal layer for v1. The endpoint URL lives only in
    Vercel env vars; the browser never sees it. If we ever need stronger
    isolation we can add `requires_proxy_auth=True` and rotate Modal API
    tokens through Vercel.

    Deploy:
        modal deploy modal_functions/generate_svg.py
    Modal will print the new endpoint URL on stdout. Copy it into Vercel as
    `MODAL_ENDPOINT_URL`.
    """
    return generate_svg.local(
        object_name=payload.object_name,
        requested_by=payload.requested_by,
        svg_id=payload.svg_id,
        feedback_history=payload.feedback_history,
        color_palette=payload.color_palette,
        current_svg=payload.current_svg,
        model_tier=payload.model_tier,
    )


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("anthropic-api"),
        modal.Secret.from_name("supabase_for_svg_gen"),
    ],
    timeout=300,  # batch calls produce much more output — generous timeout
)
def batch_generate_svg(
    mode: str,
    requested_by: str,
    model_tier: Optional[str] = DEFAULT_MODEL_TIER,
    category: Optional[str] = None,
    count: int = 10,
    object_name: Optional[str] = None,
    svg_id: Optional[str] = None,
    current_svg: Optional[str] = None,
    feedback_history: Optional[list[str]] = None,
    color_palettes: Optional[list[dict]] = None,
    reference_svgs: Optional[list[dict]] = None,
) -> dict:
    """
    Batch-generate SVGs via a single Claude call. Two modes:

    category: Generate `count` new SVGs for a category. Claude picks names.
    color_variants: Generate an existing object in multiple color palettes.

    Returns:
        {
          "items": [{"name": str, "svg": str, "color": str|None}, ...],
          "session_id": "uuid",
          "input_tokens": int,
          "output_tokens": int,
          "cost_usd": float,
        }
    """
    from anthropic import Anthropic
    from supabase import create_client

    if mode not in ("category", "color_variants"):
        raise ValueError(f"Unknown mode '{mode}'. Expected 'category' or 'color_variants'.")

    tier_key = model_tier or DEFAULT_MODEL_TIER
    if tier_key not in MODEL_TIERS:
        raise ValueError(
            f"Unknown model_tier '{tier_key}'. "
            f"Expected one of: {sorted(MODEL_TIERS.keys())}"
        )
    tier = MODEL_TIERS[tier_key]
    model_id = tier["model"]
    input_price_per_mtok = tier["input_price_per_mtok"]
    output_price_per_mtok = tier["output_price_per_mtok"]

    anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    supabase_client = create_client(
        os.environ["SUPABASE_DATA_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Build prompts
    library_result = (
        supabase_client.from_("physics_svgs").select("name").execute()
    )
    library_names = sorted(row["name"] for row in (library_result.data or []))
    system_prompt = build_system_prompt(library_names)

    if mode == "category":
        user_prompt = build_batch_user_prompt_category(
            category or "mixed", count, reference_svgs=reference_svgs
        )
    else:
        user_prompt = build_batch_user_prompt_colors(
            object_name or "", color_palettes or [], current_svg, feedback_history
        )

    # Audit row
    session_insert = (
        supabase_client.from_("generation_sessions")
        .insert(
            {
                "svg_id": svg_id,
                "requested_by": requested_by,
                "model": model_id,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "status": "pending",
            }
        )
        .execute()
    )
    session_id = session_insert.data[0]["id"]

    try:
        # Batch calls produce much more output (10 SVGs × ~500-1000 tokens
        # each), so we need a generous max_tokens. Stream because non-streaming
        # requests above ~16K max_tokens hit SDK HTTP timeouts; get_final_message
        # reassembles the full response so the rest of the code is unchanged.
        with anthropic_client.messages.stream(
            model=model_id,
            max_tokens=32768,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            message = stream.get_final_message()

        response_text = "".join(
            block.text for block in message.content if block.type == "text"
        )
        raw_items = extract_json_from_response(response_text)

        # Normalize items into a consistent shape. Category mode (Flow C)
        # includes colliders; color-variant mode (Flow D) does not because
        # color variants inherit the parent's collider.
        items = []
        for raw in raw_items:
            svg = raw.get("svg", "")
            svg = extract_svg_from_response(svg) if svg else ""
            item = {
                "name": raw.get("name", object_name or "unknown"),
                "svg": svg,
                "color": raw.get("color", None),
            }
            if mode == "category":
                item["collider"] = raw.get("collider", None)
            items.append(item)

        input_tokens = message.usage.input_tokens
        output_tokens = message.usage.output_tokens
        cost_usd = (
            input_tokens * input_price_per_mtok / 1_000_000
            + output_tokens * output_price_per_mtok / 1_000_000
        )

        # Store the full JSON response text in response_svg for auditability
        supabase_client.from_("generation_sessions").update(
            {
                "response_svg": response_text[:10000],
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost_usd, 6),
                "status": "completed",
                "completed_at": "now()",
            }
        ).eq("id", session_id).execute()

        return {
            "items": items,
            "session_id": session_id,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": round(cost_usd, 6),
        }

    except Exception as exc:
        supabase_client.from_("generation_sessions").update(
            {
                "status": "failed",
                "error_message": str(exc)[:1000],
                "completed_at": "now()",
            }
        ).eq("id", session_id).execute()
        raise


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("anthropic-api"),
        modal.Secret.from_name("supabase_for_svg_gen"),
    ],
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def batch_generate_svg_http(payload: BatchGenerateRequest) -> dict:
    """
    HTTPS POST endpoint for batch generation. Called by the Vercel proxy
    `api/batch-generate.ts`.

    Deploy:
        modal deploy modal_functions/generate_svg.py
    Modal will print the new endpoint URL on stdout. Copy it into Vercel as
    `MODAL_BATCH_ENDPOINT_URL`.
    """
    return batch_generate_svg.local(
        mode=payload.mode,
        requested_by=payload.requested_by,
        model_tier=payload.model_tier,
        category=payload.category,
        count=payload.count,
        object_name=payload.object_name,
        svg_id=payload.svg_id,
        current_svg=payload.current_svg,
        feedback_history=payload.feedback_history,
        color_palettes=payload.color_palettes,
        reference_svgs=payload.reference_svgs,
    )


@app.local_entrypoint()
def main(
    object_name: str,
    requested_by: str,
    feedback: str = "",
    model_tier: str = DEFAULT_MODEL_TIER,
):
    """
    Local entry point for `modal run modal_functions/generate_svg.py ...`.

    Example:
        modal run modal_functions/generate_svg.py \\
            --object-name wooden_block \\
            --requested-by 00000000-0000-0000-0000-000000000000

    Optional:
        --feedback "Make it bigger and use more contrast"
        --model-tier advanced    # use Opus 4.6 instead of the default Sonnet 4.6
    """
    feedback_list = [feedback] if feedback else None
    result = generate_svg.remote(
        object_name=object_name,
        requested_by=requested_by,
        feedback_history=feedback_list,
        model_tier=model_tier,
    )
    print(json.dumps({k: v for k, v in result.items() if k != "svg"}, indent=2))
    print("\n--- SVG ---")
    print(result["svg"])
