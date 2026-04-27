import { useState, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import ColorPaletteTag from "./ColorPaletteTag.jsx";
import GeometryInfo from "./GeometryInfo.jsx";

// Import a brand-new SVG from disk. Sister to GenerateNewModal — same
// "name + color → insert" flow, but the markup comes from a local file
// instead of Claude. Inserts as a draft with a programmatically-generated
// starter collider (auto-run on Accept by App.jsx, see handleImportAccept).
//
// Mirrors DetailModal's upload sanitization path: DOMPurify SVG profile
// strips XSS vectors, and we surface a non-blocking warning if anything
// was removed so silent stripping isn't a mystery.
//
// Props:
//   existingNames    Set<string>   already-taken names from useSvgs.items
//   onAccept         ({name, displayName, svgContent, colorTag}) => Promise<void>
//   onClose          () => void
//   onJumpToExisting (name) => void   // optional, opens detail modal

const MAX_UPLOAD_BYTES = 100 * 1024;
const SVG_SANITIZE_CONFIG = { USE_PROFILES: { svg: true, svgFilters: true } };

export default function ImportSvgModal({
  existingNames,
  onAccept,
  onClose,
  onJumpToExisting,
}) {
  const [name, setName] = useState("");
  const [colorTag, setColorTag] = useState(null);
  const [staged, setStaged] = useState(null); // { svg, warning, error }
  const [accepting, setAccepting] = useState(false);
  const fileInputRef = useRef(null);

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

  const handlePickClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setStaged({
        svg: null,
        warning: null,
        error: `File is ${(file.size / 1024).toFixed(1)} KB; max is ${MAX_UPLOAD_BYTES / 1024} KB.`,
      });
      return;
    }

    const text = await file.text();
    if (!text.includes("<svg")) {
      setStaged({
        svg: null,
        warning: null,
        error: "File does not appear to contain SVG markup.",
      });
      return;
    }

    const sanitized = DOMPurify.sanitize(text, SVG_SANITIZE_CONFIG);
    if (!sanitized || !sanitized.includes("<svg")) {
      setStaged({
        svg: null,
        warning: null,
        error: "Sanitization stripped the SVG entirely. The file may have been malformed.",
      });
      return;
    }

    const collapse = (s) => s.replace(/\s+/g, " ").trim();
    const wasModified = collapse(sanitized) !== collapse(text);
    const warning = wasModified
      ? "Some elements or attributes were removed for safety. Preview is the cleaned version."
      : null;

    // Pre-fill the name from the filename if the user hasn't typed anything.
    if (!name) {
      const base = file.name.replace(/\.svg$/i, "");
      setName(base);
    }
    setStaged({ svg: sanitized, warning, error: null });
  };

  const canAccept =
    !!staged?.svg && !!normalizedName && !collides && !accepting;

  const handleAccept = async () => {
    if (!canAccept) return;
    setAccepting(true);
    try {
      await onAccept({
        name: normalizedName,
        displayName: normalizedName.replace(/_/g, " "),
        svgContent: staged.svg,
        colorTag,
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
            Import SVG from disk
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

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 4,
              }}
            >
              SVG file
            </div>
            <button onClick={handlePickClick} style={{ fontSize: 13 }}>
              {staged?.svg ? "Replace file" : "Choose file..."}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,image/svg+xml"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                marginTop: 4,
              }}
            >
              Max {MAX_UPLOAD_BYTES / 1024} KB. Inkscape/Illustrator exports work.
            </div>
          </div>

          {staged?.error ? (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "var(--border-radius-md)",
                background: "#FECACA",
                color: "#991B1B",
                fontSize: 12,
              }}
            >
              {staged.error}
            </div>
          ) : null}

          {staged?.svg ? (
            <>
              {staged.warning ? (
                <div
                  style={{
                    padding: "6px 10px",
                    borderRadius: "var(--border-radius-md)",
                    background: "#FEF3C7",
                    color: "#92400E",
                    fontSize: 11,
                  }}
                >
                  {staged.warning}
                </div>
              ) : null}
              <div
                style={{
                  background: "var(--color-background-secondary)",
                  borderRadius: "var(--border-radius-md)",
                  padding: 24,
                  textAlign: "center",
                }}
              >
                <div
                  dangerouslySetInnerHTML={{ __html: staged.svg }}
                  style={{ width: 180, height: 180, margin: "0 auto" }}
                />
              </div>
              <GeometryInfo svg={staged.svg} compact />
            </>
          ) : null}

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

          <ColorPaletteTag selectedTag={colorTag} onChange={setColorTag} />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button onClick={onClose} style={{ fontSize: 12 }}>
              Cancel
            </button>
            <button
              onClick={handleAccept}
              disabled={!canAccept}
              style={{ fontSize: 13, fontWeight: 500 }}
            >
              {accepting ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
