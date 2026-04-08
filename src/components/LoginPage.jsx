import { useState } from "react";

// Minimal email/password login screen. Toggles between sign-in and sign-up
// modes. On success, useAuth's onAuthStateChange listener fires and the
// app routes to the grid automatically.
export default function LoginPage({ onSignIn, onSignUp }) {
  const [mode, setMode] = useState("signIn"); // 'signIn' | 'signUp'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signIn") {
        await onSignIn(email, password);
      } else {
        await onSignUp(email, password);
        // If the project requires email confirmation, the session won't
        // start until the user clicks the confirmation link. Show a hint.
        setPendingConfirm(true);
      }
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
          GIST physics SVG library
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            marginBottom: 16,
          }}
        >
          {mode === "signIn" ? "Sign in to continue." : "Create an account."}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            style={{ width: "100%" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {pendingConfirm && (
            <div
              style={{
                fontSize: 12,
                color: "var(--color-text-success)",
                background: "var(--color-background-success)",
                padding: "6px 10px",
                borderRadius: "var(--border-radius-md)",
              }}
            >
              Check your email for a confirmation link, then come back and sign in.
            </div>
          )}
          <button type="submit" disabled={submitting} style={{ fontSize: 13 }}>
            {submitting ? "Working..." : mode === "signIn" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: "var(--color-text-secondary)",
            textAlign: "center",
          }}
        >
          {mode === "signIn" ? (
            <>
              No account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signUp");
                  setError(null);
                  setPendingConfirm(false);
                }}
                style={{
                  color: "var(--color-text-info)",
                  border: "none",
                  padding: 0,
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signIn");
                  setError(null);
                  setPendingConfirm(false);
                }}
                style={{
                  color: "var(--color-text-info)",
                  border: "none",
                  padding: 0,
                }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
