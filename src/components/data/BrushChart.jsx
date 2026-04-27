import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ResponsiveContainer,
} from "recharts";

// Original-data chart with a Recharts <Brush>. The brush serves as both
// minimap and trim control: drag the handles to crop a time window. The
// surrounding chart auto-narrows to the selection (Recharts behavior we
// lean into rather than fight).
//
// Trim from/to live in the parent's pipeline state. We translate to/from
// array indices via binary search so the brush stays consistent when the
// user types into the trim numeric inputs instead of dragging.
export default function BrushChart({
  rows,
  timeLabel,
  valueLabel,
  trimFrom,
  trimTo,
  onTrimChange,
  height = 240,
}) {
  const startIndex = useMemo(
    () => indexAtOrAfter(rows, trimFrom),
    [rows, trimFrom]
  );
  const endIndex = useMemo(
    () => indexAtOrBefore(rows, trimTo),
    [rows, trimTo]
  );

  const handleBrushChange = (range) => {
    if (!range || range.startIndex == null || range.endIndex == null) return;
    const fromRow = rows[range.startIndex];
    const toRow = rows[range.endIndex];
    if (!fromRow || !toRow) return;
    if (fromRow.t === trimFrom && toRow.t === trimTo) return; // no-op
    onTrimChange({ from: fromRow.t, to: toRow.t });
  };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart
          data={rows}
          margin={{ top: 8, right: 24, bottom: 8, left: 32 }}
        >
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            dataKey="v"
            domain={["auto", "auto"]}
            tick={{ fontSize: 11 }}
            label={{
              value: valueLabel,
              angle: -90,
              position: "insideLeft",
              offset: -16,
              fontSize: 12,
              style: { textAnchor: "middle" },
            }}
          />
          <Tooltip
            formatter={(val) => Number(val).toFixed(3)}
            labelFormatter={(t) => `${timeLabel}: ${Number(t).toFixed(3)}`}
            contentStyle={{ fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke="#94A3B8"
            strokeWidth={1.25}
            dot={false}
            isAnimationActive={false}
          />
          <Brush
            dataKey="t"
            height={28}
            stroke="#2563EB"
            travellerWidth={8}
            startIndex={startIndex}
            endIndex={endIndex}
            onChange={handleBrushChange}
            tickFormatter={(t) => Number(t).toFixed(1)}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Smallest index whose t >= target, clamped to last index.
function indexAtOrAfter(rows, target) {
  if (rows.length === 0) return 0;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Largest index whose t <= target, clamped to 0.
function indexAtOrBefore(rows, target) {
  if (rows.length === 0) return 0;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].t > target) hi = mid - 1;
    else lo = mid;
  }
  return lo;
}
