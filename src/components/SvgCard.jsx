import { STATUS_CONFIG, COLOR_RAMPS } from "../lib/constants.js";

// One cell in the SVG grid. Renders the SVG, label, status badge, and
// optional feedback-count and color-tag indicators.
export default function SvgCard({ item, onClick }) {
  const config = STATUS_CONFIG[item.status];

  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--color-background-primary)",
        borderRadius: "var(--border-radius-lg)",
        border: "0.5px solid var(--color-border-tertiary)",
        padding: 10,
        cursor: "pointer",
        textAlign: "center",
        transition: "border-color 0.15s",
        position: "relative",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = config.c)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
    >
      <div
        dangerouslySetInnerHTML={{ __html: item.svg }}
        style={{ width: 56, height: 56, margin: "0 auto 6px" }}
      />
      <div
        style={{
          fontSize: 11,
          color: "var(--color-text-secondary)",
          lineHeight: 1.3,
          marginBottom: 4,
        }}
      >
        {item.label}
      </div>
      <div
        style={{
          fontSize: 10,
          padding: "2px 6px",
          borderRadius: "var(--border-radius-md)",
          background: config.bg,
          color: config.dk,
          display: "inline-block",
          fontWeight: 500,
        }}
      >
        {config.label}
      </div>
      {item.feedback.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            borderRadius: "50%",
            background: "var(--color-background-info)",
            color: "var(--color-text-info)",
            fontSize: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 500,
          }}
        >
          {item.feedback.length}
        </div>
      )}
      {item.colorTag && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: COLOR_RAMPS[item.colorTag]?.m,
          }}
        />
      )}
    </div>
  );
}
