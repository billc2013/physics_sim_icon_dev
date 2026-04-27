// Spacing statistics on the time column. Used to suggest a default Δt for
// resample, and to decide whether to nudge the user toward enabling resample.
export function spacingStats(rows) {
  if (rows.length < 2) return null;
  const dts = [];
  for (let i = 1; i < rows.length; i++) {
    dts.push(rows[i].t - rows[i - 1].t);
  }
  const sorted = [...dts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
  let varSum = 0;
  for (const d of dts) varSum += (d - mean) ** 2;
  const stdDev = Math.sqrt(varSum / dts.length);
  const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation
  return { median, min, max, mean, stdDev, cv, count: dts.length };
}

// Round a Δt to a friendly value for the suggested-default UX. We don't want
// to hand the user 1.0027 just because that's the exact median.
export function roundFriendly(x) {
  if (!Number.isFinite(x) || x <= 0) return x;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  const norm = x / mag; // in [1, 10)
  let rounded;
  if (norm < 1.5) rounded = 1;
  else if (norm < 3.5) rounded = 2;
  else if (norm < 7.5) rounded = 5;
  else rounded = 10;
  return Number((rounded * mag).toPrecision(6));
}

// Heuristic — call timing "uniform" when the coefficient of variation
// is below 1%. Tighter than that gets noisy on near-uniform real data.
export const UNIFORM_CV_THRESHOLD = 0.01;
