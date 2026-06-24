import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { STATUSES, STATUS_CONFIG, COLOR_RAMPS } from "../lib/constants.js";
import { isStale } from "../hooks/useSvgs.js";
import { generateCollider } from "../lib/colliderGenerator.js";
import {
  validateCollider,
  colliderToEditableVertices,
  isConvexPolygon,
  transformCollider,
  MAX_CONVEX_VERTICES,
  VIEWBOX_SIZE,
} from "../lib/colliderSchema.js";
import ColorPaletteTag from "./ColorPaletteTag.jsx";
import ColliderEditor from "./ColliderEditor.jsx";
import ColliderPreview from "./ColliderPreview.jsx";
import FeedbackHistory from "./FeedbackHistory.jsx";
import GeometryInfo from "./GeometryInfo.jsx";
import { rescaleToFitViewBox, parseViewBox } from "../lib/svgGeometry.js";
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
  onUpdatePhysicalProperties,
  onDuplicate,
  onRename,
  onTrash,
  existingNames,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const isIdeaOnly = item.status === "idea_only";

  // Inline rename. The SLUG (name/item.id) is the primary field — it's the
  // semantic handle the downstream LLM uses and what frees the name for reuse.
  // The display label auto-follows the slug (underscores -> spaces), matching
  // how insertSvg derives display names everywhere else, UNLESS the user edits
  // the label directly (labelDirty). Slug is normalized to snake_case as you
  // type; collision is checked live against active names (excluding self).
  const [renaming, setRenaming] = useState(false);
  const [renameLabel, setRenameLabel] = useState(item.label);
  const [renameSlug, setRenameSlug] = useState(item.id);
  const [labelDirty, setLabelDirty] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const normalizeSlug = (v) =>
    v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const deslugify = (v) => v.replace(/_/g, " ");
  const handleSlugChange = (e) => {
    const slug = normalizeSlug(e.target.value);
    setRenameSlug(slug);
    if (!labelDirty) setRenameLabel(deslugify(slug));
  };
  const handleLabelChange = (e) => {
    setLabelDirty(true);
    setRenameLabel(e.target.value);
  };
  const slugChanged = renameSlug !== item.id;
  const slugCollides =
    slugChanged && !!existingNames && existingNames.has(renameSlug);
  const canSaveRename = renameSlug.trim().length > 0 && !slugCollides && !renameBusy;
  const startRename = () => {
    setRenameLabel(item.label);
    setRenameSlug(item.id);
    setLabelDirty(false);
    setRenaming(true);
  };
  const saveRename = async () => {
    if (!canSaveRename) return;
    setRenameBusy(true);
    try {
      await onRename?.(item.id, { name: renameSlug.trim(), displayName: renameLabel.trim() });
      setRenaming(false);
    } catch {
      // Error toast is surfaced by the App handler; keep the form open to retry.
    } finally {
      setRenameBusy(false);
    }
  };

  // Multi-color selection for "Generate in all colors". Resets per-item
  // because App.jsx renders DetailModal with key={modalItem.id}, so React
  // remounts this component (resetting all useState) on item navigation.
  const [selectedColors, setSelectedColors] = useState(
    () => (item.colorTag ? new Set([item.colorTag]) : new Set())
  );

  // Collider state. `previewCollider` is the locally-generated collider
  // shown in the overlay; `showCollider` toggles the overlay visibility.
  // If the item already has a saved collider, show it by default.
  // For children, physical properties (including collider) inherit from
  // the parent. The "effective" props are what we display; the "save target"
  // is the parent's id when this is a child.
  const isChild = !!item.parentId;
  const effectiveProps = item.effectivePhysicalProperties;
  const savedCollider = effectiveProps?.collider ?? null;
  // Underlying SVG's viewBox dims drive the collider overlay's coord
  // space, so a non-square viewBox (e.g. 35×64 after rescale) doesn't
  // make the collider look stretched/shrunk relative to the SVG.
  const itemViewBox = parseViewBox(item.svg);
  const itemVbW = itemViewBox?.width ?? 64;
  const itemVbH = itemViewBox?.height ?? 64;
  const [previewCollider, setPreviewCollider] = useState(savedCollider);
  const [showCollider, setShowCollider] = useState(!!savedCollider);
  const [colliderDebug, setColliderDebug] = useState(null);

  // Collider edit mode. When active, the ColliderEditor overlay replaces
  // the static ColliderPreview. `editVertices` holds the working vertex
  // array; changes are live-previewed but not saved until the user clicks
  // "Done".
  const [editingCollider, setEditingCollider] = useState(false);
  const [editVertices, setEditVertices] = useState(null);

  // Auto-focus the textarea (feedback or notes) when the modal opens or
  // navigates to a new item.
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, [item.id]);

  // When the saved collider changes underneath us — e.g. after a Rescale
  // Accept writes a new collider via updatePhysicalProperties — refresh
  // previewCollider so the on-screen overlay matches the new SVG.
  //
  // We only sync when the user wasn't holding a separate candidate. A ref
  // tracks the last savedCollider we synced from; if previewCollider still
  // equals that prior value, the user has no in-progress edit and it's
  // safe to follow the new save. If previewCollider has diverged (Generate
  // or Edit-Done populated it with a candidate), we leave it alone so the
  // Save button can appear and the user can commit their work.
  //
  // This deliberately does NOT depend on editingCollider: that would re-fire
  // on every Edit-Done and clobber the just-set candidate.
  const lastSyncedSavedColliderRef = useRef(savedCollider);
  useEffect(() => {
    if (savedCollider !== lastSyncedSavedColliderRef.current) {
      if (previewCollider === lastSyncedSavedColliderRef.current) {
        setPreviewCollider(savedCollider);
        setShowCollider(!!savedCollider);
      }
      lastSyncedSavedColliderRef.current = savedCollider;
    }
  }, [savedCollider, previewCollider]);

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

  // Compute a rescaled version of the current SVG (content centered and
  // scaled to fit the 64×64 viewBox). Stage it through pendingUpload so
  // the user can visually verify before accepting — the existing accept
  // path runs through updateSvgContent for free versioning + draft→revised
  // promotion.
  //
  // The collider (if any) is transformed by the same (scale, tx, ty) so
  // it stays aligned. Family propagation — applying the same transform
  // to the parent + all sibling variants so the family stays in lockstep —
  // happens in App.jsx's accept handler, which has access to the full
  // items list. We just stash scale/tx/ty in pendingUpload to signal it.
  const handleRescaleClick = () => {
    try {
      const result = rescaleToFitViewBox(item.svg);
      if (!result) {
        onPendingUploadChange({
          svg: null,
          warning: null,
          error: "Couldn't measure the SVG — no renderable content found.",
        });
        return;
      }

      const pct = (result.scale * 100).toFixed(1);
      const vbW = result.viewBoxWidth.toFixed(1).replace(/\.0$/, "");
      const vbH = result.viewBoxHeight.toFixed(1).replace(/\.0$/, "");
      const baseMessage = `Rescaled content (scale ${pct}%). New viewBox: ${vbW}×${vbH}.`;

      const sourceCollider = effectiveProps?.collider ?? null;
      let transformedCollider = null;
      let warning = baseMessage;

      if (sourceCollider) {
        const candidate = transformCollider(
          sourceCollider,
          result.scale,
          result.tx,
          result.ty
        );
        const check = candidate ? validateCollider(candidate) : { valid: false };
        if (check.valid) {
          transformedCollider = candidate;
          warning = `${baseMessage} Collider transformed to match.`;
        } else {
          warning = `${baseMessage} Collider transform failed validation; left unchanged.`;
        }
      }

      // Note family propagation in the warning. The actual count of
      // affected siblings is reported in the toast on Accept since the
      // parent owns the items list, not this modal.
      if (item.variants?.length > 0 || isChild) {
        warning = `${warning} Same transform will apply to all family members on Accept.`;
      }

      onPendingUploadChange({
        svg: result.svg,
        warning,
        error: null,
        collider: transformedCollider,
        scale: result.scale,
        tx: result.tx,
        ty: result.ty,
        viewBoxWidth: result.viewBoxWidth,
        viewBoxHeight: result.viewBoxHeight,
      });
    } catch (e) {
      onPendingUploadChange({
        svg: null,
        warning: null,
        error: `Rescale failed: ${e.message ?? e}`,
      });
    }
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

  const handleGenerateCollider = () => {
    const { collider, debug } = generateCollider(item.svg);
    const check = validateCollider(collider);
    if (!check.valid) {
      setColliderDebug({ error: check.error });
      return;
    }
    setPreviewCollider(collider);
    setShowCollider(true);
    setColliderDebug(debug);
  };

  // Save/clear always target the parent (for children) or self (for
  // root items). This enforces the "always inherit" rule — children
  // never store their own physical_properties.
  const colliderSaveTarget = item.parentId ?? item.id;

  const handleSaveCollider = () => {
    if (!previewCollider) return;
    onUpdatePhysicalProperties(colliderSaveTarget, { collider: previewCollider });
  };

  const handleClearCollider = () => {
    setPreviewCollider(null);
    setShowCollider(false);
    setColliderDebug(null);
    setEditingCollider(false);
    setEditVertices(null);
    onUpdatePhysicalProperties(colliderSaveTarget, { collider: null });
  };

  const handleStartEdit = () => {
    if (!previewCollider) return;
    const verts = colliderToEditableVertices(previewCollider);
    if (!verts) return; // compound not yet editable
    setEditVertices(verts);
    setEditingCollider(true);
    setShowCollider(true);
  };

  const handleFinishEdit = () => {
    if (!editVertices || editVertices.length < 3) {
      setEditingCollider(false);
      setEditVertices(null);
      return;
    }
    const round2 = (n) => Math.round(n * 100) / 100;
    const editedCollider = {
      type: "convex",
      vertices: editVertices.map(([x, y]) => [round2(x), round2(y)]),
    };
    setPreviewCollider(editedCollider);
    setColliderDebug((prev) => ({
      ...prev,
      strategy: (prev?.strategy ?? "") + " (edited)",
    }));
    setEditingCollider(false);
    setEditVertices(null);
  };

  const handleCancelEdit = () => {
    setEditingCollider(false);
    setEditVertices(null);
  };

  // Clamp every vertex to [0, 64] — quick rescue when the LLM or programmatic
  // generator placed vertices too far outside the icon to grab even in the
  // expanded editor canvas.
  const handleSnapToBounds = () => {
    if (!editVertices) return;
    const clampCoord = (n) => Math.round(Math.max(0, Math.min(VIEWBOX_SIZE, n)) * 100) / 100;
    setEditVertices(editVertices.map(([x, y]) => [clampCoord(x), clampCoord(y)]));
  };

  // Start over with a fresh programmatic collider from the SVG. Useful when
  // the current collider is a mess and it's easier to regenerate than to
  // drag individual vertices back into place.
  const handleResetCollider = () => {
    const { collider } = generateCollider(item.svg);
    const verts = colliderToEditableVertices(collider);
    if (verts) setEditVertices(verts);
  };

  // True if any vertex is outside [0, 64] in either dimension.
  const hasOutOfBoundsVertex =
    editVertices?.some(
      ([x, y]) => x < 0 || y < 0 || x > VIEWBOX_SIZE || y > VIEWBOX_SIZE
    ) ?? false;

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
          {renaming ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, marginRight: 12 }}>
              <label style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                Name (slug) — used by the GIST LLM
              </label>
              <input
                type="text"
                value={renameSlug}
                onChange={handleSlugChange}
                placeholder="object_name"
                autoFocus
                style={{ fontSize: 14, padding: "4px 8px", fontFamily: "monospace" }}
              />
              {slugCollides && (
                <div style={{ fontSize: 11, color: "var(--color-danger, #B91C1C)" }}>
                  "{renameSlug}" is already used by an active object — pick another.
                </div>
              )}
              <label style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                Display label
              </label>
              <input
                type="text"
                value={renameLabel}
                onChange={handleLabelChange}
                placeholder="Display label"
                style={{ fontSize: 13, padding: "4px 8px" }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveRename} disabled={!canSaveRename} style={{ fontSize: 12 }}>
                  {renameBusy ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setRenaming(false)} style={{ fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
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
                onClick={startRename}
                style={{
                  fontSize: 11,
                  padding: "1px 6px",
                  color: "var(--color-text-secondary)",
                }}
              >
                Rename
              </button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {!renaming && (
              <button
                onClick={() => onTrash?.(item)}
                title="Move to trash"
                style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  color: "var(--color-danger, #B91C1C)",
                }}
              >
                Trash
              </button>
            )}
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
            style={{
              position: "relative",
              width: 180,
              height: 180,
              margin: "0 auto",
            }}
          >
            <div
              className="svg-preview-host"
              dangerouslySetInnerHTML={{ __html: item.svg }}
              style={{ width: "100%", height: "100%" }}
            />
            {/* Dashed overlay traces the actual viewBox edges. Uses an
                inline SVG with the same viewBox + preserveAspectRatio as
                the underlying SVG so it lands exactly on the viewBox
                regardless of aspect ratio (e.g. a 64×15 viewBox renders
                as a wide-and-short outline, not a square misframe). */}
            <ViewBoxOutline svgMarkup={item.svg} />
            {editingCollider && editVertices ? (
              <ColliderEditor vertices={editVertices} onChange={setEditVertices} />
            ) : (
              showCollider && (
                <ColliderPreview
                  collider={previewCollider}
                  viewBoxWidth={itemVbW}
                  viewBoxHeight={itemVbH}
                />
              )
            )}
          </div>
        </div>

        {/* Geometry info: viewBox scale check + content/collider bounds.
            Lets reviewers catch scale mismatches before approving a
            non-64×64 SVG, since GIST scales collider coords by the SVG's
            viewBox. Hidden for idea-only items (no real SVG). */}
        {!isIdeaOnly && (
          <GeometryInfo svg={item.svg} collider={previewCollider} />
        )}

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
            <button
              onClick={() => onDuplicate?.(item)}
              style={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              &#x29C9; Duplicate as...
            </button>
            <button
              onClick={handleRescaleClick}
              style={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              &#x2922; Rescale to fit
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

        {/* Collider controls. Generate a best-guess physics collider from
            the SVG geometry, preview the overlay, save to physical_properties. */}
        {!isIdeaOnly && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: "var(--border-radius-md)",
              border: "0.5px solid var(--color-border-tertiary)",
              fontSize: 12,
            }}
          >
            {editingCollider ? (
              /* ---- Edit mode UI ---- */
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontWeight: 500, color: "var(--color-text-secondary)" }}>
                    Editing collider
                    <span
                      style={{
                        fontWeight: 400,
                        color: "var(--color-text-tertiary)",
                        marginLeft: 6,
                      }}
                    >
                      {editVertices?.length ?? 0}/{MAX_CONVEX_VERTICES} vertices
                    </span>
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {hasOutOfBoundsVertex && (
                      <button
                        onClick={handleSnapToBounds}
                        title="Clamp all vertices to the 0–64 icon bounds"
                        style={{
                          fontSize: 11,
                          color: "#92400E",
                          background: "transparent",
                          border: "none",
                          padding: "2px 4px",
                          cursor: "pointer",
                        }}
                      >
                        Snap to bounds
                      </button>
                    )}
                    <button
                      onClick={handleResetCollider}
                      title="Start over with a fresh programmatic collider"
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-secondary)",
                        background: "transparent",
                        border: "none",
                        padding: "2px 4px",
                        cursor: "pointer",
                      }}
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-secondary)",
                        background: "transparent",
                        border: "none",
                        padding: "2px 4px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleFinishEdit}
                      style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", cursor: "pointer" }}
                    >
                      Done
                    </button>
                  </div>
                </div>
                {editVertices && !isConvexPolygon(editVertices) && (
                  <div
                    style={{
                      padding: "4px 6px",
                      borderRadius: "var(--border-radius-md)",
                      background: "#FEF3C7",
                      color: "#92400E",
                      fontSize: 11,
                      marginBottom: 4,
                    }}
                  >
                    Polygon is concave — physics engines require convex shapes.
                    Adjust vertices or the engine will use the convex hull.
                  </div>
                )}
                <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                  Drag vertex to move &middot; Drag shape interior to translate
                  &middot; Click{" "}
                  <span style={{ color: "#10B981", fontWeight: 600 }}>+</span> to add
                  &middot; Click{" "}
                  <span style={{ color: "#EF4444", fontWeight: 600 }}>&times;</span> to
                  remove
                </div>
              </>
            ) : (
              /* ---- Normal (non-editing) UI ---- */
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: previewCollider ? 6 : 0,
                  }}
                >
                  <span style={{ fontWeight: 500, color: "var(--color-text-secondary)" }}>
                    Collider
                    {previewCollider && (
                      <span
                        style={{
                          fontWeight: 400,
                          color: "var(--color-text-tertiary)",
                          marginLeft: 6,
                        }}
                      >
                        {previewCollider.type}
                        {colliderDebug?.strategy ? ` · ${colliderDebug.strategy}` : ""}
                      </span>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {previewCollider && (
                      <>
                        <button
                          onClick={() => setShowCollider((v) => !v)}
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-secondary)",
                            background: "transparent",
                            border: "none",
                            padding: "2px 4px",
                            cursor: "pointer",
                          }}
                        >
                          {showCollider ? "Hide" : "Show"}
                        </button>
                        <button
                          onClick={handleStartEdit}
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-secondary)",
                            background: "transparent",
                            border: "none",
                            padding: "2px 4px",
                            cursor: "pointer",
                          }}
                        >
                          Edit
                        </button>
                      </>
                    )}
                    <button
                      onClick={handleGenerateCollider}
                      style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
                    >
                      {previewCollider ? "Regenerate" : "Generate"}
                    </button>
                  </div>
                </div>

                {previewCollider && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                      {savedCollider ? "Saved" : "Unsaved preview"}
                      {isChild && savedCollider && ` · inherited from ${item.parentId}`}
                      {colliderDebug?.extractedPoints != null &&
                        ` · ${colliderDebug.extractedPoints} pts → ${
                          previewCollider.type === "convex"
                            ? previewCollider.vertices.length + " verts"
                            : previewCollider.type
                        }`}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {savedCollider && (
                        <button
                          onClick={handleClearCollider}
                          style={{
                            fontSize: 11,
                            color: "#991B1B",
                            background: "transparent",
                            border: "none",
                            padding: "2px 4px",
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      )}
                      {(!savedCollider ||
                        JSON.stringify(savedCollider) !== JSON.stringify(previewCollider)) && (
                        <button
                          onClick={handleSaveCollider}
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            padding: "2px 8px",
                            cursor: "pointer",
                          }}
                        >
                          Save
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {colliderDebug?.error && (
              <div
                style={{
                  marginTop: 4,
                  padding: "4px 6px",
                  borderRadius: "var(--border-radius-md)",
                  background: "#FECACA",
                  color: "#991B1B",
                  fontSize: 11,
                }}
              >
                {colliderDebug.error}
              </div>
            )}
          </div>
        )}

        {/* Pending change preview panel. Used by both manual uploads and
            the in-place Rescale-to-fit button. Mirrors the Claude revision
            preview visually but only shows Discard / Accept (no Try again). */}
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
              Pending change
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
                    style={{
                      position: "relative",
                      width: 180,
                      height: 180,
                      margin: "0 auto",
                    }}
                  >
                    <div
                      className="svg-preview-host"
                      dangerouslySetInnerHTML={{ __html: pendingUpload.svg }}
                      style={{ width: "100%", height: "100%" }}
                    />
                    <ViewBoxOutline svgMarkup={pendingUpload.svg} />
                  </div>
                </div>
                {/* Catch viewBox mismatches BEFORE the user accepts the
                    upload. The accept path writes svg_content straight
                    to physics_svgs, so a wrong viewBox here silently
                    breaks the GIST scale downstream. */}
                <GeometryInfo svg={pendingUpload.svg} compact />
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

// Dashed overlay that traces the SVG's actual viewBox edges. Renders an
// inline SVG with the same viewBox + preserveAspectRatio as the underlying
// SVG so the outline lands exactly on the viewBox no matter the aspect
// ratio. vector-effect="non-scaling-stroke" keeps the stroke at 1 device
// pixel regardless of the viewBox-to-pixel zoom.
function ViewBoxOutline({ svgMarkup }) {
  const vb = parseViewBox(svgMarkup);
  if (!vb) return null;
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <rect
        x={vb.x}
        y={vb.y}
        width={vb.width}
        height={vb.height}
        fill="none"
        stroke="var(--color-border-tertiary)"
        strokeWidth="1"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
