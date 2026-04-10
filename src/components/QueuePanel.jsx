import { useState, useMemo } from "react";

// Queue review panel. Shows all generation jobs with status badges and
// per-type review UIs for completed jobs. Opened from the Header badge.
//
// Props:
//   jobs              Job[]
//   existingNames     Set<string>   for collision detection in batch/color reviews
//   onAcceptRevise    (job) => Promise<void>
//   onAcceptBatch     (job, selectedItems) => Promise<void>
//   onAcceptColors    (job, selectedItems) => Promise<void>
//   onDiscard         (jobId) => void
//   onRetry           (jobId) => void
//   onClose           () => void
export default function QueuePanel({
  jobs,
  existingNames,
  onAcceptRevise,
  onAcceptBatch,
  onAcceptColors,
  onDiscard,
  onRetry,
  onClose,
}) {
  const [expandedJobId, setExpandedJobId] = useState(null);

  if (jobs.length === 0) {
    return (
      <PanelShell onClose={onClose}>
        <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: 32 }}>
          No jobs in queue
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            expanded={expandedJobId === job.id}
            onToggle={() =>
              setExpandedJobId((prev) => (prev === job.id ? null : job.id))
            }
            existingNames={existingNames}
            onAcceptRevise={onAcceptRevise}
            onAcceptBatch={onAcceptBatch}
            onAcceptColors={onAcceptColors}
            onDiscard={onDiscard}
            onRetry={onRetry}
          />
        ))}
      </div>
    </PanelShell>
  );
}

function PanelShell({ onClose, children }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          border: "0.5px solid var(--color-border-secondary)",
          width: "100%",
          maxWidth: 700,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "1.25rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-primary)" }}>
            Generation queue
          </div>
          <button
            onClick={onClose}
            style={{ fontSize: 18, lineHeight: 1, padding: "2px 8px", color: "var(--color-text-secondary)" }}
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STATUS_BADGE = {
  queued: { label: "Queued", bg: "#E5E7EB", color: "#1F2937" },
  generating: { label: "Generating...", bg: "#DBEAFE", color: "#1E3A8A" },
  ready: { label: "Ready", bg: "#E1F5EE", color: "#085041" },
  error: { label: "Error", bg: "#FECACA", color: "#991B1B" },
};

function JobCard({
  job,
  expanded,
  onToggle,
  existingNames,
  onAcceptRevise,
  onAcceptBatch,
  onAcceptColors,
  onDiscard,
  onRetry,
}) {
  const badge = STATUS_BADGE[job.status];
  const canExpand = job.status === "ready" || job.status === "error";

  return (
    <div
      style={{
        borderRadius: "var(--border-radius-md)",
        border: "0.5px solid var(--color-border-tertiary)",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        onClick={canExpand ? onToggle : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          cursor: canExpand ? "pointer" : "default",
          background: expanded ? "var(--color-background-secondary)" : "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: "var(--border-radius-md)",
              background: badge.bg,
              color: badge.color,
              fontWeight: 500,
            }}
          >
            {badge.label}
          </span>
          <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>
            {job.label}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {job.status === "error" && (
            <button onClick={(e) => { e.stopPropagation(); onRetry(job.id); }} style={{ fontSize: 11 }}>
              Retry
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDiscard(job.id); }}
            style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}
          >
            {job.status === "ready" ? "Discard" : "Remove"}
          </button>
        </div>
      </div>

      {/* Expanded review area */}
      {expanded && job.status === "error" && (
        <div style={{ padding: "8px 12px" }}>
          <div
            style={{
              padding: "8px 10px",
              borderRadius: "var(--border-radius-md)",
              background: "#FECACA",
              color: "#991B1B",
              fontSize: 12,
            }}
          >
            {job.error?.message ?? String(job.error)}
          </div>
        </div>
      )}

      {expanded && job.status === "ready" && job.type === "revise" && (
        <ReviseReview job={job} onAccept={onAcceptRevise} />
      )}

      {expanded && job.status === "ready" && job.type === "batch_category" && (
        <BatchReview
          job={job}
          existingNames={existingNames}
          onAccept={(selectedItems) => onAcceptBatch(job, selectedItems)}
        />
      )}

      {expanded && job.status === "ready" && job.type === "batch_colors" && (
        <ColorReview
          job={job}
          existingNames={existingNames}
          onAccept={(selectedItems) => onAcceptColors(job, selectedItems)}
        />
      )}
    </div>
  );
}

// ---- Revise review ----
function ReviseReview({ job, onAccept }) {
  const [accepting, setAccepting] = useState(false);
  const svg = job.result?.svg;
  if (!svg) return null;

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await onAccept(job);
    } catch {
      setAccepting(false);
    }
  };

  return (
    <div style={{ padding: "8px 12px" }}>
      <div
        style={{
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-md)",
          padding: 16,
          textAlign: "center",
          marginBottom: 8,
        }}
      >
        <div
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{ width: 120, height: 120, margin: "0 auto" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {job.result.input_tokens}+{job.result.output_tokens} tokens
          &middot; ${job.result.cost_usd?.toFixed(4)}
        </span>
        <button
          onClick={handleAccept}
          disabled={accepting}
          style={{ fontSize: 12, fontWeight: 500 }}
        >
          {accepting ? "Saving..." : "Accept revision"}
        </button>
      </div>
    </div>
  );
}

