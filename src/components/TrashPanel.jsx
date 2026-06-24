import { useState } from "react";

// Trash panel. Lists soft-deleted items and lets the user Restore or
// permanently Delete them. Opened from the Header "Trash (N)" button.
//
// Rows are keyed by `_uuid`, NOT `id` — trashed names can legitimately
// collide (you culled "wheel" twice, or culled it then made a new one).
//
// Restore semantics mirror a filesystem trash: if the original name is free,
// restore as-is; if an ACTIVE item already has that name, the user must type a
// new slug before it can come back (we never auto-suffix — the name is
// semantic input to the downstream GIST LLM).
//
// Props:
//   trashedItems         Item[]   soft-deleted items (deletedAt != null)
//   existingNames        Set<string>  active names, for restore-collision check
//   onRestore            (uuid, newName?) => Promise<void>
//   onDeletePermanently  (uuid) => Promise<void>
//   onClose              () => void
export default function TrashPanel({
  trashedItems,
  existingNames,
  onRestore,
  onDeletePermanently,
  onClose,
}) {
  return (
    <PanelShell onClose={onClose}>
      {trashedItems.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: 32 }}>
          Trash is empty
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {trashedItems.map((item) => (
            <TrashRow
              key={item._uuid}
              item={item}
              variantCount={
                trashedItems.filter((t) => t._parentUuid === item._uuid).length
              }
              existingNames={existingNames}
              onRestore={onRestore}
              onDeletePermanently={onDeletePermanently}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function TrashRow({ item, variantCount, existingNames, onRestore, onDeletePermanently }) {
  // When the original slug is taken by an active item, restore opens an inline
  // rename field instead of restoring directly.
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(item.id);
  const [busy, setBusy] = useState(false);

  const normalizeSlug = (v) =>
    v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const nameTaken = (slug) => !!existingNames && existingNames.has(slug);
  const newNameCollides = nameTaken(newName);
  const canConfirmRename = newName.trim().length > 0 && !newNameCollides && !busy;

  const handleRestoreClick = async () => {
    if (nameTaken(item.id)) {
      // Original slug is occupied — make the user choose a new one.
      setNewName("");
      setRenaming(true);
      return;
    }
    setBusy(true);
    try {
      await onRestore(item._uuid);
    } catch {
      // Toast surfaced upstream; leave the row in place.
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRename = async () => {
    if (!canConfirmRename) return;
    setBusy(true);
    try {
      await onRestore(item._uuid, newName.trim());
    } catch {
      // Toast surfaced upstream; keep the rename field open to retry.
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const extra = variantCount > 0 ? ` and its ${variantCount} variant${variantCount > 1 ? "s" : ""}` : "";
    if (
      !window.confirm(
        `Permanently delete "${item.label}"${extra}? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await onDeletePermanently(item._uuid);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 10,
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "var(--border-radius-md)",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-sm)",
        }}
        dangerouslySetInnerHTML={{ __html: item.svg }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
            textTransform: "capitalize",
          }}
        >
          {item.label}
          {variantCount > 0 && (
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>
              {" "}
              (+{variantCount} variant{variantCount > 1 ? "s" : ""})
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontFamily: "monospace" }}>
          {item.id}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          Trashed {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : ""}
          {item.deletedByName ? ` · ${item.deletedByName}` : ""}
        </div>
        {renaming && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--color-danger, #B91C1C)" }}>
              "{item.id}" is taken by an active object — enter a new name to restore.
            </div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(normalizeSlug(e.target.value))}
              placeholder="new_object_name"
              autoFocus
              style={{ fontSize: 12, padding: "3px 6px", fontFamily: "monospace" }}
            />
            {newName && newNameCollides && (
              <div style={{ fontSize: 11, color: "var(--color-danger, #B91C1C)" }}>
                "{newName}" is also taken — pick another.
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {renaming ? (
          <>
            <button onClick={handleConfirmRename} disabled={!canConfirmRename} style={{ fontSize: 12 }}>
              {busy ? "…" : "Restore as new name"}
            </button>
            <button onClick={() => setRenaming(false)} disabled={busy} style={{ fontSize: 12 }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={handleRestoreClick} disabled={busy} style={{ fontSize: 12 }}>
              Restore
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              style={{ fontSize: 12, color: "var(--color-danger, #B91C1C)" }}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
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
            Trash
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
