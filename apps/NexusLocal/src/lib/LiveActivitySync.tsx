import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "./supabase";

/// Polls TimeTracker's `active_sessions` and drives the timer Live Activity:
/// starts it when a running (non-paused) timer appears, ends it when the timer
/// stops or pauses. No-op on desktop. Note: iOS only lets an app *start* a Live
/// Activity while it's in the foreground (no push on the free tier), so this
/// fires while Nexus Local is open.
export function LiveActivitySync() {
  const activeKey = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      const { data, error } = await supabasePublic
        .from("active_sessions")
        .select("task_name,project,start_time,paused_at")
        .eq("user_id", "default")
        .limit(1);
      if (!alive || error) return;

      const s = data?.[0] as
        | { task_name?: string; project?: string; start_time?: string; paused_at?: string | null }
        | undefined;
      const running = !!(s && !s.paused_at && s.start_time);

      if (running && s) {
        const key = `${s.task_name}|${s.start_time}`;
        if (activeKey.current !== key) {
          activeKey.current = key;
          invoke("start_live_activity", {
            taskName: s.task_name ?? "Timer",
            projectName: s.project ?? "",
            startTimestamp: new Date(s.start_time!).getTime() / 1000,
          }).catch(() => {});
        }
      } else if (activeKey.current !== null) {
        activeKey.current = null;
        invoke("end_live_activity").catch(() => {});
      }
    }
    tick();
    const t = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return null;
}
