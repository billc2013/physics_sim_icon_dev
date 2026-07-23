import { useState } from "react";

// Minimal email/password login screen. Toggles between sign-in, sign-up,
// and forgot-password modes. On success, useAuth's onAuthStateChange
// listener fires and the app routes to the grid automatically.
export default function LoginPage({ onSignIn, onSignUp, onResetPassword }) {
  const [mode, setMode] = useState("signIn"); // 'signIn' | 'signUp' | 'forgot'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setPendingConfirm(false);
    setResetSent(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signIn") {
        await onSignIn(email, password);
      } else if (mode === "signUp") {
        await onSignUp(email, password);
        // If the project requires email confirmation, the session won't
        // start until the user clicks the confirmation link. Show a hint.
        setPendingConfirm(true);
      } else {
        await onResetPassword(email);
        setResetSent(true);
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
          {mode === "signIn"
            ? "Sign in to continue."
            : mode === "signUp"
              ? "Create an account."
              : "Enter your email and we'll send a password reset link."}
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
          {mode !== "forgot" && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={{ width: "100%" }}
            />
          )}
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
          {resetSent && (
            <div
              style={{
                fontSize: 12,
                color: "var(--color-text-success)",
                background: "var(--color-background-success)",
                padding: "6px 10px",
                borderRadius: "var(--border-radius-md)",
              }}
            >
              If an account exists for that email, a reset link is on its way.
              Click it to choose a new password.
            </div>
          )}
          <button type="submit" disabled={submitting} style={{ fontSize: 13 }}>
            {submitting
              ? "Working..."
              : mode === "signIn"
                ? "Sign in"
                : mode === "signUp"
                  ? "Create account"
                  : "Send reset link"}
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
                onClick={() => switchMode("signUp")}
                style={{
                  color: "var(--color-text-info)",
                  border: "none",
                  padding: 0,
                }}
              >
                Sign up
              </button>
              {" · "}
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                style={{
                  color: "var(--color-text-info)",
                  border: "none",
                  padding: 0,
                }}
              >
                Lost password?
              </button>
            </>
          ) : (
            <>
              Have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signIn")}
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
