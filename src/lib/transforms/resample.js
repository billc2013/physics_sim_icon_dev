// Resample to uniform Δt by linear interpolation.
//
// Input rows must be sorted ascending by t (CSV time-series naturally are).
// Generates samples at tMin, tMin+dt, tMin+2dt, ..., up to and including tMax
// (within a small epsilon to handle floating-point drift on the last step).
//
// method = "linear" only for v1. "step" / spline are easy follow-ups.
export function applyResample(rows, params) {
  const { dt, method = "linear" } = params;
  if (rows.length === 0) return [];
  if (rows.length === 1) return rows.slice();
  if (!Number.isFinite(dt) || dt <= 0) return rows.slice();

  const tMin = rows[0].t;
  const tMax = rows[rows.length - 1].t;
  const out = [];
  let i = 0;

  // Use an explicit step count to avoid floating-point loop drift.
  const stepCount = Math.floor((tMax - tMin) / dt + 1e-9) + 1;
  for (let s = 0; s < stepCount; s++) {
    const t = tMin + s * dt;
    while (i < rows.length - 2 && rows[i + 1].t < t) i++;
    const t0 = rows[i].t;
    const t1 = rows[i + 1].t;
    const v0 = rows[i].v;
    const v1 = rows[i + 1].v;
    if (method === "linear") {
      const span = t1 - t0;
      const v = span === 0 ? v0 : v0 + ((t - t0) / span) * (v1 - v0);
      out.push({ t, v });
    } else {
      out.push({ t, v: v0 });
    }
  }
  return out;
}
