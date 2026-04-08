import { useState, useMemo } from "react";
import ColorPaletteTag from "./ColorPaletteTag.jsx";

// Flow A: generate a brand-new SVG. Reached from the Header "Generate more"
// button. Asks for a snake_case object name + optional color palette tag,
// fires off /api/generate, shows the streamed/awaited preview, and lets the
// user Accept (insert into physics_svgs) or Discard.
//
// Name collision detection: if the entered name already exists in the
// in-memory library, we disable the Generate button and offer a one-click
// jump to the existing item (which the parent can wire to "open the modal
// in revise mode").
//
// Props:
//   existingNames    Set<string>   already-taken names from useSvgs.items
//   generation       useGeneration result object
//   onGenerate       ({objectName, colorTag}) => Promise<void>
//   onAccept         ({name, displayName, svgContent}) => Promise<void>
//   onClose          () => void
//   onJumpToExisting (name) => void   // optional, opens detail modal
export default function GenerateNewModal({
  existingNames,
  generation,
  onGenerate,
  onAccept,
  onClose,
  onJumpToExisting,
}) {
  const [name, setName] = useState("");
  const [colorTag, setColorTag] = useState(null);
  const [accepting, setAccepting] = useState(false);

  // Lowercase + snake-cased version of whatever the user typed. We don't
  // mutate what they see in the input, but we use the normalized form for
  // collision checks and DB writes so the schema stays consistent.
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

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!normalizedName || collides || generation.status === "generating") return;
    try {
      await onGenerate({ objectName: normalizedName, colorTag });
    } catch {
      // Error already captured into generation.error by the hook.
    }
  };

  const handleAccept = async () => {
    if (!generation.result || accepting) return;
    setAccepting(true);
    try {
      await onAccept({
        name: normalizedName,
        displayName: normalizedName.replace(/_/g, " "),
        svgContent: generation.result.svg,
      });
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
          maxWidth: 520,
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
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            Generate new SVG
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

        <form onSubmit={handleGenerate} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 4,
              }}
            >
              Object name
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. wooden_block"
              autoFocus
              style={{ width: "100%" }}
            />
            {normalizedName && normalizedName !== name.trim() && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  marginTop: 4,
                }}
              >
                Will be saved as <code>{normalizedName}</code>
              </div>
            )}
            {collides && (
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
                {onJumpToExisting && (
                  <button
                    type="button"
                    onClick={() => onJumpToExisting(normalizedName)}
                    style={{ fontSize: 12 }}
                  >
                    Open it to revise
                  </button>
                )}
              </div>
            )}
          </div>

          <ColorPaletteTag
            selectedTag={colorTag}
            onChange={(tag) => setColorTag(tag)}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button
              type="submit"
              disabled={!normalizedName || collides || generation.status === "generating"}
              style={{ fontSize: 13 }}
            >
              {generation.status === "generating" ? "Generating..." : "Generate \u2197"}
            </button>
          </div>
        </form>

        {generation.status === "error" && generation.error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: "var(--border-radius-md)",
              background: "#FECACA",
              color: "#991B1B",
              fontSize: 12,
            }}
          >
            {generation.error.message ?? String(generation.error)}
          </div>
        )}

        {generation.status === "ready" && generation.result && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 6,
              }}
            >
              Preview
            </div>
            <div
              style={{
                background: "var(--color-background-secondary)",
                borderRadius: "var(--border-radius-md)",
                padding: 24,
                textAlign: "center",
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: generation.result.svg }}
                style={{ width: 180, height: 180, margin: "0 auto" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {generation.result.input_tokens}+{generation.result.output_tokens} tokens
                &middot; ${generation.result.cost_usd.toFixed(4)}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={onClose} style={{ fontSize: 12 }}>
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generation.status === "generating"}
                  style={{ fontSize: 12 }}
                >
                  Try again
                </button>
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  {accepting ? "Saving..." : "Accept"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
