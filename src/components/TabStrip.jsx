// Top-level tab strip — picks which tool ("SVG Manager" or "Data Transforms")
// is active. User email + sign-out live here too since they're tool-agnostic.
//
// Tools share auth, layout, and theme. The tab state lives in App.jsx.
const TABS = [
  { id: "svg", label: "SVG Manager" },
  { id: "data", label: "Data Transforms" },
];

export default function TabStrip({ activeTab, onChange, userEmail, onSignOut }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
        paddingBottom: 4,
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              style={{
                padding: "8px 14px",
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
                borderBottom: active
                  ? "2px solid var(--color-text-primary)"
                  : "2px solid transparent",
                marginBottom: -5,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {userEmail}
        </span>
        <button
          onClick={onSignOut}
          style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
