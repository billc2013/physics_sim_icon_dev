import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Line chart for a parsed CSV. Time on X, value on Y. No brush yet —
// trim selection lands in the next step alongside the transform pipeline.
export default function DataChart({ rows, timeLabel, valueLabel, height = 320 }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart
          data={rows}
          margin={{ top: 8, right: 24, bottom: 32, left: 32 }}
        >
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11 }}
            label={{
              value: timeLabel,
              position: "insideBottom",
              offset: -12,
              fontSize: 12,
            }}
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
            stroke="#2563EB"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
