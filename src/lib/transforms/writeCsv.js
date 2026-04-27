// Emit a 2-column CSV (Time, Value) from transformed rows. Header uses the
// original parsed labels — if the remap step changed units, the user can
// rename the column manually after download. Recording units accurately on
// the output is a v2 concern.
//
// Numbers are written via JS's default toString() (shortest representation
// that round-trips). For interpolated values we cap at 6 decimals to avoid
// "0.20000000000000004"-style noise in the file.
const FRACTION_DIGITS = 6;

export function writeCsv(rows, timeLabel, valueLabel) {
  const lines = [`${csvEscape(timeLabel)},${csvEscape(valueLabel)}`];
  for (const r of rows) {
    lines.push(`${formatNumber(r.t)},${formatNumber(r.v)}`);
  }
  return lines.join("\n") + "\n";
}

function formatNumber(x) {
  if (!Number.isFinite(x)) return "";
  if (Number.isInteger(x)) return String(x);
  // Trim trailing zeros after toFixed to keep things readable.
  return Number(x).toFixed(FRACTION_DIGITS).replace(/\.?0+$/, "");
}

function csvEscape(s) {
  const str = String(s);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Sanitize a filename for use as the basename of an output file. Replaces
// non-alphanumeric runs with underscores and strips the extension.
export function sanitizeBaseName(filename) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "data";
}
