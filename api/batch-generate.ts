// Vercel serverless function: thin auth proxy for the batch Modal endpoint.
//
// Same architecture as api/generate.ts — validate JWT, inject requested_by,
// forward to Modal — but targets the batch_generate_svg_http endpoint and
// validates the `mode` and `model_tier` fields.
//
// ENV VARS
// --------
//   VITE_SUPABASE_URL         - same value used by the browser client
//   VITE_SUPABASE_ANON_KEY    - same value used by the browser client
//   MODAL_BATCH_ENDPOINT_URL  - printed by `modal deploy`, separate from
//                               MODAL_ENDPOINT_URL for the single endpoint

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const MODAL_BATCH_ENDPOINT_URL = process.env.MODAL_BATCH_ENDPOINT_URL;

const ALLOWED_MODES = ["category", "color_variants"] as const;
const ALLOWED_MODEL_TIERS = ["standard", "advanced"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!MODAL_BATCH_ENDPOINT_URL) missing.push("MODAL_BATCH_ENDPOINT_URL");
  if (missing.length) {
    return res.status(500).json({
      error: `Server is misconfigured: missing ${missing.join(", ")}.`,
    });
  }

  // 1. Validate JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const jwt = authHeader.slice(7);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: userData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !userData?.user) {
    return res.status(401).json({ error: "Invalid token" });
  }
  const userId = userData.user.id;

  // 2. Validate and sanitize request body
  const clientBody = req.body ?? {};

  const rawMode = clientBody.mode;
  if (!rawMode || !(ALLOWED_MODES as readonly string[]).includes(rawMode)) {
    return res.status(400).json({
      error: `mode is required and must be one of: ${ALLOWED_MODES.join(", ")}`,
    });
  }

  const rawTier = clientBody.model_tier;
  const modelTier =
    typeof rawTier === "string" && (ALLOWED_MODEL_TIERS as readonly string[]).includes(rawTier)
      ? rawTier
      : "standard";

  const modalPayload: Record<string, unknown> = {
    mode: rawMode,
    model_tier: modelTier,
    requested_by: userId,
  };

  if (rawMode === "category") {
    if (!clientBody.category || typeof clientBody.category !== "string") {
      return res.status(400).json({ error: "category is required for category mode" });
    }
    modalPayload.category = clientBody.category;
    modalPayload.count = typeof clientBody.count === "number" ? clientBody.count : 10;
  } else {
    // color_variants
    if (!clientBody.object_name || typeof clientBody.object_name !== "string") {
      return res.status(400).json({ error: "object_name is required for color_variants mode" });
    }
    if (!Array.isArray(clientBody.color_palettes) || clientBody.color_palettes.length === 0) {
      return res.status(400).json({ error: "color_palettes array is required for color_variants mode" });
    }
    modalPayload.object_name = clientBody.object_name;
    modalPayload.svg_id = clientBody.svg_id ?? null;
    modalPayload.current_svg = clientBody.current_svg ?? null;
    modalPayload.feedback_history = clientBody.feedback_history ?? null;
    modalPayload.color_palettes = clientBody.color_palettes;
  }

  // 3. Forward to Modal
  let modalResponse: Response;
  try {
    modalResponse = await fetch(MODAL_BATCH_ENDPOINT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modalPayload),
    });
  } catch (err) {
    return res.status(502).json({
      error: `Failed to reach Modal: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (!modalResponse.ok) {
    const text = await modalResponse.text();
    return res.status(502).json({ error: `Modal returned ${modalResponse.status}: ${text}` });
  }

  const result = await modalResponse.json();
  return res.status(200).json(result);
}
