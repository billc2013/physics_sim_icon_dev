// Two-button pill switch for picking the Claude model tier before a
// generation call. Shared between Flow A (GenerateNewModal) and Flow B
// (DetailModal). Styling matches the filter/status pills elsewhere in the UI.
//
// Props:
//   value    "standard" | "advanced"
//   onChange (tier) => void
//   disabled boolean — greys out both buttons (use during generating state)
export default function ModelTierToggle({ value, onChange, disabled = false }) {
  const tiers = [
    { key: "standard", label: "Standard" },
    { key: "advanced", label: "Advanced" },
  ];
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginBottom: 4,
        }}
      >
        Model
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {tiers.map((tier) => {
          const isOn = value === tier.key;
          return (
            <button
              key={tier.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(tier.key)}
              style={{
                fontSize: 12,
                padding: "5px 12px",
                borderRadius: "var(--border-radius-md)",
                cursor: disabled ? "not-allowed" : "pointer",
                background: isOn
                  ? "var(--color-background-secondary)"
                  : "transparent",
                color: isOn
                  ? "var(--color-text-primary)"
                  : "var(--color-text-tertiary)",
                border: isOn
                  ? "2px solid var(--color-text-primary)"
                  : "0.5px solid var(--color-border-tertiary)",
                fontWeight: isOn ? 500 : 400,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {tier.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
