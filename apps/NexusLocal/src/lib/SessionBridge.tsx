import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNexusAuth } from "@nexus/core";

/// Pushes the current Supabase session into the widget's App Group whenever it
/// changes, so the (separate-process) widget extension can make authenticated,
/// RLS-scoped queries. Renders nothing.
export function SessionBridge() {
  const { session, loading } = useNexusAuth();

  useEffect(() => {
    if (loading) return;
    if (session) {
      const payload = JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at ?? 0,
        user_id: session.user?.id ?? "",
      });
      invoke("store_session", { sessionJson: payload }).catch(() => {});
    } else {
      invoke("clear_session").catch(() => {});
    }
  }, [session, loading]);

  return null;
}
