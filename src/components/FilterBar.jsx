import { STATUSES, STATUS_CONFIG } from "../lib/constants.js";

// Status filter row + bulk "all drafts -> idea only" button.
//
// Filter solo behavior: clicking a status when all are shown solos that
// status. Clicking the soloed status restores all four. This is preserved
// from the original artifact and is intentional.
//
// The "Downloaded" toggle is an independent boolean that intersects with
// (not replaces) the status filter set. When on, only items with
// last_exported_at != null remain visible.
export default function FilterBar({
  filters,
  statusCounts,
  onToggleFilter,
  onAllDraftsToIdea,
  downloadedOnly,
  onToggleDownloadedOnly,
  downloadedCount,
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginRight: 2 }}>
        Filter:
      </span>
      {STATUSES.map((status) => {
        const config = STATUS_CONFIG[status];
        const isOn = filters.has(status);
        const isSolo = filters.size === 1 && isOn;
        return (
          <button
            key={status}
            onClick={() => onToggleFilter(status)}
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
            {config.label} ({statusCounts[status] || 0})
          </button>
        );
      })}
      <button
        onClick={onToggleDownloadedOnly}
        style={{
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: "var(--border-radius-md)",
          cursor: "pointer",
          background: downloadedOnly
            ? "var(--color-background-secondary)"
            : "transparent",
          color: downloadedOnly
            ? "var(--color-text-primary)"
            : "var(--color-text-tertiary)",
          border: downloadedOnly
            ? "2px solid var(--color-text-primary)"
            : "0.5px solid var(--color-border-tertiary)",
          fontWeight: downloadedOnly ? 500 : 400,
        }}
      >
        Downloaded ({downloadedCount || 0})
      </button>
      <span style={{ flex: 1 }} />
      <button
        onClick={onAllDraftsToIdea}
        style={{
          fontSize: 11,
          padding: "3px 8px",
          color: "var(--color-text-warning)",
        }}
      >
        All drafts &rarr; idea only
      </button>
    </div>
  );
}
