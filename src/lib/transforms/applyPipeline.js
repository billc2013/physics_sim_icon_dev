import { applyTrim, isTrimNoop } from "./trim.js";
import { applyResample } from "./resample.js";
import { applyRemap } from "./remap.js";

// Run the pipeline against parsed rows. Steps without `enabled: true` are
// skipped. Trim is special-cased: it has no `enabled` flag; instead it's
// skipped when its window already spans all data.
//
// Pipeline shape:
//   {
//     version: 1,
//     steps: [
//       { op: "trim", from, to },
//       { op: "resample", enabled, dt, method },
//       { op: "remap", enabled, input: [lo, hi], output: [lo, hi] },
//     ]
//   }
export function applyPipeline(rows, steps) {
  let current = rows;
  for (const step of steps) {
    if (step.op === "trim") {
      if (!isTrimNoop(step, current)) current = applyTrim(current, step);
    } else if (step.op === "resample") {
      if (step.enabled) current = applyResample(current, step);
    } else if (step.op === "remap") {
      if (step.enabled) current = applyRemap(current, step);
    } else {
      throw new Error(`Unknown transform op: ${step.op}`);
    }
  }
  return current;
}
