import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { STATUSES, STATUS_CONFIG, COLOR_RAMPS } from "../lib/constants.js";
import { isStale } from "../hooks/useSvgs.js";
import ColorPaletteTag from "./ColorPaletteTag.jsx";
import FeedbackHistory from "./FeedbackHistory.jsx";
import ModelTierToggle from "./ModelTierToggle.jsx";

// Hard cap for manual SVG uploads. Existing library files are ~1 KB; Claude
// won't generate anything close to this. The cap is a sanity guard against
// "I dragged in the wrong file" disasters, not a real size budget.
const MAX_UPLOAD_BYTES = 100 * 1024; // 100 KB

// DOMPurify config used for both manual uploads and (eventually) Claude
// output. SVG profile preserves all standard SVG elements/attributes and
// strips XSS vectors: <script>, on* event attrs, javascript: URLs,
// <foreignObject>-with-HTML, external <use href> exfiltration, etc.
const SVG_SANITIZE_CONFIG = { USE_PROFILES: { svg: true, svgFilters: true } };

// Detail review modal. Two variants:
//  - normal: shows feedback form for revision notes
//  - idea_only: shows a Notes textarea (how the concept maps to the
//    physics engine, e.g. rope -> distance joint), no feedback form
//
// Generation (Flow B) is overlaid as an inline preview area below the
// existing SVG when the parent's `generation` prop transitions out of
// 'idle'. The user can Accept (UPDATE the row, archives prior version
// via the trigger), Try again, or Discard.
//
// `modelTier` / `onModelTierChange` are owned by the parent (App.jsx) and
// reset to "standard" whenever a new item is opened, alongside the other
// per-item state (feedbackText). This keeps Advanced from being sticky
// across items.
//
// "Send to Claude" and "Generate in N colors" are fire-and-forget: they
// add a job to the generation queue. The user can close the modal and
// review results in the QueuePanel later. `itemQueueJobs` is the filtered
// subset of queue jobs relevant to this item (for showing inline status
// like "Generating..." or "1 result ready — open queue to review").
//
// Manual upload uses the same preview/Accept/Discard pattern and goes
// through `updateSvgContent`, so versioning and draft→revised promotion
// work identically. `pendingUpload` shape:
//   { svg: string, warning: string|null } | null
export default function DetailModal({
  item,
  feedbackText,
  onFeedbackTextChange,
  onClose,
  onUpdateStatus,
  onUpdateColor,
  onUpdateNotes,
  onAddFeedback,
  onPrevious,
  onNext,
  onSendToClaude,
  onGenerateColorVariants,
  itemQueueJobs,
  modelTier,
  onModelTierChange,
  pendingUpload,
  onPendingUploadChange,
  onAcceptUpload,
  onDiscardUpload,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const isIdeaOnly = item.status === "idea_only";

  // Multi-color selection for "Generate in all colors". Resets per-item
  // because App.jsx renders DetailModal with key={modalItem.id}, so React
  // remounts this component (resetting all useState) on item navigation.
  const [selectedColors, setSelectedColors] = useState(
    () => (item.colorTag ? new Set([item.colorTag]) : new Set())
  );

  // Auto-focus the textarea (feedback or notes) when the modal opens or
  // navigates to a new item.
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, [item.id]);

  // Download the current SVG to disk as `<id>.svg`. Snake_case to match
  // physics_svgs.name and the planned zip-export naming.
  const handleDownload = () => {
    const blob = new Blob([item.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.id}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Open the native file picker. The actual processing happens in
  // handleUploadFileChange after the user selects a file.
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Validate, sanitize, and stage an uploaded SVG. Failures populate
  // pendingUpload with svg=null + an error string so the preview area can
  // surface the problem inline.
  const handleUploadFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking the same file fires onChange
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      onPendingUploadChange({
        svg: null,
        warning: null,
        error: `File is ${(file.size / 1024).toFixed(1)} KB; max is ${MAX_UPLOAD_BYTES / 1024} KB.`,
      });
      return;
    }

    const text = await file.text();

    // Cheap pre-check: must contain an SVG root somewhere. Catches
    // accidentally-uploaded PNGs/JPEGs/text files before sanitization.
    if (!text.includes("<svg")) {
      onPendingUploadChange({
        svg: null,
        warning: null,
        error: "File does not appear to contain SVG markup.",
      });
      return;
    }

    // Sanitize. DOMPurify in SVG mode preserves all standard SVG elements
    // and presentation attributes; it strips XSS vectors (script tags,
    // on* event attrs, javascript: URLs, foreignObject HTML, external
    // <use href>, etc.).
    const sanitized = DOMPurify.sanitize(text, SVG_SANITIZE_CONFIG);

    if (!sanitized || !sanitized.includes("<svg")) {
      onPendingUploadChange({
        svg: null,
        warning: null,
        error: "Sanitization stripped the SVG entirely. The file may have been malformed.",
      });
      return;
    }

    // If sanitized output differs from input, something was removed.
    // We still let the user accept — the warning is informational, not
    // blocking — but we surface it so silent stripping isn't a mystery.
    // Whitespace differences are normalized away first to avoid
    // false-positive warnings on cosmetic reformatting.
    const collapse = (s) => s.replace(/\s+/g, " ").trim();
    const wasModified = collapse(sanitized) !== collapse(text);
    const warning = wasModified
      ? "Some elements or attributes were removed for safety. Preview is the cleaned version."
      : null;

    onPendingUploadChange({ svg: sanitized, warning, error: null });
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
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--color-text-primary)",
              textTransform: "capitalize",
            }}
          >
            {item.label}
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
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-md)",
            padding: 24,
            textAlign: "center",
            marginBottom: isIdeaOnly ? 16 : 8,
          }}
        >
          <div
            dangerouslySetInnerHTML={{ __html: item.svg }}
            style={{ width: 180, height: 180, margin: "0 auto" }}
          />
        </div>

        {/* Export status line. Only shown when this item has been exported
            at least once. If there have been revisions since the export,
            append a warning in amber so the user knows this one is stale
            and will re-ship on the next Download approved. */}
        {!isIdeaOnly && item.lastExportedAt && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary)",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Exported as v{item.lastExportedVersion} &middot;{" "}
            {new Date(item.lastExportedAt).toISOString().slice(0, 10)}
            {item.lastExportedByName ? ` · ${item.lastExportedByName}` : ""}
            {isStale(item) && (
              <span style={{ color: "#92400E", marginLeft: 4 }}>
                (changes since)
              </span>
            )}
          </div>
        )}

        {/* Manual download/upload row. Hidden for idea-only items because
            those are physics-engine concept placeholders, not real SVGs the
            user is iterating on. */}
        {!isIdeaOnly && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 16,
              marginBottom: 16,
              fontSize: 12,
            }}
          >
            <button
              onClick={handleDownload}
              style={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              &darr; Download
            </button>
            <button
              onClick={handleUploadClick}
              style={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              &uarr; Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,image/svg+xml"
              onChange={handleUploadFileChange}
              style={{ display: "none" }}
            />
          </div>
        )}

        {/* Manual upload preview panel. Mirrors the Claude revision preview
            visually but only shows Discard / Accept (no Try again). */}
        {pendingUpload && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: "var(--border-radius-md)",
              border: "1px solid var(--color-border-secondary)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 6,
              }}
            >
              Upload preview
            </div>

            {pendingUpload.error ? (
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--border-radius-md)",
                  background: "#FECACA",
                  color: "#991B1B",
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                {pendingUpload.error}
              </div>
            ) : (
              <>
                {pendingUpload.warning && (
                  <div
                    style={{
                      padding: "6px 10px",
                      borderRadius: "var(--border-radius-md)",
                      background: "#FEF3C7",
                      color: "#92400E",
                      fontSize: 11,
                      marginBottom: 8,
                    }}
                  >
                    {pendingUpload.warning}
                  </div>
                )}
                <div
                  style={{
                    background: "var(--color-background-secondary)",
                    borderRadius: "var(--border-radius-md)",
                    padding: 24,
                    textAlign: "center",
                    marginBottom: 8,
                  }}
                >
                  <div
                    dangerouslySetInnerHTML={{ __html: pendingUpload.svg }}
                    style={{ width: 180, height: 180, margin: "0 auto" }}
                  />
                </div>
              </>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
              }}
            >
              <button onClick={onDiscardUpload} style={{ fontSize: 12 }}>
                Discard
              </button>
              {!pendingUpload.error && (
                <button
                  onClick={() => onAcceptUpload(item.id)}
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  Accept
                </button>
              )}
            </div>
          </div>
        )}

        {/* Queue status for this item — lightweight inline indicator so
            the user knows their fire-and-forget request is in flight or
            ready for review in the QueuePanel. */}
        {itemQueueJobs && itemQueueJobs.length > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: "6px 10px",
              borderRadius: "var(--border-radius-md)",
              background: "#DBEAFE",
              color: "#1E3A8A",
              fontSize: 11,
            }}
          >
            {(() => {
              const gen = itemQueueJobs.filter((j) => j.status === "generating").length;
              const q = itemQueueJobs.filter((j) => j.status === "queued").length;
              const r = itemQueueJobs.filter((j) => j.status === "ready").length;
              const parts = [];
              if (gen) parts.push(`${gen} generating`);
              if (q) parts.push(`${q} queued`);
              if (r) parts.push(`${r} ready`);
              return `Queue: ${parts.join(", ")} — open Queue to review`;
            })()}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {STATUSES.map((status) => {
            const config = STATUS_CONFIG[status];
            const isOn = item.status === status;
            return (
              <button
                key={status}
                onClick={() => onUpdateStatus(item.id, status)}
                style={{
                  fontSize: 12,
                  padding: "5px 12px",
                  borderRadius: "var(--border-radius-md)",
                  cursor: "pointer",
                  background: isOn ? config.bg : "transparent",
                  color: isOn ? config.dk : "var(--color-text-tertiary)",
                  border: isOn
                    ? `2px solid ${config.c}`
                    : "0.5px solid var(--color-border-tertiary)",
                  fontWeight: isOn ? 500 : 400,
                }}
              >
                {config.label}
              </button>
            );
          })}
        </div>

        <ColorPaletteTag
          selectedTag={item.colorTag}
          onChange={(tag) => onUpdateColor(item.id, tag)}
        />

        <FeedbackHistory feedback={item.feedback} />

        {isIdeaOnly ? (
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 4,
              }}
            >
              Notes &mdash; how this fits the physics engine
            </div>
            <textarea
              ref={textareaRef}
              value={item.notes || ""}
              placeholder="e.g. Ropes will be implemented via distance joints in Planck.js..."
              onChange={(e) => onUpdateNotes(item.id, e.target.value)}
              style={{
                width: "100%",
                minHeight: 70,
                resize: "vertical",
                fontSize: 13,
              }}
            />
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={feedbackText}
              onChange={(e) => onFeedbackTextChange(e.target.value)}
              placeholder="Add feedback for next revision..."
              style={{
                width: "100%",
                minHeight: 60,
                resize: "vertical",
                fontSize: 13,
                marginBottom: 4,
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onAddFeedback(item.id);
                }
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                Cmd+Enter to save &middot; Esc close &middot; &larr;&rarr; nav
              </span>
              <button onClick={() => onAddFeedback(item.id)} style={{ fontSize: 13 }}>
                Save feedback
              </button>
            </div>
          </>
        )}

        <div
          style={{
            marginTop: 10,
            borderTop: "0.5px solid var(--color-border-tertiary)",
            paddingTop: 10,
          }}
        >
          <ModelTierToggle
            value={modelTier}
            onChange={onModelTierChange}
          />
        </div>

        {/* Multi-color "Generate in all colors" — fire-and-forget to queue.
            Color variants are inserted as NEW items named {color}_{objectName},
            not as replacements of this item. Results reviewed in QueuePanel. */}
        {!isIdeaOnly && (
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 4,
              }}
            >
              Generate in colors
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
              {Object.entries(COLOR_RAMPS).map(([key, ramp]) => {
                const isOn = selectedColors.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedColors((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    title={ramp.n}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      cursor: "pointer",
                      padding: 0,
                      background: `linear-gradient(135deg, ${ramp.l} 33%, ${ramp.m} 66%, ${ramp.d})`,
                      border: isOn
                        ? "2px solid var(--color-text-primary)"
                        : "2px solid transparent",
                      outline: isOn
                        ? "2px solid var(--color-background-primary)"
                        : "none",
                      opacity: isOn ? 1 : 0.4,
                    }}
                  />
                );
              })}
              <button
                onClick={() => onGenerateColorVariants(item, [...selectedColors], modelTier)}
                disabled={selectedColors.size === 0}
                style={{ fontSize: 11, marginLeft: 6 }}
              >
                Generate in {selectedColors.size} color{selectedColors.size === 1 ? "" : "s"} &#8599;
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
          }}
        >
          <button
            onClick={onPrevious}
            style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
          >
            &larr; Previous
          </button>
          <button
            onClick={() => onSendToClaude(item)}
            style={{ fontSize: 12 }}
          >
            Send to Claude &#8599;
          </button>
          <button
            onClick={onNext}
            style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
          >
            Next &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
