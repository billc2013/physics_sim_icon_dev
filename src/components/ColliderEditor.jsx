import { useCallback, useRef, useState } from "react";
import {
  VIEWBOX_SIZE,
  MAX_CONVEX_VERTICES,
  isConvexPolygon,
} from "../lib/colliderSchema.js";

// Interactive polygon editor overlaid on the SVG preview.
//
// All three operations are available simultaneously (no mode switching):
//   - Drag blue vertex circles to move them
//   - Click green "+" midpoints to add a vertex on that edge
//   - Click the red "×" badge on a vertex to remove it
//
// Coordinates are in SVG viewBox space (0–64). Mouse events are converted
// from client pixels via SVG's getScreenCTM(), which handles any CSS
// transforms/padding automatically.
//
// EXPANDED CANVAS: the editor's visible area extends EDIT_PADDING units beyond
// the icon's 0–64 bounds on each side so vertices outside the icon's viewBox
// remain visible and draggable. The CSS sizing is tuned so the 0–64 range
// of the editor still aligns pixel-for-pixel with the icon beneath it —
// the extra area is a "gutter" that renders over the container's padding.
// A faint reference rectangle marks the 0–64 icon bounds so users know
// where the canvas actually is.

const EDIT_PADDING = 10;                          // units of gutter on each side
const EXPANDED_SIZE = VIEWBOX_SIZE + 2 * EDIT_PADDING; // 84 units total
// CSS ratios to keep the editor's 0–64 range aligned with the 100%×100%
// icon beneath it. size = (icon+gutter)/icon, offset = -gutter/icon.
const SIZE_PCT = (EXPANDED_SIZE / VIEWBOX_SIZE) * 100;    // 131.25%
const OFFSET_PCT = -(EDIT_PADDING / VIEWBOX_SIZE) * 100;  // -15.625%

const VERTEX_R = 2.2;       // blue vertex handle radius (viewBox units)
const VERTEX_HIT_R = 3.5;   // transparent larger hit area behind vertex
const MIDPOINT_R = 1.6;     // green add-point handle radius
const REMOVE_R = 1.6;       // red × badge radius
const REMOVE_OFFSET = 3;    // offset from vertex center (viewBox units)

const COLOR_VERTEX = "#3B82F6";
const COLOR_VERTEX_DRAG = "#1D4ED8";
const COLOR_MIDPOINT = "#10B981";
const COLOR_REMOVE = "#EF4444";
const COLOR_FILL = "rgba(59, 130, 246, 0.12)";
const COLOR_STROKE = "#3B82F6";
const COLOR_STROKE_CONCAVE = "#F59E0B";

