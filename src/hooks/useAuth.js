import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

// Tracks the current Supabase auth session and exposes signIn / signUp /
// signOut. Use the `loading` flag to gate rendering until we know whether
// there's an existing session (so we don't flash the login screen at users
// who are already logged in).
export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // True after the user arrives via a password-recovery email link. Supabase
  // signs them in with a temporary session and fires PASSWORD_RECOVERY; App
  // uses this flag to show the set-new-password screen instead of the grid.
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    // 1. Try to restore the existing session from localStorage (Supabase
    //    client handles this internally; we just await the read).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // 2. Subscribe to future auth changes (login, logout, token refresh).
    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  // Sends the recovery email. The link redirects back to this app's origin,
  // which must be in Supabase's allowed redirect URLs (Auth > URL Configuration).
  const resetPassword = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  }, []);

  // Sets a new password for the recovery session, then clears the flag so
  // App falls through to the normal signed-in view.
  const updatePassword = useCallback(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setPasswordRecovery(false);
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading,
    passwordRecovery,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
  };
}
