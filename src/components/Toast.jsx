// Transient confirmation banner. The toast lifecycle (timer, dismissal) is
// owned by App.jsx via the showToast callback; this component just renders
// whatever string it is given.
export default function Toast({ message }) {
  if (!message) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "var(--color-background-success)",
        color: "var(--color-text-success)",
        padding: "8px 20px",
        borderRadius: "var(--border-radius-md)",
        fontSize: 13,
        fontWeight: 500,
        border: "0.5px solid var(--color-border-success)",
      }}
    >
      {message}
    </div>
  );
}