// ---- Batch category review (cherry-pick grid) ----
function BatchReview({ job, existingNames, onAccept }) {
  const items = useMemo(() => job.result?.items ?? [], [job.result]);
  const itemsWithCollision = useMemo(
    () => items.map((item) => ({ ...item, collides: existingNames.has(item.name) })),
    [items, existingNames]
  );
  const [selected, setSelected] = useState(
    () => new Set(itemsWithCollision.map((item, i) => (item.collides ? null : i)).filter((i) => i !== null))
  );
  const [accepting, setAccepting] = useState(false);

  const toggleItem = (index) => {
    if (itemsWithCollision[index]?.collides) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleAccept = async () => {
    if (accepting || selected.size === 0) return;
    setAccepting(true);
    try {
      const selectedItems = [...selected].sort().map((i) => items[i]).filter(Boolean);
      await onAccept(selectedItems);
    } catch {
      setAccepting(false);
    }
  };

  return (
    <div style={{ padding: "8px 12px" }}>
      <ItemGrid
        items={itemsWithCollision}
        selected={selected}
        onToggle={toggleItem}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {selected.size} of {items.length} selected
          {job.result && (
            <> &middot; ${job.result.cost_usd?.toFixed(4)}</>
          )}
        </span>
        <button
          onClick={handleAccept}
          disabled={accepting || selected.size === 0}
          style={{ fontSize: 12, fontWeight: 500 }}
        >
          {accepting ? "Saving..." : `Accept (${selected.size})`}
        </button>
      </div>
    </div>
  );
}

// ---- Color variant review (cherry-pick, inserts as {color}_{objectName}) ----
function ColorReview({ job, existingNames, onAccept }) {
  const items = useMemo(() => job.result?.items ?? [], [job.result]);
  const objectName = job.request?.objectName ?? "unknown";
  const itemsWithMeta = useMemo(
    () =>
      items.map((item) => {
        const name = `${item.color}_${objectName}`;
        return { ...item, name, collides: existingNames.has(name) };
      }),
    [items, objectName, existingNames]
  );
  const [selected, setSelected] = useState(
    () => new Set(itemsWithMeta.map((item, i) => (item.collides ? null : i)).filter((i) => i !== null))
  );
  const [accepting, setAccepting] = useState(false);

  const toggleItem = (index) => {
    if (itemsWithMeta[index]?.collides) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleAccept = async () => {
    if (accepting || selected.size === 0) return;
    setAccepting(true);
    try {
      const selectedItems = [...selected].sort().map((i) => itemsWithMeta[i]).filter(Boolean);
      await onAccept(selectedItems);
    } catch {
      setAccepting(false);
    }
  };

  return (
    <div style={{ padding: "8px 12px" }}>
      <ItemGrid
        items={itemsWithMeta}
        selected={selected}
        onToggle={toggleItem}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {selected.size} of {items.length} selected
          {job.result && (
            <> &middot; ${job.result.cost_usd?.toFixed(4)}</>
          )}
        </span>
        <button
          onClick={handleAccept}
          disabled={accepting || selected.size === 0}
          style={{ fontSize: 12, fontWeight: 500 }}
        >
          {accepting ? "Saving..." : `Accept (${selected.size})`}
        </button>
      </div>
    </div>
  );
}

// ---- Shared cherry-pick grid ----
function ItemGrid({ items, selected, onToggle }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
        gap: 6,
        maxHeight: 260,
        overflowY: "auto",
      }}
    >
      {items.map((item, i) => {
        const isSelected = selected.has(i);
        return (
          <div
            key={i}
            onClick={() => onToggle(i)}
            style={{
              background: "var(--color-background-primary)",
              borderRadius: "var(--border-radius-md)",
              border: isSelected
                ? "2px solid #1D9E75"
                : item.collides
                ? "2px solid #991B1B40"
                : "0.5px solid var(--color-border-tertiary)",
              padding: 6,
              textAlign: "center",
              opacity: item.collides ? 0.5 : 1,
              cursor: item.collides ? "not-allowed" : "pointer",
            }}
          >
            <div
              dangerouslySetInnerHTML={{ __html: item.svg }}
              style={{ width: 48, height: 48, margin: "0 auto 4px" }}
            />
            <div
              style={{
                fontSize: 9,
                color: "var(--color-text-secondary)",
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.name?.replace(/_/g, " ")}
            </div>
            {item.collides ? (
              <div style={{ fontSize: 9, color: "#991B1B", fontWeight: 500 }}>exists</div>
            ) : (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => { e.stopPropagation(); onToggle(i); }}
                onClick={(e) => e.stopPropagation()}
                style={{ cursor: "pointer", marginTop: 2 }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
