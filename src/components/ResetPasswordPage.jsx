import { useState } from "react";

// Shown after the user clicks a password-recovery email link. By this point
// Supabase has already signed them in with a temporary session; this form
// sets the new password, and on success useAuth clears the recovery flag so
// App drops them into the grid.
export default function ResetPasswordPage({ onUpdatePassword }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onUpdatePassword(password);
    } catch (err) {
      setError(err.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: "var(--color-text-primary)",
            marginBottom: 4,
          }}
        >
          Set a new password
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            marginBottom: 16,
          }}
        >
          Choose a new password to finish resetting your account.
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoFocus
            style={{ width: "100%" }}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            style={{ width: "100%" }}
          />
          {error && (
            <div
              style={{
                fontSize: 12,
                color: "#991B1B",
                background: "#FECACA",
                padding: "6px 10px",
                borderRadius: "var(--border-radius-md)",
              }}
            >
              {error}
            </div>
          )}
          <button type="submit" disabled={submitting} style={{ fontSize: 13 }}>
            {submitting ? "Working..." : "Save new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
