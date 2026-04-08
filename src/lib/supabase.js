import { createClient } from "@supabase/supabase-js";

// Singleton Supabase client for the browser. Uses the anon key, which is
// safe to ship to the browser because RLS policies enforce access control.
//
// Env vars come from .env.local in dev and Vercel project settings in prod.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Hard fail at boot rather than silently breaking later. The dev server
  // will surface this in the console.
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Copy .env.local.example to .env.local and fill in real values."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
