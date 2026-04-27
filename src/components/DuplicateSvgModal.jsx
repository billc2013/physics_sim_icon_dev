import { useState, useMemo } from "react";

// Duplicate an existing item under a new name. Used when Bill wants to
// preserve the source SVG and evolve a new object from it via Claude.
//
// On accept, App.jsx inserts a new draft with the source's svg, effective
// physical_properties (so a child's inherited collider is preserved as a
// concrete starting copy), and color tag. The new item is NOT linked as a
// color variant — `parent_id` stays null so it's an independent root that
// Bill can iterate on without touching the original.
//
// Props:
//   sourceItem       the item being duplicated (provides label preview only)
//   existingNames    Set<string>
//   onAccept         ({newName}) => Promise<void>
//   onClose          () => void
//   onJumpToExisting (name) => void   // optional, opens detail modal
export default function DuplicateSvgModal({
  sourceItem,
  existingNames,
  onAccept,
  onClose,
  onJumpToExisting,
}) {
  const [name, setName] = useState("");
  const [accepting, setAccepting] = useState(false);

  const normalizedName = useMemo(
    () =>
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    [name]
  );
  const collides = normalizedName.length > 0 && existingNames.has(normalizedName);
  const canAccept = !!normalizedName && !collides && !accepting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canAccept) return;
    setAccepting(true);
    try {
      await onAccept({ newName: normalizedName });
      onClose();
    } catch {
      setAccepting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1100,
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
          maxWidth: 440,
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
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            Duplicate as new object
          </div>
          <button
            onClick={onClose}
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

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            padding: "8px 10px",
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-md)",
          }}
        >
          <div
            dangerouslySetInnerHTML={{ __html: sourceItem.svg }}
            style={{ width: 48, height: 48, flexShrink: 0 }}
          />
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            Copying from <code>{sourceItem.id}</code>. SVG, color tag, and
            collider will be duplicated. The new item starts as a draft.
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 4,
              }}
            >
              New name
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${sourceItem.id}_v2`}
              autoFocus
              style={{ width: "100%" }}
            />
            {normalizedName && normalizedName !== name.trim() ? (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  marginTop: 4,
                }}
              >
                Will be saved as <code>{normalizedName}</code>
              </div>
            ) : null}
            {collides ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-text-warning)",
                  marginTop: 6,
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <span>
                  <code>{normalizedName}</code> already exists.
                </span>
                {onJumpToExisting ? (
                  <button
                    type="button"
                    onClick={() => onJumpToExisting(normalizedName)}
                    style={{ fontSize: 12 }}
                  >
                    Open it
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 12 }}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canAccept}
              style={{ fontSize: 13, fontWeight: 500 }}
            >
              {accepting ? "Duplicating..." : "Duplicate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
