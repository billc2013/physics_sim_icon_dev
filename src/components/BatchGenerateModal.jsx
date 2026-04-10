import { useState } from "react";
import { CATEGORIES } from "../lib/constants.js";
import ModelTierToggle from "./ModelTierToggle.jsx";

// Batch-generate 10 SVGs for a category. Reached from Header "Batch
// generate" button. Setup-only: on Generate, adds a job to the global
// queue and closes. Results are reviewed in the QueuePanel.
//
// Props:
//   onGenerate     ({ category, modelTier }) => void   adds job to queue
//   onClose        () => void
export default function BatchGenerateModal({ onGenerate, onClose }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [modelTier, setModelTier] = useState("standard");

  const effectiveCategory = isCustom ? customCategory.trim() : category;

  const handleGenerate = (e) => {
    e.preventDefault();
    if (!effectiveCategory) return;
    onGenerate({ category: effectiveCategory, modelTier });
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
                placeholder="e.g. musical instruments"
                autoFocus
                style={{ width: "100%", marginTop: 6 }}
              />
            )}
          </div>

          <ModelTierToggle value={modelTier} onChange={setModelTier} />

          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary)",
              marginTop: 2,
            }}
          >
            Will generate 10 SVGs and add them to the queue for review.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button type="submit" disabled={!effectiveCategory} style={{ fontSize: 13 }}>
              Generate 10 &#8599;
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
