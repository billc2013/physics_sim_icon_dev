// CSV parser for the Data Transforms tool.
//
// Handles two known shapes auto-detected by header content, NOT by row count:
//   1. Simple GIST-style:  "Time (s),Vertical Position (cm)" then 2-col data
//   2. Phone export style: 3-line preamble, then "Comment,Time (s),Value"
//                          followed by 3-col data (index column dropped)
//
// We scan the first ~10 lines for a row containing "Time" (case-insensitive)
// and at least 2 columns. That row is the header. Time and value columns are
// identified by name; "Comment"/"Index"/"#"/"Row" columns are skipped.
//
// Return shape:
//   { rows: [{ t, v }], timeLabel, valueLabel, warnings: [] }
//
// Limitations (acceptable for v1):
//   - Comma delimiter only (no semicolon or tab support)
//   - Naive split — fields containing commas inside quotes will misparse.
//     None of the data we've seen uses quoted fields. Swap to PapaParse if
//     this ever becomes a problem.

const HEADER_SEARCH_DEPTH = 10;
const INDEX_COLUMN_NAMES = /^(comment|index|#|row|n)$/i;

export function parseCsv(text) {
  const rawLines = text.split(/\r?\n/);
  const warnings = [];

  let headerRowIndex = -1;
  let headerCells = null;
  const searchDepth = Math.min(rawLines.length, HEADER_SEARCH_DEPTH);
  for (let i = 0; i < searchDepth; i++) {
    const cells = splitRow(rawLines[i]);
    if (cells.length >= 2 && cells.some((c) => /time/i.test(c))) {
      headerRowIndex = i;
      headerCells = cells;
      break;
    }
  }
  if (headerRowIndex === -1) {
    throw new Error(
      "Couldn't find a header row containing \"Time\" within the first 10 lines."
    );
  }

  const timeColIdx = headerCells.findIndex((c) => /time/i.test(c));
  const valueColIdx = headerCells.findIndex(
    (c, i) => i !== timeColIdx && !INDEX_COLUMN_NAMES.test(c) && c.length > 0
  );
  if (valueColIdx === -1) {
    throw new Error("Couldn't find a value column distinct from the time column.");
  }

  const timeLabel = headerCells[timeColIdx];
  const valueLabel = headerCells[valueColIdx];

  const rows = [];
  let skipped = 0;
  for (let i = headerRowIndex + 1; i < rawLines.length; i++) {
    const cells = splitRow(rawLines[i]);
    if (cells.length === 0) continue; // blank line, silent skip
    if (cells.length <= Math.max(timeColIdx, valueColIdx)) {
      skipped++;
      continue;
    }
    const t = Number(cells[timeColIdx]);
    const v = Number(cells[valueColIdx]);
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      skipped++;
      continue;
    }
    rows.push({ t, v });
  }

  if (skipped > 0) {
    warnings.push(
      `Skipped ${skipped} unparseable row${skipped === 1 ? "" : "s"}.`
    );
  }
  if (rows.length === 0) {
    throw new Error("No parseable data rows found below the header.");
  }
  if (headerRowIndex > 0) {
    warnings.push(
      `Skipped ${headerRowIndex} preamble line${headerRowIndex === 1 ? "" : "s"} above the header.`
    );
  }

  return { rows, timeLabel, valueLabel, warnings };
}

function splitRow(line) {
  if (line == null) return [];
  return line.split(",").map((c) => c.trim());
}

// Convenience helpers used by the chart + summary card.
export function rangeOf(rows, key) {
  if (rows.length === 0) return [0, 0];
  let lo = rows[0][key];
  let hi = lo;
  for (let i = 1; i < rows.length; i++) {
    const x = rows[i][key];
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}
