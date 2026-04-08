// Modal overlay that displays the current generation system prompt for review.
export default function SystemPrompt({ promptText, onClose }) {
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
          maxWidth: 600,
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
            Generation system prompt
          </div>
          <button
            onClick={onClose}
            style={{ fontSize: 18, padding: "2px 8px", color: "var(--color-text-secondary)" }}
          >
            &times;
          </button>
        </div>
        <div
          style={{
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-md)",
            padding: 14,
            fontSize: 13,
            lineHeight: 1.7,
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap",
          }}
        >
          {promptText}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-text-secondary)" }}>
          Included when you click "Generate more." Carries full inventory to avoid duplicates.
        </div>
      </div>
    </div>
  );
}
