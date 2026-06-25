import { useState } from "react";
import { isConvexPolygon } from "../lib/colliderSchema.js";
import ColliderGroundTruth from "./ColliderGroundTruth.jsx";

// Collider Lab — a dedicated audit/triage surface for colliders, decoupled
// from DetailModal. Phase 1 is READ-ONLY: see "like" SVGs grouped by collider
// shape, select one, and ground-truth its collider against a coordinate grid.
// Editing, polygon generation, and the pill editor land in later phases.
//
// Children are intentionally excluded — they inherit physical_properties from
// their parent, so editing them is meaningless (writes target the parent).

// A "facet" buckets lab items into ordered groups. Phase 1 ships the
// collider-shape facet; Bill's physics-perspective facets slot in later as
// additional facet objects — the grouping logic below consumes ANY facet,
// so adding one needs no rewrite (just a facet picker when there's >1).
const SHAPE_FACET = {
  id: "shape",
  label: "Collider shape",
  groups: [
    { key: "circle", label: "Circle" },
    { key: "box", label: "Box" },
    { key: "convex", label: "Polygon" },
    { key: "compound", label: "Compound" },
    { key: "none", label: "No collider" },
  ],
  bucketOf(item) {
    const c = item.effectivePhysicalProperties?.collider;
    if (!c) return "none";
    if (["circle", "box", "convex", "compound"].includes(c.type)) return c.type;
    return "none";
  },
};

// A "convex"-typed collider whose vertices are actually concave — i.e. a
// closed outline gist will decompose downstream into a compound. Flagged with
// a badge so containers (cups, wagons) are spottable inside the polygon group.
function isConcaveOutline(item) {
  const c = item.effectivePhysicalProperties?.collider;
  return (
    c?.type === "convex" &&
    Array.isArray(c.vertices) &&
    !isConvexPolygon(c.vertices)
  );
}

export default function ColliderLab({ items }) {
  const [selectedId, setSelectedId] = useState(null);

  // Parents + standalones only; skip idea_only concepts (no real renderable).
  const labItems = (items ?? []).filter(
    (it) => !it.parentId && it.status !== "idea_only"
  );

  const facet = SHAPE_FACET;
  const groups = facet.groups
    .map((g) => ({
      ...g,
      items: labItems.filter((it) => facet.bucketOf(it) === g.key),
    }))
    .filter((g) => g.items.length > 0);

  const selected = labItems.find((it) => it.id === selectedId) ?? null;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 2px" }}>
          Collider Lab
        </h2>
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          {labItems.length} items · grouped by {facet.label.toLowerCase()} ·
          color variants inherit from their parent and are hidden here
        </div>
      </div>

      {labItems.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem 1rem",
            color: "var(--color-text-tertiary)",
            fontSize: 14,
          }}
        >
          No items to inspect.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Left — grouped triage list */}
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            {groups.map((g) => (
              <div key={g.key} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                    marginBottom: 6,
                  }}
                >
                  {g.label}{" "}
                  <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>
                    ({g.items.length})
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(66px, 1fr))",
                    gap: 6,
                  }}
                >
                  {g.items.map((it) => (
                    <LabCard
                      key={it.id}
                      item={it}
                      selected={it.id === selectedId}
                      concave={isConcaveOutline(it)}
                      onClick={() => setSelectedId(it.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Right — ground-truth grid view of the selected item */}
          <div
            style={{
              flex: "1 1 440px",
              minWidth: 320,
              position: "sticky",
              top: 12,
            }}
          >
            <ColliderGroundTruth item={selected} />
          </div>
        </div>
      )}
    </div>
  );
}

function LabCard({ item, selected, concave, onClick }) {
  return (
    <div
      onClick={onClick}
      title={item.id}
      style={{
        position: "relative",
        border: selected
          ? "2px solid var(--color-text-info)"
          : "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
        padding: 6,
        cursor: "pointer",
        textAlign: "center",
        background: "var(--color-background-primary)",
      }}
    >
      <div
        className="svg-preview-host"
        dangerouslySetInnerHTML={{ __html: item.svg }}
        style={{ width: 48, height: 48, margin: "0 auto 4px" }}
      />
      <div
        style={{
          fontSize: 10,
          color: "var(--color-text-secondary)",
          lineHeight: 1.2,
          wordBreak: "break-word",
        }}
      >
        {item.label}
      </div>
      {concave && (
        <span
          title="Concave outline — gist decomposes this into a compound at load"
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            fontSize: 8,
            fontWeight: 600,
            padding: "1px 4px",
            borderRadius: 4,
            background: "#FEF3C7",
            color: "#92400E",
          }}
        >
          concave
        </span>
      )}
    </div>
  );
}
