import { isTrimNoop } from "./trim.js";
import { isRemapComplete } from "./remap.js";
import { rangeOf } from "./parseCsv.js";

// Build the pipeline.json bundled alongside the cleaned CSV. Records the
// source CSV's metadata, the EFFECTIVE steps (no-op trim and disabled
// resample/remap are stripped), and a snapshot of the output shape.
//
// The intent is auditable + reproducible: someone re-running this pipeline
// against the same source CSV should get an identical cleaned output.
export function serializePipeline({
  pipeline,
  sourceFilename,
  parseResult,
  transformedRows,
  userEmail,
}) {
  const effectiveSteps = pipeline.steps
    .filter((s) => {
      if (s.op === "trim") return !isTrimNoop(s, parseResult.rows);
      if (s.op === "remap") return s.enabled === true && isRemapComplete(s);
      return s.enabled === true;
    })
    .map(stripStepInternals);

  const [tLo, tHi] = rangeOf(transformedRows, "t");
  const [vLo, vHi] = rangeOf(transformedRows, "v");

  return {
    version: 1,
    source: {
      filename: sourceFilename,
      time_label: parseResult.timeLabel,
      value_label: parseResult.valueLabel,
      row_count: parseResult.rows.length,
    },
    steps: effectiveSteps,
    output: {
      row_count: transformedRows.length,
      time_range: [tLo, tHi],
      value_range: [vLo, vHi],
    },
    exported_at: new Date().toISOString(),
    exported_by: userEmail ?? null,
  };
}

// Strip UI-only fields (the `enabled` flag) so the saved JSON only carries
// transform-effective params. Future-proof: if we add new ops, add cases here.
function stripStepInternals(step) {
  switch (step.op) {
    case "trim":
      return { op: "trim", from: step.from, to: step.to };
    case "resample":
      return { op: "resample", dt: step.dt, method: step.method };
    case "remap":
      return { op: "remap", input: step.input, output: step.output };
    default:
      return step;
  }
}
