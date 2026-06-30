import { useCallback, useRef, useState } from "react";
import { parseViewBox, getColliderBounds } from "../lib/svgGeometry.js";
import {
  validateCollider,
  isConvexPolygon,
  isSimplePolygon,
  planckReadiness,
  MAX_CONVEX_VERTICES,
} from "../lib/colliderSchema.js";
import {
  computeConcaveOutline,
  computeSilhouetteOutline,
} from "../lib/colliderGenerator.js";
import ColliderPreview from "./ColliderPreview.jsx";
import GeometryInfo from "./GeometryInfo.jsx";

// Large, grid-backed "ground truth" view of one SVG + its collider, with
// Phase 2 IN-PLACE polygon editing.
//
// Three layers share the SAME coordinate space, stacked in a box whose aspect
// ratio matches that space — so they align pixel-for-pixel with NO letterboxing:
//   1. the icon (bottom)        — .svg-preview-host forces it to fill its rect
//   2. the coordinate grid      — faint lines every 8 units, labels every 16
//   3. the collider overlay     — read-only ColliderPreview, OR (when editing)
//                                 an interactive vertex editor in that space
//
// REVEAL out-of-bounds colliders: when a collider's vertices fall outside the
// SVG's 0–W / 0–H viewBox (a common data defect — vertices below the viewBox),
// the coordinate space EXPANDS to include them with a gutter, rather than
// clipping at the edge. The icon stays anchored to its real [0,0,W,H] rect,
// the 0–W/0–H boundary is drawn, off-bounds vertices are marked red, and a
// warning quantifies the overflow. This is the whole point of an audit surface.
//
// EDITING (Phase 2, polygon/convex only): "Edit collider" drops into a draft
// where vertices can be dragged (including off-canvas ones, back onto the art),
// added, removed, or pulled in-bounds en masse. The edit canvas is a FIXED
// generous space computed on entry so the grid doesn't rescale mid-drag and
// every vertex stays reachable. Save writes through updatePhysicalProperties
// (merges, so mass/length/width are preserved) — durable, and in the same
// viewBox coordinate space GIST scales from. Circle/box/compound stay
// read-only this phase.
//
// Edit state is reset by REMOUNTING (the parent passes key={item.id}), so there
// is no item-change effect to keep in sync.

const TARGET = 420; // px on the longer display axis
const STEP = 8; // minor gridline spacing (viewBox units)
const MAJOR = 16; // labelled / darker gridline spacing
const GUTTER = 3; // units of breathing room when expanding for out-of-bounds
const EDIT_MARGIN = 12; // fixed generous canvas margin (units) while editing

const headerBtnStyle = {
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 12px",
  borderRadius: "var(--border-radius-md)",
  border: "0.5px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)",
  cursor: "pointer",
};

