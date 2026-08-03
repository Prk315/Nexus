import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Shared NEXUS project client. persistSession + autoRefreshToken keep the login
// alive across launches; the session is bridged to the widget's App Group.
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// A session-less (anon-role) client for TimeTracker's tables (active_sessions,
// time_entries), whose RLS policies grant the anon role only — reading them with
// the authenticated user's JWT returns nothing (data is keyed user_id="default").
export const supabasePublic = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
