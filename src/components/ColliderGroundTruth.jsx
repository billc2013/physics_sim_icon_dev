import { parseViewBox, getColliderBounds } from "../lib/svgGeometry.js";
import ColliderPreview from "./ColliderPreview.jsx";
import GeometryInfo from "./GeometryInfo.jsx";

// Large, grid-backed "ground truth" view of one SVG + its collider.
//
// Three layers share the SAME coordinate space, stacked in a box whose aspect
// ratio matches that space — so they align pixel-for-pixel with NO letterboxing:
//   1. the icon (bottom)        — .svg-preview-host forces it to fill its rect
//   2. the coordinate grid      — faint lines every 8 units, labels every 16
//   3. the collider overlay     — ColliderPreview, viewBox-aware
//
// REVEAL out-of-bounds colliders: when a collider's vertices fall outside the
// SVG's 0–W / 0–H viewBox (a common data defect — vertices below the viewBox),
// the coordinate space EXPANDS to include them with a gutter, rather than
// clipping at the edge. The icon stays anchored to its real [0,0,W,H] rect,
// the 0–W/0–H boundary is drawn, off-bounds vertices are marked red, and a
// warning quantifies the overflow. This is the whole point of an audit surface.
//
// Read-only in Phase 1. Editing + a numerically-editable vertex table: Phase 2.

const TARGET = 420; // px on the longer display axis
const STEP = 8; // minor gridline spacing (viewBox units)
const MAJOR = 16; // labelled / darker gridline spacing
const GUTTER = 3; // units of breathing room when expanding for out-of-bounds

