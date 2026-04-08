import { useEffect, useRef } from "react";
import { STATUSES, STATUS_CONFIG } from "../lib/constants.js";
import ColorPaletteTag from "./ColorPaletteTag.jsx";
import FeedbackHistory from "./FeedbackHistory.jsx";

// Detail review modal. Two variants:
//  - normal: shows feedback form for revision notes
//  - idea_only: shows a Notes textarea (how the concept maps to the
//    physics engine, e.g. rope -> distance joint), no feedback form
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
}) {
  const textareaRef = useRef(null);
  const isIdeaOnly = item.status === "idea_only";

  // Auto-focus the textarea (feedback or notes) when the modal opens or
  // navigates to a new item.
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, [item.id]);

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
            marginBottom: 16,
          }}
        >
          <div
            dangerouslySetInnerHTML={{ __html: item.svg }}
            style={{ width: 180, height: 180, margin: "0 auto" }}
          />
        </div>

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
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            borderTop: "0.5px solid var(--color-border-tertiary)",
            paddingTop: 10,
          }}
        >
          <button
            onClick={onPrevious}
            style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
          >
            &larr; Previous
          </button>
          <button onClick={() => onSendToClaude(item)} style={{ fontSize: 12 }}>
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
