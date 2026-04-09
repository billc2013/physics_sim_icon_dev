import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase.js";
import { COLOR_RAMPS } from "../lib/constants.js";

// Hook for calling the /api/generate Vercel proxy. Used by both the
// "Generate new" flow (Header button) and the "Send to Claude" revise flow
// (DetailModal button).
//
// State machine:
//   idle      → no result yet
//   generating → request in flight
//   ready     → result available, awaiting accept/discard
//   error     → request failed
//
// Calling generate() resets to 'generating'. Calling reset() returns to 'idle'.
//
// Returns:
//   { status, result, error, generate, reset }
//
// generate() args (object):
//   objectName       string  required
//   colorTag         string?  ramp name like "blue", or null
//   svgId            string?  physics_svgs.id when revising, else undefined
//   feedbackHistory  string[]?  feedback strings to send as context
//   currentSvg       string?  existing SVG markup when revising
//   modelTier        "standard" | "advanced"  which Anthropic model to use
//                    (defaults to "standard" = Sonnet 4.6)
export function useGeneration() {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  const generate = useCallback(async ({
    objectName,
    colorTag,
    svgId,
    feedbackHistory,
    currentSvg,
    modelTier = "standard",
  }) => {
    setStatus("generating");
    setResult(null);
    setError(null);

    try {
      // Pull a fresh access token. Supabase auto-refreshes but it's safer
      // to call getSession() than rely on a stale closure.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

      // Translate the colorTag string into the {name, light, mid, dark}
      // shape the Modal function expects.
      const colorPalette = colorTag
        ? {
            name: colorTag,
            light: COLOR_RAMPS[colorTag].l,
            mid: COLOR_RAMPS[colorTag].m,
            dark: COLOR_RAMPS[colorTag].d,
          }
        : null;

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          object_name: objectName,
          svg_id: svgId ?? null,
          feedback_history: feedbackHistory ?? null,
          color_palette: colorPalette,
          current_svg: currentSvg ?? null,
          model_tier: modelTier,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Generate failed (${response.status}): ${text}`);
      }

      const data = await response.json();
      setResult(data);
      setStatus("ready");
      return data;
    } catch (e) {
      setError(e);
      setStatus("error");
      throw e;
    }
  }, []);

  return { status, result, error, generate, reset };
}