export default function ColliderGroundTruth({
  item,
  onSaveCollider,
  onDownload,
  showToast,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // editable collider clone
  const [editSpace, setEditSpace] = useState(null); // fixed canvas while editing
  const [saving, setSaving] = useState(false);

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

  const storedCollider = item.effectivePhysicalProperties?.collider ?? null;
  const inherited = item.parentId != null;
  const collider = editing ? draft : storedCollider;

  // Phase 2 edits polygons only.
  const editable = storedCollider?.type === "convex";

  const colBounds = collider ? getColliderBounds(collider) : null;

  // Does the (possibly draft) collider spill past the icon's viewBox?
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

  // Active coordinate space. While editing it's the fixed editSpace (stable,
  // everything reachable); read-only it expands dynamically to reveal overflow.
  const space =
    editing && editSpace ? editSpace : dynamicSpace(colBounds, isOob, W, H);
  const { minX, minY, maxX, maxY } = space;
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

  // ---- edit lifecycle ----

  // Fixed generous canvas that contains the icon AND a (possibly off-canvas)
  // collider, with margin, so the grid doesn't rescale mid-edit.
  function editSpaceFor(bounds) {
    return {
      minX: Math.min(0, bounds?.min[0] ?? 0) - EDIT_MARGIN,
      minY: Math.min(0, bounds?.min[1] ?? 0) - EDIT_MARGIN,
      maxX: Math.max(W, bounds?.max[0] ?? W) + EDIT_MARGIN,
      maxY: Math.max(H, bounds?.max[1] ?? H) + EDIT_MARGIN,
    };
  }

  function enterEdit() {
    setDraft(JSON.parse(JSON.stringify(storedCollider)));
    setEditSpace(editSpaceFor(getColliderBounds(storedCollider)));
    setEditing(true);
  }

  // Task 12 spike: trace an ordered concave outline from the SVG and drop it
  // straight into the edit UI for review. Save (if it validates as a simple
  // ring) writes it through onSaveCollider like any hand edit.
  function traceOutline() {
    const { collider: traced, debug } = computeConcaveOutline(item.svg);
    if (!traced) {
      showToast?.(`Couldn't trace an outline (${debug?.error ?? "no geometry"}).`);
      return;
    }
    setDraft(traced);
    setEditSpace(editSpaceFor(getColliderBounds(traced)));
    setEditing(true);
    const sub = debug.subpaths > 1 ? `, ${debug.subpaths} subpaths ⚠` : "";
    const rd = planckReadiness(traced);
    showToast?.(
      rd.level === "fail"
        ? `${rd.message} (path trace is the wrong tool for a convex shape — try circle or hull)`
        : `Traced ${traced.vertices.length} verts from <${debug.chosenTag}> (${debug.sampledPoints} samples${sub}) — review & Save`
    );
  }

  // Task 12: raster silhouette trace — captures the whole concave outer
  // boundary of a multi-shape sprite (arms and all) by tracing the rendered
  // alpha blob, then drops it into the edit UI like a hand edit. Async (the
  // SVG renders to canvas via an Image load).
  async function traceSilhouette() {
    try {
      const { collider: traced, debug } = await computeSilhouetteOutline(item.svg);
      if (!traced) {
        showToast?.(`Couldn't trace silhouette (${debug?.error ?? "no geometry"}).`);
        return;
      }
      setDraft(traced);
      setEditSpace(editSpaceFor(getColliderBounds(traced)));
      setEditing(true);
      const parts = debug.components > 1 ? `${debug.components} parts → 1 blob, ` : "";
      const rd = planckReadiness(traced);
      showToast?.(
        rd.level === "fail"
          ? `${rd.message} (silhouette is the wrong tool for a convex blob — try circle or ≤${MAX_CONVEX_VERTICES} hull)`
          : `Silhouette: ${traced.vertices.length} verts (${parts}${debug.contourPixels} contour px) — review & Save`
      );
    } catch (e) {
      showToast?.(`Silhouette trace failed: ${e?.message ?? e}`);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
    setEditSpace(null);
  }

  const setVertices = (verts) => setDraft((d) => ({ ...d, vertices: verts }));

  function pullInBounds() {
    setVertices(
      draft.vertices.map(([x, y]) => [
        round2(Math.max(0, Math.min(W, x))),
        round2(Math.max(0, Math.min(H, y))),
      ])
    );
  }

  async function save() {
    const check = validateCollider(draft);
    if (!check.valid) {
      showToast?.(check.error);
      return;
    }
    setSaving(true);
    try {
      await onSaveCollider(item.id, draft);
      showToast?.("Collider saved");
      cancelEdit();
    } catch (e) {
      showToast?.(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    editing && JSON.stringify(draft) !== JSON.stringify(storedCollider);

  // Convexity decides which validity rule binds. A genuinely-convex polygon is
  // consumed by Planck directly, so the 8-vertex cap is a hard gate. A concave
  // outline is decomposed downstream by gist into ≤8-vertex parts, so the cap
  // is NOT ours to enforce — it only has to be a simple (non-self-intersecting)
  // closed ring. (Mirrors validateConvex; keep the two in sync.)
  const polyVerts =
    collider?.type === "convex" ? collider.vertices ?? [] : null;
  const convexPoly = polyVerts != null && isConvexPolygon(polyVerts);
  const concave = polyVerts != null && !convexPoly;
  const planckCapViolated =
    convexPoly && polyVerts.length > MAX_CONVEX_VERTICES;
  const selfIntersects = concave && !isSimplePolygon(polyVerts);

  return (
    <div>
      <div
        style={{
          marginBottom: 8,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{item.label}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            {item.id} · collider: {collider ? colliderSummary(collider) : "none"}
            {inherited && collider ? ` · inherited from ${item.parentId}` : ""}
          </div>
        </div>
        {!editing && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={traceOutline}
              title="Auto-fit: trace one dominant filled path (native path sampling). Best for single-path concave shapes like a cup."
              style={headerBtnStyle}
            >
              ⬡ Trace path
            </button>
            <button
              onClick={traceSilhouette}
              title="Auto-fit: trace the whole rendered silhouette (raster blob). Best for multi-shape sprites like a cactus — arms and all."
              style={headerBtnStyle}
            >
              ▦ Trace silhouette
            </button>
            {editable && (
              <button onClick={enterEdit} style={headerBtnStyle}>
                Edit collider
              </button>
            )}
            {onDownload && (
              <button
                onClick={() => onDownload(item)}
                title="Download this SVG + a single manifest entry to drop into gist for a quick sim test"
                style={headerBtnStyle}
              >
                ↓ Download
              </button>
            )}
          </div>
        )}
      </div>

      {collider && <PlanckVerdict collider={collider} />}

      {!editing && storedCollider && !editable && (
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
          Editing {storedCollider.type} colliders isn’t supported yet — this
          phase edits polygons only.
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

        {/* Layer 3 — collider overlay: interactive editor when editing, else
            the static preview + out-of-bounds vertex markers */}
        {editing && draft?.type === "convex" ? (
          <PolygonEditLayer
            vertices={draft.vertices}
            onChange={setVertices}
            space={space}
            vbWidth={W}
            vbHeight={H}
          />
        ) : (
          collider && (
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
          )
        )}
      </div>

      {/* Out-of-bounds warning lives BELOW the canvas so toggling it (e.g. as a
          vertex is dragged past the edge) never reflows the icon/grid/handles —
          the canvas stays anchored; only the toolbar/readout below shift. */}
      {isOob && (
        <div
          style={{
            padding: "6px 10px",
            borderRadius: "var(--border-radius-md)",
            background: "#FEF3C7",
            color: "#92400E",
            fontSize: 11,
            marginTop: 8,
            lineHeight: 1.4,
          }}
        >
          <strong>Collider extends beyond the {W}×{H} viewBox:</strong>{" "}
          {overflowMessage(overflow, W, H)}. Vertices in red are off-canvas —
          GIST scales the collider to the object bbox, so these misalign with the
          art.{" "}
          {editing
            ? "Drag them onto the art or use “Pull in-bounds”."
            : "Likely a bad collider to fix — click “Edit collider”."}
        </div>
      )}

      {editing && (
        <EditToolbar
          dirty={dirty}
          saving={saving}
          isOob={isOob}
          concave={concave}
          planckCapViolated={planckCapViolated}
          selfIntersects={selfIntersects}
          vertCount={draft?.vertices?.length ?? 0}
          onPullInBounds={pullInBounds}
          onSave={save}
          onCancel={cancelEdit}
        />
      )}

      <div style={{ marginTop: 8 }}>
        <GeometryInfo svg={item.svg} collider={collider} />
      </div>

      <ColliderReadout collider={collider} vbWidth={W} vbHeight={H} />
    </div>
  );
}

// Read-only coordinate space: exactly the viewBox when in-bounds, expanded
// with a gutter when the collider overflows so off-canvas vertices show.
function dynamicSpace(colBounds, isOob, W, H) {
  if (!isOob || !colBounds) return { minX: 0, minY: 0, maxX: W, maxY: H };
  return {
    minX: Math.min(0, colBounds.min[0]) - GUTTER,
    minY: Math.min(0, colBounds.min[1]) - GUTTER,
    maxX: Math.max(W, colBounds.max[0]) + GUTTER,
    maxY: Math.max(H, colBounds.max[1]) + GUTTER,
  };
}

// Interactive polygon editor laid over the icon/grid, in the SAME coordinate
// space (so it aligns pixel-for-pixel). Unlike the legacy ColliderEditor this
// takes its viewBox from `space` rather than hardcoding 64×64 — which is what
// lets it reach and reposition vertices that sit far outside the icon bounds.
//
// Mouse → viewBox-unit conversion uses getScreenCTM().inverse(), which accounts
// for the box's actual rendered size and the viewBox transform automatically.
// The root <svg> is pointer-transparent; only the handles capture events, so
// the polygon interior never swallows clicks.
function PolygonEditLayer({ vertices, onChange, space, vbWidth, vbHeight }) {
  const svgRef = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);

  const { minX, minY, maxX, maxY } = space;
  const EW = maxX - minX;
  const EH = maxY - minY;
  const maxDim = Math.max(EW, EH);

  // The 8-vertex cap only binds while the polygon is genuinely convex (Planck
  // eats it directly). Once it's a concave outline, gist decomposes it
  // downstream, so adding vertices past 8 is allowed.
  const convex = isConvexPolygon(vertices);
  const atMax = convex && vertices.length >= MAX_CONVEX_VERTICES;
  const atMin = vertices.length <= 3;

  // Handle sizes scale with zoom so they stay a consistent on-screen size.
  const vertR = maxDim / 38;
  const hitR = maxDim / 20;
  const midR = maxDim / 52;
  const labelFont = maxDim / 34;

  const clientToSvg = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }, []);

  // Keep handles on the canvas, but allow the full edit space (incl. gutter)
  // so off-canvas vertices remain draggable.
  const clampToSpace = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const handlePointerMove = useCallback(
    (e) => {
      if (dragIdx === null) return;
      const [x, y] = clientToSvg(e.clientX, e.clientY);
      const next = vertices.map((v, i) =>
        i === dragIdx
          ? [
              round2(clampToSpace(x, minX, maxX)),
              round2(clampToSpace(y, minY, maxY)),
            ]
          : v
      );
      onChange(next);
    },
    [dragIdx, vertices, onChange, clientToSvg, minX, minY, maxX, maxY]
  );

  const handlePointerUp = useCallback(() => setDragIdx(null), []);

  const handlePointerDown = useCallback((e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    setDragIdx(idx);
  }, []);

  const addVertex = useCallback(
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

  const removeVertex = useCallback(
    (idx) => {
      if (atMin) return;
      onChange(vertices.filter((_, i) => i !== idx));
    },
    [vertices, onChange, atMin]
  );

  const midpoints = atMax
    ? []
    : vertices.map((a, i) => {
        const b = vertices[(i + 1) % vertices.length];
        return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, edgeIdx: i };
      });

  const points = vertices.map((v) => v.join(",")).join(" ");

  return (
    <svg
      ref={svgRef}
      viewBox={`${minX} ${minY} ${EW} ${EH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none", // only handles below opt back in
        overflow: "visible",
        touchAction: "none",
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <polygon
        points={points}
        fill="rgba(59, 130, 246, 0.12)"
        stroke={convex ? "#3B82F6" : "#F59E0B"}
        strokeWidth={maxDim / 150}
        strokeDasharray={`${maxDim / 40} ${maxDim / 80}`}
      />

      {/* Edge "+" midpoints */}
      {midpoints.map((mp) => (
        <g
          key={`mid-${mp.edgeIdx}`}
          style={{ cursor: "pointer", pointerEvents: "auto" }}
          onClick={() => addVertex(mp.edgeIdx)}
        >
          <circle cx={mp.x} cy={mp.y} r={hitR * 0.6} fill="transparent" />
          <circle
            cx={mp.x}
            cy={mp.y}
            r={midR}
            fill="white"
            stroke="#10B981"
            strokeWidth={maxDim / 250}
          />
          <text
            x={mp.x}
            y={mp.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#10B981"
            fontSize={labelFont}
            fontWeight="bold"
            style={{ pointerEvents: "none" }}
          >
            +
          </text>
        </g>
      ))}

      {/* Vertex handles */}
      {vertices.map(([vx, vy], idx) => {
        const dragging = dragIdx === idx;
        const oobVert = vx < 0 || vy < 0 || vx > vbWidth || vy > vbHeight;
        const fill = dragging
          ? "#1D4ED8"
          : oobVert
          ? "#EF4444"
          : "#3B82F6";
        return (
          <g key={`v-${idx}`}>
            <circle
              cx={vx}
              cy={vy}
              r={hitR}
              fill="transparent"
              style={{
                cursor: dragging ? "grabbing" : "grab",
                pointerEvents: "auto",
              }}
              onPointerDown={(e) => handlePointerDown(e, idx)}
            />
            <circle
              cx={vx}
              cy={vy}
              r={vertR}
              fill={fill}
              stroke="white"
              strokeWidth={maxDim / 250}
              style={{ pointerEvents: "none" }}
            />
            <text
              x={vx}
              y={vy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={labelFont * 0.8}
              fontWeight="bold"
              style={{ pointerEvents: "none" }}
            >
              {idx}
            </text>
            {!atMin && (
              <g
                style={{ cursor: "pointer", pointerEvents: "auto" }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeVertex(idx);
                }}
              >
                <circle
                  cx={vx + vertR * 1.4}
                  cy={vy - vertR * 1.4}
                  r={midR * 1.2}
                  fill="#EF4444"
                  stroke="white"
                  strokeWidth={maxDim / 300}
                />
                <text
                  x={vx + vertR * 1.4}
                  y={vy - vertR * 1.4}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={labelFont * 0.75}
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

// Buttons + live validation while editing a polygon collider.
function EditToolbar({
  dirty,
  saving,
  isOob,
  concave,
  planckCapViolated,
  selfIntersects,
  vertCount,
  onPullInBounds,
  onSave,
  onCancel,
}) {
  const blocked = planckCapViolated || selfIntersects;
  const saveDisabled = !dirty || saving || blocked;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={onSave}
          disabled={saveDisabled}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "6px 14px",
            borderRadius: "var(--border-radius-md)",
            border: "none",
            background: saveDisabled
              ? "var(--color-border-secondary)"
              : "var(--color-text-info, #2563EB)",
            color: "white",
            cursor: saveDisabled ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save collider"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            fontSize: 12,
            padding: "6px 12px",
            borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-secondary)",
            background: "var(--color-background-primary)",
            cursor: saving ? "default" : "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onPullInBounds}
          disabled={!isOob || saving}
          title="Clamp every vertex into the 0–W / 0–H viewBox"
          style={{
            fontSize: 12,
            padding: "6px 12px",
            borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-secondary)",
            background: "var(--color-background-primary)",
            color: isOob ? undefined : "var(--color-text-tertiary)",
            cursor: !isOob || saving ? "default" : "pointer",
          }}
        >
          Pull in-bounds
        </button>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {vertCount} vertices · drag to move · “+” adds · red × removes
        </span>
      </div>

      {planckCapViolated && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#B45309" }}>
          {vertCount} vertices exceeds the {MAX_CONVEX_VERTICES}-vertex Planck.js
          limit for a <em>convex</em> polygon. Remove vertices, or reshape into a
          concave outline — those are decomposed downstream and aren’t capped.
        </div>
      )}
      {selfIntersects && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#B45309" }}>
          Outline self-intersects — it must be a simple closed ring before saving
          (gist can only decompose a non-self-intersecting polygon).
        </div>
      )}
      {concave && !planckCapViolated && !selfIntersects && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#92400E" }}>
          Concave outline — allowed; GIST decomposes it into ≤{MAX_CONVEX_VERTICES}
          -vertex parts at load (no convex vertex cap here).
        </div>
      )}
    </div>
  );
}

// Authoring-time Planck-readiness verdict (see planckReadiness in
// colliderSchema). Dev-side guidance so we don't ship Planck-hostile colliders;
// the AUTHORITATIVE post-decomposition check lives in gist's dev build (this
// repo can't run poly-decomp). See Dev_Tasks.md → Task 12.
function PlanckVerdict({ collider }) {
  const { level, message } = planckReadiness(collider);
  const palette =
    {
      ok: { bg: "#DCFCE7", fg: "#166534", icon: "✓" },
      warn: { bg: "#FEF3C7", fg: "#92400E", icon: "⚠" },
      fail: { bg: "#FEE2E2", fg: "#991B1B", icon: "✖" },
    }[level] ?? { bg: "#F1F5F9", fg: "#475569", icon: "·" };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        padding: "5px 10px",
        borderRadius: "var(--border-radius-md)",
        background: palette.bg,
        color: palette.fg,
        fontSize: 11,
        marginBottom: 8,
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontWeight: 700, flexShrink: 0 }}>{palette.icon} Planck</span>
      <span>{message}</span>
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
        No collider on this item yet. Generation arrives in a later phase.
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
            {r.oob ? "⚠ " : "  "}
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
