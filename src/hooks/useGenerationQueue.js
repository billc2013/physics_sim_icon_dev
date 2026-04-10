import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase.js";
import { COLOR_RAMPS } from "../lib/constants.js";

// Global generation queue. Processes jobs one at a time (sequential).
// Jobs are fire-and-forget: the caller adds a job and moves on. Results
// accumulate in the queue until the user reviews them in the QueuePanel.
//
// Three job types:
//   revise         — single-object revision (Flow B)
//   batch_category — generate 10 new SVGs for a category (Flow C)
//   batch_colors   — generate one object in N color palettes (Flow D)
//
// Job shape:
//   {
//     id: string,          // crypto.randomUUID()
//     type: string,        // "revise" | "batch_category" | "batch_colors"
//     label: string,       // human-readable, for toast and queue display
//     status: string,      // "queued" | "generating" | "ready" | "error"
//     request: object,     // everything needed to build the API call
//     result: object|null, // API response when done
//     error: Error|null,
//     createdAt: string,   // ISO timestamp
//   }

async function getToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

async function runRevise(request) {
  const token = await getToken();
  const colorPalette = request.colorTag
    ? {
        name: request.colorTag,
        light: COLOR_RAMPS[request.colorTag].l,
        mid: COLOR_RAMPS[request.colorTag].m,
        dark: COLOR_RAMPS[request.colorTag].d,
      }
    : null;

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      object_name: request.objectName,
      svg_id: request.svgId ?? null,
      feedback_history: request.feedbackHistory ?? null,
      color_palette: colorPalette,
      current_svg: request.currentSvg ?? null,
      model_tier: request.modelTier ?? "standard",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Generate failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function runBatch(request) {
  const token = await getToken();

  const body = { mode: request.mode, model_tier: request.modelTier ?? "standard" };
  if (request.mode === "category") {
    body.category = request.category;
    body.count = request.count ?? 10;
  } else {
    body.object_name = request.objectName;
    body.svg_id = request.svgId ?? null;
    body.current_svg = request.currentSvg ?? null;
    body.feedback_history = request.feedbackHistory ?? null;
    body.color_palettes = request.colorTags.map((tag) => ({
      name: tag,
      light: COLOR_RAMPS[tag].l,
      mid: COLOR_RAMPS[tag].m,
      dark: COLOR_RAMPS[tag].d,
    }));
  }

  const res = await fetch("/api/batch-generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Batch generate failed (${res.status}): ${text}`);
  }
  return res.json();
}

const RUNNERS = {
  revise: runRevise,
  batch_category: runBatch,
  batch_colors: runBatch,
};

export function useGenerationQueue() {
  const [jobs, setJobs] = useState([]);
  const processingRef = useRef(false);
  // Callback refs so the effect doesn't re-fire on handler identity changes
  const onCompleteRef = useRef(null);
  const onErrorRef = useRef(null);

  const setOnComplete = useCallback((fn) => { onCompleteRef.current = fn; }, []);
  const setOnError = useCallback((fn) => { onErrorRef.current = fn; }, []);

  const addJob = useCallback(({ type, label, request }) => {
    const job = {
      id: crypto.randomUUID(),
      type,
      label,
      status: "queued",
      request,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    setJobs((prev) => [...prev, job]);
    return job.id;
  }, []);

  const discardJob = useCallback((jobId) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const retryJob = useCallback((jobId) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, status: "queued", error: null, result: null } : j
      )
    );
  }, []);

  // Sequential processor: when no job is generating and a queued job
  // exists, start it. We use requestAnimationFrame to batch the status
  // update outside of the React render cycle, avoiding the
  // set-state-in-effect lint rule. processingRef prevents concurrent runs.
  useEffect(() => {
    if (processingRef.current) return;

    const next = jobs.find((j) => j.status === "queued");
    if (!next) return;

    processingRef.current = true;

    const runner = RUNNERS[next.type];
    if (!runner) {
      requestAnimationFrame(() => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === next.id
              ? { ...j, status: "error", error: new Error(`Unknown job type: ${next.type}`) }
              : j
          )
        );
        processingRef.current = false;
      });
      return;
    }

    // Mark as generating via rAF (avoids synchronous setState in effect)
    requestAnimationFrame(() => {
      setJobs((prev) =>
        prev.map((j) => (j.id === next.id ? { ...j, status: "generating" } : j))
      );
    });

    runner(next.request)
      .then((result) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === next.id ? { ...j, status: "ready", result } : j
          )
        );
        onCompleteRef.current?.(next);
      })
      .catch((error) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === next.id ? { ...j, status: "error", error } : j
          )
        );
        onErrorRef.current?.(next, error);
      })
      .finally(() => {
        processingRef.current = false;
      });
  }, [jobs]);

  // Convenience: find jobs relevant to a specific item (for inline display
  // in DetailModal when the user stays on the item).
  const getJobsForItem = useCallback(
    (itemId) => jobs.filter((j) => j.request?.objectName === itemId),
    [jobs]
  );

  // Counts for the header badge
  const generating = jobs.filter((j) => j.status === "generating").length;
  const queued = jobs.filter((j) => j.status === "queued").length;
  const ready = jobs.filter((j) => j.status === "ready").length;
  const errored = jobs.filter((j) => j.status === "error").length;

  return {
    jobs,
    addJob,
    discardJob,
    retryJob,
    getJobsForItem,
    setOnComplete,
    setOnError,
    generating,
    queued,
    ready,
    errored,
    hasActivity: jobs.length > 0,
  };
}
