import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase.js";
import { COLOR_RAMPS } from "../lib/constants.js";

// Hook for calling the /api/batch-generate Vercel proxy. Used by:
//   - BatchGenerateModal (category mode: generate 10 new SVGs)
//   - DetailModal (color_variants mode: generate one object in N colors)
//
// State machine:
//   idle       → no result yet
//   generating → request in flight
//   ready      → results available, awaiting accept/discard
//   error      → request failed
//
// Returns:
//   { status, items, error, stats, generateCategory, generateColorVariants, reset }
//
// `items` is the array of { name, svg, color } returned by the batch endpoint.
// `stats` is { input_tokens, output_tokens, cost_usd, session_id }.
export function useBatchGeneration() {
  const [status, setStatus] = useState("idle");
  const [items, setItems] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setItems(null);
    setStats(null);
    setError(null);
  }, []);

  const callBatch = useCallback(async (body) => {
    setStatus("generating");
    setItems(null);
    setStats(null);
    setError(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const response = await fetch("/api/batch-generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Batch generate failed (${response.status}): ${text}`);
      }

      const data = await response.json();
      setItems(data.items ?? []);
      setStats({
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        cost_usd: data.cost_usd,
        session_id: data.session_id,
      });
      setStatus("ready");
      return data;
    } catch (e) {
      setError(e);
      setStatus("error");
      throw e;
    }
  }, []);

  // Category mode: generate `count` new SVGs for a category.
  const generateCategory = useCallback(
    async ({ category, modelTier = "standard" }) => {
      return callBatch({
        mode: "category",
        category,
        count: 10,
        model_tier: modelTier,
      });
    },
    [callBatch]
  );

  // Color variant mode: generate one object in multiple color palettes.
  const generateColorVariants = useCallback(
    async ({
      objectName,
      svgId,
      currentSvg,
      feedbackHistory,
      colorTags,
      modelTier = "standard",
    }) => {
      const colorPalettes = colorTags.map((tag) => ({
        name: tag,
        light: COLOR_RAMPS[tag].l,
        mid: COLOR_RAMPS[tag].m,
        dark: COLOR_RAMPS[tag].d,
      }));
      return callBatch({
        mode: "color_variants",
        object_name: objectName,
        svg_id: svgId ?? null,
        current_svg: currentSvg ?? null,
        feedback_history: feedbackHistory ?? null,
        color_palettes: colorPalettes,
        model_tier: modelTier,
      });
    },
    [callBatch]
  );

  return { status, items, error, stats, generateCategory, generateColorVariants, reset };
}
