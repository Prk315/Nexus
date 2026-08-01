import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Cache the authed user id outside React so the plain api.ts functions can read
// it synchronously. RLS (user_id = auth.uid()) is the real enforcement.
let currentUserId: string | null = null;
supabase.auth.getSession().then(({ data }) => {
  currentUserId = data.session?.user.id ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  currentUserId = session?.user.id ?? null;
});

export function getUserId(): string {
  if (!currentUserId) throw new Error("Not authenticated");
  return currentUserId;
}
