// Read-only list of past feedback entries on an SVG. Each entry is a small
// card with the localized date and the feedback text.
export default function FeedbackHistory({ feedback }) {
  if (feedback.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginBottom: 6,
        }}
      >
        Feedback history
      </div>
      {feedback.map((entry, i) => (
        <div
          key={i}
          style={{
            background: "var(--color-background-secondary)",
            borderRadius: "var(--border-radius-md)",
            padding: "8px 10px",
            marginBottom: 4,
            fontSize: 13,
            color: "var(--color-text-primary)",
          }}
        >
          <span
            style={{
              color: "var(--color-text-tertiary)",
              fontSize: 11,
              marginRight: 8,
            }}
          >
            {new Date(entry.date).toLocaleDateString()}
          </span>
          {entry.text}
        </div>
      ))}
    </div>
  );
}
