// Linear remap of the value column from input range to output range.
// Time column passes through untouched.
//
// Output is allowed to be partially set — UI initialises output as [null,
// null] and lets the user type one or both. If either side is null, this
// pass-throughs (the step is effectively pending and is excluded from the
// exported manifest by serializePipeline).
//
// Maps input[0] -> output[0], input[1] -> output[1] linearly. Values outside
// the input range extrapolate (intentional — clamping would silently hide
// data you didn't realise was outside your declared input range).
export function applyRemap(rows, params) {
  const [iLo, iHi] = params.input;
  const [oLo, oHi] = params.output;
  if (oLo == null || oHi == null) return rows;
  const span = iHi - iLo;
  if (span === 0) return rows.map((r) => ({ ...r, v: oLo }));
  const scale = (oHi - oLo) / span;
  return rows.map((r) => ({ ...r, v: oLo + (r.v - iLo) * scale }));
}

// Remap is "complete" when both output bounds have been set. Used by the
// pipeline serializer to decide whether to include the step in the manifest.
export function isRemapComplete(params) {
  return params.output[0] != null && params.output[1] != null;
}
