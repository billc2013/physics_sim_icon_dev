import { useState, useMemo } from "react";
import { needsExport } from "../hooks/useSvgs.js";

// Modal for the "Download approved" flow. Reached from the Header button.
// Two mutually-exclusive scopes (new-or-updated vs all-approved) and an
// optional manifest.json that carries physical_properties for each item.
//
// All the heavy lifting (JSZip, markExported, toast) lives in App.jsx in
// `onConfirm` — this component is a pure selector + preview.
//
// Props:
//   approvedItems     Item[]  // all approved items (both stale and fresh)
//   onClose           () => void
//   onConfirm         ({ mode, includeManifest, items }) => Promise<void>
//                     // items is the subset actually selected for export
export default function DownloadApprovedModal({ approvedItems, onClose, onConfirm }) {
  const [mode, setMode] = useState("new_or_updated");
  const [includeManifest, setIncludeManifest] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // An item is "new or updated" if it has never been exported, or if its
  // updated_at is after its last_exported_at. Uses the shared predicate
  // in useSvgs.js so the grid dot, DetailModal suffix, and this filter
  // all agree.
  const newOrUpdated = useMemo(
    () => approvedItems.filter(needsExport),
    [approvedItems]
  );

  const selectedItems = mode === "new_or_updated" ? newOrUpdated : approvedItems;
  const canDownload = selectedItems.length > 0 && !downloading;

  const handleConfirm = async () => {
    if (!canDownload) return;
    setDownloading(true);
    try {
      await onConfirm({ mode, includeManifest, items: selectedItems });
      onClose();
    } catch {
      // Parent surfaced a toast; keep the modal open so the user can retry.
      setDownloading(false);
    }
  };

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
        if (e.target === e.currentTarget && !downloading) onClose();
      }}
    >
      <div
        style={{
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          border: "0.5px solid var(--color-border-secondary)",
          width: "100%",
          maxWidth: 460,
          padding: "1.25rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            Download approved
          </div>
          <button
            onClick={onClose}
            disabled={downloading}
            style={{
              fontSize: 18,
              lineHeight: 1,
              padding: "2px 8px",
              color: "var(--color-text-secondary)",
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              cursor: "pointer",
              padding: 8,
              borderRadius: "var(--border-radius-md)",
              border:
                mode === "new_or_updated"
                  ? "2px solid var(--color-text-primary)"
                  : "0.5px solid var(--color-border-tertiary)",
            }}
          >
            <input
              type="radio"
              name="download-mode"
              value="new_or_updated"
              checked={mode === "new_or_updated"}
              onChange={() => setMode("new_or_updated")}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                New or updated since last export
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  marginTop: 2,
                }}
              >
                {newOrUpdated.length} item{newOrUpdated.length === 1 ? "" : "s"}
              </div>
            </div>
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              cursor: "pointer",
              padding: 8,
              borderRadius: "var(--border-radius-md)",
              border:
                mode === "all_approved"
                  ? "2px solid var(--color-text-primary)"
                  : "0.5px solid var(--color-border-tertiary)",
            }}
          >
            <input
              type="radio"
              name="download-mode"
              value="all_approved"
              checked={mode === "all_approved"}
              onChange={() => setMode("all_approved")}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                All approved
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  marginTop: 2,
                }}
              >
                {approvedItems.length} item{approvedItems.length === 1 ? "" : "s"}
              </div>
            </div>
          </label>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            fontSize: 12,
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeManifest}
            onChange={(e) => setIncludeManifest(e.target.checked)}
          />
          Include manifest.json (physical properties, version, color)
        </label>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 6,
            marginTop: 16,
          }}
        >
          <button onClick={onClose} disabled={downloading} style={{ fontSize: 13 }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canDownload}
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {downloading ? "Downloading..." : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
