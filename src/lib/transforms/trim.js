// Time-domain trim. Drops rows whose t is outside [from, to], then rebases
// the surviving samples so the first one is at t=0. Rebasing is always-on
// because GIST's sim importer expects a time-series starting at zero — if
// we ever need to preserve the original time origin we can add a flag.
//
// The brush UI still operates in original-time coordinates, so the recorded
// `from`/`to` in pipeline.json are the user's actual crop bounds, not the
// rebased ones.
export function applyTrim(rows, params) {
  if (rows.length === 0) return rows;
  const { from, to } = params;
  const minT = rows[0].t;
  const maxT = rows[rows.length - 1].t;

  let kept = rows;
  if (from > minT || to < maxT) {
    kept = rows.filter((r) => r.t >= from && r.t <= to);
  }
  if (kept.length === 0) return kept;

  const t0 = kept[0].t;
  if (t0 === 0) return kept;
  return kept.map((r) => ({ ...r, t: r.t - t0 }));
}

// "No-op" means: trim window covers all rows AND the first row is already
// at t=0 (so the rebase wouldn't move anything). If either is false,
// applyTrim does meaningful work and the step is recorded in the manifest.
export function isTrimNoop(params, rows) {
  if (rows.length === 0) return true;
  const { from, to } = params;
  return from <= rows[0].t && to >= rows[rows.length - 1].t && rows[0].t === 0;
}
