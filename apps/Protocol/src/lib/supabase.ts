import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}

// Cache the authed user id outside React so plain api.ts functions can read it
// synchronously. RLS (user_id = auth.uid()) is the real enforcement.
let currentUserId: string | null = null;
getSupabaseClient()
  .auth.getSession()
  .then(({ data }) => {
    currentUserId = data.session?.user.id ?? null;
  });
getSupabaseClient().auth.onAuthStateChange((_event, session) => {
  currentUserId = session?.user.id ?? null;
});

export function getUserId(): string {
  if (!currentUserId) throw new Error("Not authenticated");
  return currentUserId;
}
