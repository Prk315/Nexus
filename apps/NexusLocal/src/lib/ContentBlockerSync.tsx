import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";

/// Pushes the enabled `blocked_sites` into the native Safari content blocker on
/// launch and every few minutes. No-op on desktop (the Tauri command only acts
/// on iOS). Runs regardless of login — blocked_sites is anon-readable.
export function ContentBlockerSync() {
  useEffect(() => {
    let alive = true;
    async function sync() {
      const { data, error } = await supabase
        .from("blocked_sites")
        .select("domain")
        .eq("enabled", true);
      if (!alive || error || !data) return;
      const domains = data.map((r) => r.domain as string).filter(Boolean);
      invoke("apply_content_blocker", { domains }).catch(() => {});
    }
    sync();
    const t = setInterval(sync, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return null;
}
