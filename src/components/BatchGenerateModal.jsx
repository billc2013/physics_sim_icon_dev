import { useMemo, useState } from "react";
import {
  CATEGORIES,
  MAX_BATCH_COUNT,
  MAX_BATCH_REFERENCES,
} from "../lib/constants.js";
import ModelTierToggle from "./ModelTierToggle.jsx";

// Batch-generate SVGs in the style of optional existing items. Reached
// from Header "Batch generate" button. Setup-only: on Generate, adds a
// job to the global queue and closes. Results are reviewed in the
// QueuePanel.
//
// Props:
//   items          Array of all library items (for the reference picker)
//   onGenerate     ({ category, count, modelTier, referenceIds }) => void
//   onClose        () => void
export default function BatchGenerateModal({ items, onGenerate, onClose }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [modelTier, setModelTier] = useState("standard");
  const [count, setCount] = useState(10);

  // Reference picker state
  const [referenceIds, setReferenceIds] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState("alpha"); // "alpha" | "created" | "updated"

  const effectiveCategory = isCustom ? customCategory.trim() : category;
  const atMaxRefs = referenceIds.size >= MAX_BATCH_REFERENCES;

  // Filtered + sorted list for the picker. We don't show idea-only items
  // since they don't have real SVG content worth referencing.
  const pickerItems = useMemo(() => {
    if (!items) return [];
    const term = search.trim().toLowerCase();
    const filtered = items.filter(
      (it) =>
        it.status !== "idea_only" &&
        (term === "" ||
          it.id.toLowerCase().includes(term) ||
          it.label.toLowerCase().includes(term))
    );

    const sorted = [...filtered];
    if (sortMode === "alpha") {
      sorted.sort((a, b) => a.label.localeCompare(b.label));
    } else if (sortMode === "created") {
      sorted.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    } else {
      sorted.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    }
    return sorted;
  }, [items, search, sortMode]);

  const toggleReference = (id) => {
    setReferenceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_BATCH_REFERENCES) {
        next.add(id);
      }
      return next;
    });
  };

  const handleGenerate = (e) => {
    e.preventDefault();
    if (!effectiveCategory) return;
    const clampedCount = Math.max(1, Math.min(MAX_BATCH_COUNT, count));
    onGenerate({
      category: effectiveCategory,
      count: clampedCount,
      modelTier,
      referenceIds: Array.from(referenceIds),
    });
    onClose();
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
          <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-primary)" }}>
            Batch generate
          </div>
          <button
            onClick={onClose}
            style={{ fontSize: 18, lineHeight: 1, padding: "2px 8px", color: "var(--color-text-secondary)" }}
          >
            &times;
          </button>
        </div>

        <form
          onSubmit={handleGenerate}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {/* Category */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 4,
              }}
            >
              Category
            </div>
            <select
              value={isCustom ? "__custom__" : category}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setIsCustom(true);
                } else {
                  setIsCustom(false);
                  setCategory(e.target.value);
                }
              }}
              style={{ width: "100%", fontSize: 13 }}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              <option value="__custom__">Other (type your own)</option>
            </select>
            {isCustom && (
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g. billiard balls"
                autoFocus
                style={{ width: "100%", marginTop: 6 }}
              />
            )}
          </div>

          {/* Count */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: 4,
              }}
            >
              Count (1–{MAX_BATCH_COUNT})
            </div>
            <input
              type="number"
              min={1}
              max={MAX_BATCH_COUNT}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
              style={{ width: 80, fontSize: 13 }}
            />
          </div>

          {/* Reference picker */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                Reference style (optional)
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {referenceIds.size}/{MAX_BATCH_REFERENCES} selected
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input
                type="text"
                placeholder="Search by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, fontSize: 12, padding: "2px 6px" }}
              />
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={{ fontSize: 12 }}
              >
                <option value="alpha">A–Z</option>
                <option value="created">Newest</option>
                <option value="updated">Recent edits</option>
              </select>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
                gap: 6,
                maxHeight: 180,
                overflowY: "auto",
                padding: 6,
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-md)",
                background: "var(--color-background-secondary)",
              }}
            >
              {pickerItems.length === 0 ? (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    textAlign: "center",
                    fontSize: 11,
                    color: "var(--color-text-tertiary)",
                    padding: 12,
                  }}
                >
                  No matches.
                </div>
              ) : (
                pickerItems.map((it) => {
                  const selected = referenceIds.has(it.id);
                  const disabled = !selected && atMaxRefs;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => toggleReference(it.id)}
                      disabled={disabled}
                      title={it.label}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        padding: 4,
                        borderRadius: "var(--border-radius-md)",
                        border: selected
                          ? "2px solid #3B82F6"
                          : "2px solid transparent",
                        background: selected
                          ? "#DBEAFE"
                          : "var(--color-background-primary)",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.4 : 1,
                      }}
                    >
                      <div
                        dangerouslySetInnerHTML={{ __html: it.svg }}
                        style={{ width: 40, height: 40 }}
                      />
                      <div
                        style={{
                          fontSize: 9,
                          color: "var(--color-text-tertiary)",
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {it.id}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <ModelTierToggle value={modelTier} onChange={setModelTier} />

          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary)",
              marginTop: 2,
            }}
          >
            Will generate {Math.max(1, Math.min(MAX_BATCH_COUNT, count))} SVGs
            {referenceIds.size > 0 ? ` in the style of ${referenceIds.size} reference${referenceIds.size === 1 ? "" : "s"}` : ""}{" "}
            and add them to the queue for review.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button type="submit" disabled={!effectiveCategory} style={{ fontSize: 13 }}>
              Generate {Math.max(1, Math.min(MAX_BATCH_COUNT, count))} &#8599;
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