export default function ColliderEditor({ vertices, onChange }) {
  const svgRef = useRef(null);
  const [draggingIdx, setDraggingIdx] = useState(null);
  // Shape-translation drag: grab the polygon fill and move the whole
  // shape. Records the grab point (in SVG coords) + a snapshot of the
  // vertices at drag start, so each pointermove computes a fresh
  // delta from the original positions (no drift).
  const [shapeDrag, setShapeDrag] = useState(null); // { startPos, startVerts } | null

  const isConvex = isConvexPolygon(vertices);
  const atMax = vertices.length >= MAX_CONVEX_VERTICES;
  const atMin = vertices.length <= 3;

  // Convert client mouse coordinates to SVG viewBox coordinates.
  const clientToSvg = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const svgPt = pt.matrixTransform(ctm.inverse());
    return [svgPt.x, svgPt.y];
  }, []);

  const round2 = (n) => Math.round(n * 100) / 100;

  // Drag clamp: allow vertices into the gutter area so off-screen vertices
  // can still be repositioned, but not past the editor's visible edge.
  const clamp = (val) =>
    Math.max(-EDIT_PADDING, Math.min(VIEWBOX_SIZE + EDIT_PADDING, val));

  // ---- Drag handlers ----

  const handlePointerDown = useCallback(
    (e, idx) => {
      e.preventDefault();
      e.stopPropagation();
      // Capture pointer so we get moves even outside the SVG.
      e.target.setPointerCapture(e.pointerId);
      setDraggingIdx(idx);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (draggingIdx !== null) {
        const [x, y] = clientToSvg(e.clientX, e.clientY);
        const next = vertices.map((v, i) =>
          i === draggingIdx ? [round2(clamp(x)), round2(clamp(y))] : v
        );
        onChange(next);
        return;
      }
      if (shapeDrag) {
        // Translate every vertex by the delta from the grab point. Apply
        // to the START snapshot so small jitters don't accumulate.
        const [x, y] = clientToSvg(e.clientX, e.clientY);
        const dx = x - shapeDrag.startPos[0];
        const dy = y - shapeDrag.startPos[1];
        // No clamping on shape translation — otherwise the shape would
        // deform as vertices hit the edge at different times. User can
        // re-center with Snap to bounds if it ends up out of range.
        const next = shapeDrag.startVerts.map(([vx, vy]) => [
          round2(vx + dx),
          round2(vy + dy),
        ]);
        onChange(next);
      }
    },
    [draggingIdx, shapeDrag, vertices, onChange, clientToSvg]
  );

  const handlePointerUp = useCallback(() => {
    setDraggingIdx(null);
    setShapeDrag(null);
  }, []);

  // Shape-drag pointer-down on the polygon fill. Ignored if the user is
  // already dragging a vertex (those handlers stopPropagation, so this
  // only fires on clicks in the polygon interior away from any handle).
  const handleShapePointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.target.setPointerCapture(e.pointerId);
      const [x, y] = clientToSvg(e.clientX, e.clientY);
      setShapeDrag({ startPos: [x, y], startVerts: vertices.map((v) => [...v]) });
    },
    [vertices, clientToSvg]
  );

  // ---- Add vertex ----
  // Insert a new vertex at the midpoint of edge (i, i+1).

  const handleAddVertex = useCallback(
    (edgeIdx) => {
      if (atMax) return;
      const a = vertices[edgeIdx];
      const b = vertices[(edgeIdx + 1) % vertices.length];
      const mid = [round2((a[0] + b[0]) / 2), round2((a[1] + b[1]) / 2)];
      const next = [...vertices];
      next.splice(edgeIdx + 1, 0, mid);
      onChange(next);
    },
    [vertices, onChange, atMax]
  );

  // ---- Remove vertex ----

  const handleRemoveVertex = useCallback(
    (idx) => {
      if (atMin) return;
      const next = vertices.filter((_, i) => i !== idx);
      onChange(next);
    },
    [vertices, onChange, atMin]
  );

  // ---- Render ----

  // Edge midpoints (the green "+" handles).
  const midpoints = [];
  if (!atMax) {
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      midpoints.push({
        x: (a[0] + b[0]) / 2,
        y: (a[1] + b[1]) / 2,
        edgeIdx: i,
      });
    }
  }

  const polygonPoints = vertices.map((v) => v.join(",")).join(" ");

  return (
    <svg
      ref={svgRef}
      viewBox={`${-EDIT_PADDING} ${-EDIT_PADDING} ${EXPANDED_SIZE} ${EXPANDED_SIZE}`}
      style={{
        position: "absolute",
        left: `${OFFSET_PCT}%`,
        top: `${OFFSET_PCT}%`,
        width: `${SIZE_PCT}%`,
        height: `${SIZE_PCT}%`,
        cursor: draggingIdx !== null ? "grabbing" : "default",
        touchAction: "none",
        overflow: "visible",
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Reference rectangle marking the icon's 0–64 bounds. Vertices
          outside this rectangle are in the gutter and should be moved
          back inside (or the user can save them off-screen intentionally). */}
      <rect
        x={0}
        y={0}
        width={VIEWBOX_SIZE}
        height={VIEWBOX_SIZE}
        fill="none"
        stroke="var(--color-border-secondary, #cbd5e1)"
        strokeWidth={0.4}
        strokeDasharray="1 1"
        pointerEvents="none"
      />

      {/* Polygon fill + outline. The fill is the grab target for
          shape translation — clicking in the polygon interior and
          dragging moves every vertex together. */}
      <polygon
        points={polygonPoints}
        fill={COLOR_FILL}
        stroke={isConvex ? COLOR_STROKE : COLOR_STROKE_CONCAVE}
        strokeWidth={0.8}
        strokeDasharray={isConvex ? "2 1" : "1.5 1"}
        onPointerDown={handleShapePointerDown}
        style={{ cursor: shapeDrag ? "grabbing" : "move" }}
      />

      {/* Edge midpoint "add" handles */}
      {midpoints.map((mp) => (
        <g
          key={`mid-${mp.edgeIdx}`}
          style={{ cursor: "pointer" }}
          onClick={() => handleAddVertex(mp.edgeIdx)}
        >
          <circle
            cx={mp.x}
            cy={mp.y}
            r={MIDPOINT_R + 1}
            fill="transparent"
          />
          <circle
            cx={mp.x}
            cy={mp.y}
            r={MIDPOINT_R}
            fill="white"
            stroke={COLOR_MIDPOINT}
            strokeWidth={0.5}
          />
          <text
            x={mp.x}
            y={mp.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={COLOR_MIDPOINT}
            fontSize={3}
            fontWeight="bold"
            style={{ pointerEvents: "none" }}
          >
            +
          </text>
        </g>
      ))}

      {/* Vertex handles */}
      {vertices.map(([vx, vy], idx) => {
        const isDragging = draggingIdx === idx;
        return (
          <g key={`v-${idx}`}>
            {/* Larger transparent hit area for easier grabbing */}
            <circle
              cx={vx}
              cy={vy}
              r={VERTEX_HIT_R}
              fill="transparent"
              style={{ cursor: isDragging ? "grabbing" : "grab" }}
              onPointerDown={(e) => handlePointerDown(e, idx)}
            />
            {/* Visible vertex circle */}
            <circle
              cx={vx}
              cy={vy}
              r={VERTEX_R}
              fill={isDragging ? COLOR_VERTEX_DRAG : COLOR_VERTEX}
              stroke="white"
              strokeWidth={0.5}
              style={{ pointerEvents: "none" }}
            />
            {/* Vertex index label */}
            <text
              x={vx}
              y={vy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={2.4}
              fontWeight="bold"
              style={{ pointerEvents: "none" }}
            >
              {idx}
            </text>

            {/* Red × remove badge — shown when polygon has >3 vertices */}
            {!atMin && (
              <g
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveVertex(idx);
                }}
              >
                <circle
                  cx={vx + REMOVE_OFFSET}
                  cy={vy - REMOVE_OFFSET}
                  r={REMOVE_R + 0.8}
                  fill="transparent"
                />
                <circle
                  cx={vx + REMOVE_OFFSET}
                  cy={vy - REMOVE_OFFSET}
                  r={REMOVE_R}
                  fill={COLOR_REMOVE}
                  stroke="white"
                  strokeWidth={0.4}
                />
                <text
                  x={vx + REMOVE_OFFSET}
                  y={vy - REMOVE_OFFSET}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={2.2}
                  fontWeight="bold"
                  style={{ pointerEvents: "none" }}
                >
                  &times;
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