export default function ColliderGroundTruth({ item }) {
  if (!item) {
    return (
      <div
        style={{
          padding: "3rem 1rem",
          textAlign: "center",
          color: "var(--color-text-tertiary)",
          fontSize: 13,
        }}
      >
        Select an SVG on the left to inspect its collider against the grid.
      </div>
    );
  }

  const vb = parseViewBox(item.svg) ?? { width: 64, height: 64 };
  const W = vb.width;
  const H = vb.height;

  const collider = item.effectivePhysicalProperties?.collider ?? null;
  const inherited = item.parentId != null;
  const colBounds = collider ? getColliderBounds(collider) : null;

  // Does the collider spill past the icon's viewBox on any edge?
  const overflow = colBounds
    ? {
        left: colBounds.min[0] < 0 ? colBounds.min[0] : null,
        top: colBounds.min[1] < 0 ? colBounds.min[1] : null,
        right: colBounds.max[0] > W ? colBounds.max[0] : null,
        bottom: colBounds.max[1] > H ? colBounds.max[1] : null,
      }
    : null;
  const isOob =
    overflow &&
    (overflow.left != null ||
      overflow.top != null ||
      overflow.right != null ||
      overflow.bottom != null);

  // Expanded coordinate space. In-bounds → exactly the viewBox (no change).
  let minX = 0;
  let minY = 0;
  let maxX = W;
  let maxY = H;
  if (isOob) {
    minX = Math.min(0, colBounds.min[0]) - GUTTER;
    minY = Math.min(0, colBounds.min[1]) - GUTTER;
    maxX = Math.max(W, colBounds.max[0]) + GUTTER;
    maxY = Math.max(H, colBounds.max[1]) + GUTTER;
  }
  const EW = maxX - minX;
  const EH = maxY - minY;

  const boxW = EW >= EH ? TARGET : TARGET * (EW / EH);
  const boxH = EH >= EW ? TARGET : TARGET * (EH / EW);

  // Where the real [0,0,W,H] icon rect sits inside the (possibly expanded) box.
  const iconStyle = {
    position: "absolute",
    left: `${((0 - minX) / EW) * 100}%`,
    top: `${((0 - minY) / EH) * 100}%`,
    width: `${(W / EW) * 100}%`,
    height: `${(H / EH) * 100}%`,
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{item.label}</div>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {item.id} · collider: {collider ? colliderSummary(collider) : "none"}
          {inherited && collider ? ` · inherited from ${item.parentId}` : ""}
        </div>
      </div>

      {isOob && (
        <div
          style={{
            padding: "6px 10px",
            borderRadius: "var(--border-radius-md)",
            background: "#FEF3C7",
            color: "#92400E",
            fontSize: 11,
            marginBottom: 8,
            lineHeight: 1.4,
          }}
        >
          <strong>Collider extends beyond the {W}×{H} viewBox:</strong>{" "}
          {overflowMessage(overflow, W, H)}. Vertices in red are off-canvas —
          GIST scales the collider to the object bbox, so these misalign with the
          art. Likely a bad collider to fix.
        </div>
      )}

      <div
        style={{
          position: "relative",
          width: boxW,
          height: boxH,
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: 2,
        }}
      >
        {/* Layer 1 — the icon, anchored to its real [0,0,W,H] rect */}
        <div
          className="svg-preview-host"
          dangerouslySetInnerHTML={{ __html: item.svg }}
          style={iconStyle}
        />

        {/* Layer 2 — the coordinate grid (spans the whole, possibly expanded, space) */}
        <CoordinateGrid
          minX={minX}
          minY={minY}
          maxX={maxX}
          maxY={maxY}
          vbWidth={W}
          vbHeight={H}
        />

        {/* Layer 3 — the collider overlay + out-of-bounds vertex markers */}
        {collider && (
          <>
            <ColliderPreview
              collider={collider}
              viewBoxMinX={minX}
              viewBoxMinY={minY}
              viewBoxWidth={EW}
              viewBoxHeight={EH}
            />
            {isOob && (
              <OutOfBoundsMarkers
                collider={collider}
                vbWidth={W}
                vbHeight={H}
                minX={minX}
                minY={minY}
                EW={EW}
                EH={EH}
              />
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <GeometryInfo svg={item.svg} collider={collider} />
      </div>

      <ColliderReadout collider={collider} vbWidth={W} vbHeight={H} />
    </div>
  );
}

// Faint gridlines + axis labels across [minX..maxX] × [minY..maxY]. Sits above
// the icon (thin, semi-transparent) so coordinates read off against the art.
// The solid darker rect marks the real 0–W / 0–H viewBox boundary.
function CoordinateGrid({ minX, minY, maxX, maxY, vbWidth, vbHeight }) {
  const verticals = ticks(minX, maxX, STEP);
  const horizontals = ticks(minY, maxY, STEP);
  const labelFont = Math.max(maxX - minX, maxY - minY) / 28;

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      {verticals.map((x) => (
        <line
          key={`v${x}`}
          x1={x}
          y1={minY}
          x2={x}
          y2={maxY}
          stroke="#64748B"
          strokeWidth={x % MAJOR === 0 ? 0.25 : 0.12}
          strokeOpacity={x % MAJOR === 0 ? 0.5 : 0.3}
        />
      ))}
      {horizontals.map((y) => (
        <line
          key={`h${y}`}
          x1={minX}
          y1={y}
          x2={maxX}
          y2={y}
          stroke="#64748B"
          strokeWidth={y % MAJOR === 0 ? 0.25 : 0.12}
          strokeOpacity={y % MAJOR === 0 ? 0.5 : 0.3}
        />
      ))}

      {/* real viewBox boundary (0,0,W,H) */}
      <rect
        x={0}
        y={0}
        width={vbWidth}
        height={vbHeight}
        fill="none"
        stroke="#334155"
        strokeWidth={0.5}
        strokeOpacity={0.7}
      />

      {verticals
        .filter((x) => x % MAJOR === 0)
        .map((x) => (
          <text
            key={`vl${x}`}
            x={x + 0.6}
            y={minY + labelFont + 0.4}
            fontSize={labelFont}
            fill="#475569"
            fillOpacity={0.85}
          >
            {x}
          </text>
        ))}
      {horizontals
        .filter((y) => y % MAJOR === 0)
        .map((y) => (
          <text
            key={`hl${y}`}
            x={minX + 0.6}
            y={y - 0.6}
            fontSize={labelFont}
            fill="#475569"
            fillOpacity={0.85}
          >
            {y}
          </text>
        ))}
    </svg>
  );
}

// Red rings on each collider vertex that falls outside the [0,0,W,H] viewBox.
// Only polygon/compound have explicit vertices; circle/box overflow is already
// conveyed by the boundary rect + warning.
function OutOfBoundsMarkers({ collider, vbWidth, vbHeight, minX, minY, EW, EH }) {
  const verts = colliderVertices(collider).filter(
    ([x, y]) => x < 0 || y < 0 || x > vbWidth || y > vbHeight
  );
  if (verts.length === 0) return null;

  const r = Math.max(EW, EH) / 130; // ~scales with zoom

  return (
    <svg
      viewBox={`${minX} ${minY} ${EW} ${EH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
    >
      {verts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          fill="none"
          stroke="#EF4444"
          strokeWidth={r / 2.5}
        />
      ))}
    </svg>
  );
}

// Read-only coordinate dump of the collider, in viewBox units. Out-of-bounds
// values get an "⚠" so the offending vertices are obvious in the list too.
function ColliderReadout({ collider, vbWidth, vbHeight }) {
  if (!collider) {
    return (
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-text-tertiary)" }}>
        No collider on this item yet. Generation + editing arrive in a later phase.
      </div>
    );
  }

  const rows = colliderRows(collider, vbWidth, vbHeight);

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          marginBottom: 4,
        }}
      >
        Collider coordinates ({collider.type})
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
          lineHeight: 1.5,
          maxHeight: 180,
          overflowY: "auto",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-md)",
          padding: "6px 8px",
        }}
      >
        {rows.map((r, i) => (
          <div key={i} style={{ color: r.oob ? "#B45309" : undefined }}>
            {r.oob ? "⚠ " : "  "}
            {r.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- helpers ----

function ticks(lo, hi, step) {
  const out = [];
  const start = Math.ceil(lo / step) * step;
  for (let v = start; v <= hi + 0.001; v += step) out.push(round2(v));
  return out;
}

function colliderVertices(c) {
  switch (c.type) {
    case "convex":
      return c.vertices ?? [];
    case "compound":
      return (c.parts ?? []).flatMap(colliderVertices);
    default:
      return [];
  }
}

function overflowMessage(o, W, H) {
  const parts = [];
  if (o.bottom != null) parts.push(`bottom ${o.bottom} (>${H})`);
  if (o.right != null) parts.push(`right ${o.right} (>${W})`);
  if (o.top != null) parts.push(`top ${o.top} (<0)`);
  if (o.left != null) parts.push(`left ${o.left} (<0)`);
  return parts.join(", ");
}

function colliderSummary(c) {
  switch (c.type) {
    case "circle":
      return "circle";
    case "box":
      return "box";
    case "convex":
      return `polygon (${c.vertices?.length ?? 0} verts)`;
    case "compound":
      return `compound (${c.parts?.length ?? 0} parts)`;
    default:
      return c.type;
  }
}

function oob(x, y, W, H) {
  return x < 0 || y < 0 || x > W || y > H;
}

function colliderRows(c, W, H) {
  switch (c.type) {
    case "circle":
      return [
        { text: `center  (${c.center[0]}, ${c.center[1]})` },
        { text: `radius  ${c.radius}` },
      ];
    case "box":
      return [
        { text: `center  (${c.center[0]}, ${c.center[1]})` },
        { text: `size    ${c.width} × ${c.height}` },
        ...(c.angle ? [{ text: `angle   ${c.angle} rad` }] : []),
      ];
    case "convex":
      return (c.vertices ?? []).map(([x, y], i) => ({
        text: `[${String(i).padStart(2, " ")}]  (${x}, ${y})`,
        oob: oob(x, y, W, H),
      }));
    case "compound":
      return (c.parts ?? []).flatMap((p, i) => [
        { text: `part ${i} — ${p.type}` },
        ...colliderRows(p, W, H).map((r) => ({ ...r, text: `   ${r.text}` })),
      ]);
    default:
      return [{ text: JSON.stringify(c) }];
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
