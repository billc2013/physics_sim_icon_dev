// Vercel serverless function: thin auth proxy in front of Modal.
//
// ARCHITECTURE
// ------------
// The browser POSTs here with the user's Supabase JWT in the Authorization
// header. We:
//   1. Validate the JWT against Supabase (returns the auth.users.id).
//   2. Forward the body to the Modal HTTP endpoint, *injecting* the
//      validated user_id as `requested_by`. We never trust whatever the
//      browser sends for that field.
//   3. Return Modal's response unchanged.
//
// We never call Claude here. We never write to the DB here. The Anthropic
// key never lives in this function. All of that lives in Modal.
//
// ENV VARS
// --------
//   VITE_SUPABASE_URL       - same value used by the browser client
//   VITE_SUPABASE_ANON_KEY  - same value used by the browser client
//   MODAL_ENDPOINT_URL      - the URL printed by `modal deploy`
//
// Note: VITE_ vars are normally only injected at Vite build time, but
// `vercel dev` and Vercel production both expose .env.local / project env
// vars to serverless functions via process.env regardless of prefix.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const MODAL_ENDPOINT_URL = process.env.MODAL_ENDPOINT_URL;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 0. Method gate.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 0a. Config sanity check. Fail loudly so misconfigured deploys don't
  //     silently 500 with a confusing error. Report which specific vars
  //     are missing so the dev/deployer can find the gap quickly.
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!MODAL_ENDPOINT_URL) missing.push("MODAL_ENDPOINT_URL");
  if (missing.length) {
    return res.status(500).json({
      error: `Server is misconfigured: missing ${missing.join(", ")}.`,
    });
  }

  // 1. Pull the JWT off the Authorization header.
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const jwt = authHeader.slice(7);

  // 2. Validate the JWT by asking Supabase who it belongs to. This is one
  //    extra round trip per generate call but it's the simplest pattern
  //    that doesn't require us to manage the JWT signing secret on Vercel.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: userData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !userData?.user) {
    return res.status(401).json({ error: "Invalid token" });
  }
  const userId = userData.user.id;

  // 3. Build the Modal payload. We override `requested_by` no matter what
  //    the client sent, so the audit row in `generation_sessions` always
  //    reflects the authenticated user.
  const clientBody = req.body ?? {};
  const modalPayload = {
    object_name: clientBody.object_name,
    svg_id: clientBody.svg_id ?? null,
    feedback_history: clientBody.feedback_history ?? null,
    color_palette: clientBody.color_palette ?? null,
    current_svg: clientBody.current_svg ?? null,
    requested_by: userId,
  };

  if (!modalPayload.object_name || typeof modalPayload.object_name !== "string") {
    return res.status(400).json({ error: "object_name is required" });
  }

  // 4. Forward to Modal. The Modal endpoint URL is unguessable so the only
  //    practical caller is this Vercel function (which knows it via env).
  let modalResponse: Response;
  try {
    modalResponse = await fetch(MODAL_ENDPOINT_URL, {
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

  // 5. Pass through Modal's JSON response unchanged.
  const result = await modalResponse.json();
  return res.status(200).json(result);
}
