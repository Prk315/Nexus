import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Storage adapter using localStorage (Tauri WebView has localStorage available).
// Session is persisted across app restarts automatically.
const makeStorage = () => ({
  getItem: (key: string): string | null => localStorage.getItem(key),
  setItem: (key: string, value: string): void => { localStorage.setItem(key, value); },
  removeItem: (key: string): void => { localStorage.removeItem(key); },
});

let _client: SupabaseClient | null = null;

export function getSupabaseClient(url: string, key: string): SupabaseClient {
  if (!_client || (_client as any).__url !== url) {
    _client = createClient(url, key, {
      auth: {
        storage: makeStorage() as any,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    (_client as any).__url = url;
  }
  return _client;
}
