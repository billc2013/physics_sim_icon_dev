import { useState } from "react";
import { isConvexPolygon, planckReadiness } from "../lib/colliderSchema.js";
import { STATUSES, STATUS_CONFIG } from "../lib/constants.js";
import ColliderGroundTruth from "./ColliderGroundTruth.jsx";

// Statuses the Lab can filter by. idea_only is excluded everywhere in the Lab
// (no renderable), so it's not offered as a filter either.
const LAB_STATUSES = STATUSES.filter((s) => s !== "idea_only");

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

// Planck-readiness level for an item's collider, or null if it has none (a
// "No collider" item isn't a Planck problem, just untriaged). "warn"/"fail"
// drive a triage badge so Planck-risky colliders are spottable in the list.
function planckLevel(item) {
  const c = item.effectivePhysicalProperties?.collider;
  if (!c) return null;
  return planckReadiness(c).level;
}

export default function ColliderLab({
  items,
  initialSelectedId,
  onSaveCollider,
  onSetStatus,
  onDownload,
  showToast,
}) {
  // Seed selection from the id App hands us when arriving via DetailModal's
  // "Edit in Collider Lab" link. Read once on mount — the Lab remounts on
  // each tab switch, so this captures the latest focus id each time.
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? null);

  // Status filter — same solo behavior as the SVG Manager's FilterBar
  // (click one when all shown → solo it; click the soloed one → restore all).
  const [statusFilter, setStatusFilter] = useState(new Set(LAB_STATUSES));
  const [moving, setMoving] = useState(false);

  // Parents + standalones only; skip idea_only concepts (no real renderable).
  const allLabItems = (items ?? []).filter(
    (it) => !it.parentId && it.status !== "idea_only"
  );

  // The ✖P bulk-move target is computed from the FULL set, not the filtered
  // view — "move all ✖P" must not silently miss items hidden by the filter.
  // Already-fix items are excluded so re-running the button is a no-op.
  const failSet = allLabItems.filter(
    (it) => it.status !== "fix" && planckLevel(it) === "fail"
  );

  const labItems = allLabItems.filter((it) => statusFilter.has(it.status));

  const toggleStatus = (status) =>
    setStatusFilter((prev) => {
      if (prev.size === LAB_STATUSES.length) return new Set([status]);
      if (prev.size === 1 && prev.has(status)) return new Set(LAB_STATUSES);
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next.size === 0 ? new Set(LAB_STATUSES) : next;
    });

  const handleBulkMoveToFix = async () => {
    if (!onSetStatus || failSet.length === 0 || moving) return;
    // Breakdown by current status so sweeping in-progress items is never a
    // surprise (a repaired draft should go back to draft, not silently ship).
    const byStatus = failSet.reduce((acc, it) => {
      acc[it.status] = (acc[it.status] || 0) + 1;
      return acc;
    }, {});
    const breakdown = LAB_STATUSES.filter((s) => byStatus[s])
      .map((s) => `${byStatus[s]} ${STATUS_CONFIG[s].label.toLowerCase()}`)
      .join(", ");
    const ok = window.confirm(
      `Move ${failSet.length} item${failSet.length === 1 ? "" : "s"} to Fix ` +
        `(${breakdown})?\n\n` +
        `These colliders exceed Planck's 12-vertex cap. Fix items drop out of ` +
        `the approved/export set until repaired. Return them via each item's ` +
        `status control once the Lab verdict is green.`
    );
    if (!ok) return;
    setMoving(true);
    let moved = 0;
    try {
      for (const it of failSet) {
        await onSetStatus(it.id, "fix");
        moved += 1;
      }
      showToast?.(`Moved ${moved} to Fix`);
    } catch {
      showToast?.(
        moved > 0
          ? `Moved ${moved} of ${failSet.length} to Fix — the rest failed`
          : "Move to Fix failed"
      );
    } finally {
      setMoving(false);
    }
  };

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
          {labItems.length} of {allLabItems.length} items · grouped by{" "}
          {facet.label.toLowerCase()} · color variants inherit from their parent
          and are hidden here
        </div>
      </div>

      {/* Status filter row + ✖P bulk-move-to-fix */}
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginRight: 2 }}
        >
          Status:
        </span>
        {LAB_STATUSES.map((status) => {
          const config = STATUS_CONFIG[status];
          const isOn = statusFilter.has(status);
          const isSolo = statusFilter.size === 1 && isOn;
          const count = allLabItems.filter((it) => it.status === status).length;
          return (
            <button
              key={status}
              onClick={() => toggleStatus(status)}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: "var(--border-radius-md)",
                cursor: "pointer",
                background: isOn ? config.bg : "transparent",
                color: isOn ? config.dk : "var(--color-text-tertiary)",
                border: isSolo
                  ? `2px solid ${config.c}`
                  : isOn
                  ? `0.5px solid ${config.c}40`
                  : "0.5px solid var(--color-border-tertiary)",
                fontWeight: isOn ? 500 : 400,
              }}
            >
              {config.label} ({count})
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button
          onClick={handleBulkMoveToFix}
          disabled={failSet.length === 0 || moving}
          title="Move every collider that exceeds Planck's 12-vertex cap (✖P) into the Fix status, pulling it out of the export set"
          style={{
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: "var(--border-radius-md)",
            cursor: failSet.length === 0 || moving ? "default" : "pointer",
            background: failSet.length === 0 ? "transparent" : STATUS_CONFIG.fix.bg,
            color:
              failSet.length === 0
                ? "var(--color-text-tertiary)"
                : STATUS_CONFIG.fix.dk,
            border:
              failSet.length === 0
                ? "0.5px solid var(--color-border-tertiary)"
                : `0.5px solid ${STATUS_CONFIG.fix.c}`,
            fontWeight: 500,
            opacity: moving ? 0.6 : 1,
          }}
        >
          {moving ? "Moving…" : `Move all ✖P → Fix (${failSet.length})`}
        </button>
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
          {allLabItems.length === 0
            ? "No items to inspect."
            : "No items match the status filter."}
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
                      planck={planckLevel(it)}
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
            <ColliderGroundTruth
              key={selected?.id ?? "none"}
              item={selected}
              onSaveCollider={onSaveCollider}
              onDownload={onDownload}
              showToast={showToast}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LabCard({ item, selected, concave, planck, onClick }) {
  const planckBadge =
    planck === "fail"
      ? { bg: "#FEE2E2", fg: "#991B1B", text: "✖P", title: "Exceeds Planck's 12-vertex cap — decomposition won't reduce it below 12" }
      : planck === "warn"
      ? { bg: "#FEF3C7", fg: "#92400E", text: "⚠P", title: "No clean Planck verdict — self-intersecting or undecomposable outline; verify in gist's dev build" }
      : null;
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
      {planckBadge && (
        <span
          title={planckBadge.title}
          style={{
            position: "absolute",
            top: 3,
            left: 3,
            fontSize: 8,
            fontWeight: 700,
            padding: "1px 4px",
            borderRadius: 4,
            background: planckBadge.bg,
            color: planckBadge.fg,
          }}
        >
          {planckBadge.text}
        </span>
      )}
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
