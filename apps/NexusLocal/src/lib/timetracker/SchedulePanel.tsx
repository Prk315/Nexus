/**
 * Focus schedules (work unit 6) — recurring wall-clock windows during which a
 * chosen set of apps and sites is blocked.
 *
 * Unrelated to pomodoro despite the shared word: this is a calendar window, not
 * a countdown. Nothing here decides whether a window is *currently* active —
 * `focus-evaluate` collapses these rows into `blocking_state` server-side.
 *
 * TimeTracker renders this as a 1056px 24-hour timeline
 * (`apps/TimeTrackerApp/src/pages/TimeKeeperPage.tsx`). Nexus Local's window is
 * 400×560 on an iPhone, so this is a compact list plus an edit form instead.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "../supabase";

/**
 * Mirrors `timetracker::focus::FocusBlock`. The field names are **snake_case on
 * purpose**: Tauri maps only the top-level command argument (`block`) between
 * cases — nested struct fields go over the wire exactly as serde declares them.
 * Renaming these to camelCase silently produces `missing field` on both macOS
 * and iOS.
 */
type FocusBlock = {
  id: string | null;
  name: string;
  start_time: string;
  end_time: string;
  /** ISO weekday CSV, 1 = Mon .. 7 = Sun. */
  days_of_week: string;
  color: string;
  enabled: boolean;
  process_names: string[];
  domains: string[];
};

type BlockedApp = { display_name: string; process_name: string };

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7"];

// 30-minute grid. An existing block whose time is off-grid keeps its value —
// `timeOptions` splices it in so editing a 09:15 block can't silently move it.
const TIME_GRID = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

function timeOptions(current: string) {
  return TIME_GRID.includes(current) ? TIME_GRID : [...TIME_GRID, current].sort();
}

function daysOf(csv: string): number[] {
  return csv
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
}

function emptyBlock(): FocusBlock {
  return {
    id: null, // explicit null → the Rust side branches insert vs update on it
    name: "Focus Block",
    start_time: "09:00",
    end_time: "17:00",
    days_of_week: "1,2,3,4,5",
    color: COLORS[0],
    enabled: true,
    process_names: [],
    domains: [],
  };
}

export function SchedulePanel() {
  const [blocks, setBlocks] = useState<FocusBlock[]>([]);
  const [apps, setApps] = useState<BlockedApp[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [draft, setDraft] = useState<FocusBlock | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Work unit 1's migration adds schedule_block_apps / schedule_block_sites. Until
  // it lands the Rust side stores the block but drops its payload, which would
  // otherwise look like a bug (chips vanish on save with no explanation).
  const [payloadMissing, setPayloadMissing] = useState(false);

  // Never clears `err` on success — it runs in the `finally` of the mutations
  // below, and clearing there would erase the failure that just happened.
  // Callers reset `err` when they start.
  const load = useCallback(async () => {
    try {
      setBlocks(await invoke<FocusBlock[]>("tt_focus_blocks"));
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  // Targets come straight from Supabase with the anon-role client — these rows
  // are keyed user_id="default" (the Rust side's config default) and the
  // authenticated JWT returns an empty set rather than an error.
  //
  // try/catch rather than `.catch()`: a supabase-js builder is only a
  // `PromiseLike`, so it has no `.catch`. It resolves `{ data, error }` for
  // PostgREST-level errors but *throws* when the underlying fetch does, which is
  // exactly what a cold launch with no network does.
  const loadTargets = useCallback(async () => {
    try {
      const { data, error } = await supabasePublic
        .from("blocked_apps")
        .select("display_name,process_name")
        .eq("user_id", "default")
        .order("display_name");
      setApps((data as BlockedApp[]) ?? []);
      if (error) setErr(`blocked_apps: ${error.message}`);
    } catch (e) {
      setErr(`blocked_apps: ${String(e)}`);
    }
    try {
      const { data, error } = await supabasePublic
        .from("blocked_sites")
        .select("domain")
        .eq("user_id", "default")
        .order("domain");
      setSites((data ?? []).map((r: { domain: string }) => r.domain));
      if (error) setErr(`blocked_sites: ${error.message}`);
    } catch (e) {
      setErr(`blocked_sites: ${String(e)}`);
    }
    // Only PGRST205 ("could not find the table") means the migration is pending.
    // Latching on *any* error would raise the banner for an offline launch or an
    // RLS denial, i.e. exactly when it would be a lie.
    try {
      const { error } = await supabasePublic.from("schedule_block_apps").select("block_id").limit(1);
      setPayloadMissing(error?.code === "PGRST205");
    } catch {
      // Offline: leave the banner alone rather than claiming a missing table.
    }
  }, []);

  useEffect(() => {
    load();
    loadTargets();
  }, [load, loadTargets]);

  async function save(block: FocusBlock) {
    setBusy(true);
    setErr("");
    try {
      // The command returns what was actually stored: empty payload lists mean
      // the join tables aren't there yet. That is the authoritative signal — the
      // mount-time probe above is only for the case where nothing has been saved.
      const stored = await invoke<FocusBlock>("tt_focus_block_save", { block });
      const wanted = block.process_names.length + block.domains.length;
      if (wanted > 0 && stored.process_names.length + stored.domains.length === 0) {
        setPayloadMissing(true);
      }
      setDraft(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      // Reload even on failure: `reconcile` is not atomic, so a partial write
      // must not leave the list showing pre-save state as though nothing changed.
      await load();
      setBusy(false);
    }
  }

  async function remove(id: string | null) {
    if (!id) return;
    setBusy(true);
    setErr("");
    try {
      await invoke("tt_focus_block_delete", { id });
    } catch (e) {
      setErr(String(e));
    } finally {
      await load();
      setBusy(false);
    }
  }

  function patch(fields: Partial<FocusBlock>) {
    setDraft((d) => (d ? { ...d, ...fields } : d));
  }

  function toggleDay(day: number) {
    if (!draft) return;
    const current = daysOf(draft.days_of_week);
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    patch({ days_of_week: next.join(",") });
  }

  function toggleIn(list: string[], value: string) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-xs uppercase tracking-wide text-white/40">Focus schedules</h2>
        {!draft && (
          <button
            onClick={() => setDraft(emptyBlock())}
            disabled={busy}
            className="ml-auto rounded-lg bg-indigo-500/20 px-2.5 py-1 text-[11px] font-medium text-indigo-300 disabled:opacity-40"
          >
            + New
          </button>
        )}
      </div>

      {err && <div className="rounded-lg bg-red-500/10 p-2 text-[10px] text-red-300 break-all">{err}</div>}

      {payloadMissing && (
        <div className="rounded-lg bg-amber-500/10 p-2 text-[10px] text-amber-300">
          Per-block apps/sites are not stored yet — the schedule payload tables
          land with work unit 1's migration.
        </div>
      )}

      {!draft &&
        blocks.map((b) => (
          <div key={b.id ?? b.name} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color }} />
              <span className="truncate text-xs font-medium text-white/90">{b.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-white/50">
                {b.start_time}–{b.end_time}
                {b.start_time > b.end_time && <span className="text-amber-300/70"> +1d</span>}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-1">
              {DAY_LABELS.map((label, i) => {
                const on = daysOf(b.days_of_week).includes(i + 1);
                return (
                  <span
                    key={i}
                    className={`grid h-4 w-4 place-items-center rounded text-[9px] ${
                      on ? "bg-indigo-500/25 text-indigo-200" : "bg-white/[0.04] text-white/25"
                    }`}
                  >
                    {label}
                  </span>
                );
              })}
              <button
                onClick={() => save({ ...b, enabled: !b.enabled })}
                disabled={busy}
                className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${
                  b.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-white/[0.06] text-white/35"
                }`}
              >
                {b.enabled ? "on" : "off"}
              </button>
              <button
                onClick={() => setDraft({ ...b })}
                disabled={busy}
                className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/60 disabled:opacity-40"
              >
                Edit
              </button>
              <button
                onClick={() => remove(b.id)}
                disabled={busy}
                className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300"
              >
                ✕
              </button>
            </div>

            {(b.process_names.length > 0 || b.domains.length > 0) && (
              <div className="mt-1.5 truncate text-[10px] text-white/40">
                blocks {[...b.process_names, ...b.domains].join(" · ")}
              </div>
            )}
          </div>
        ))}

      {!draft && blocks.length === 0 && !err && (
        <p className="text-[10px] text-white/30">No focus schedules yet.</p>
      )}

      {draft && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="name"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/25"
          />

          <div className="flex items-center gap-2">
            <TimeSelect value={draft.start_time} onChange={(v) => patch({ start_time: v })} />
            <span className="text-[10px] text-white/35">→</span>
            <TimeSelect value={draft.end_time} onChange={(v) => patch({ end_time: v })} />
            {draft.start_time > draft.end_time && (
              <span className="text-[10px] text-amber-300/70">overnight</span>
            )}
          </div>

          <div className="flex gap-1">
            {DAY_LABELS.map((label, i) => {
              const on = daysOf(draft.days_of_week).includes(i + 1);
              return (
                <button
                  key={i}
                  onClick={() => toggleDay(i + 1)}
                  className={`h-6 flex-1 rounded text-[10px] ${
                    on ? "bg-indigo-500/25 text-indigo-200" : "bg-white/[0.04] text-white/30"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => patch({ color: c })}
                style={{ background: c }}
                className={`h-5 w-5 rounded-full ${
                  draft.color === c ? "ring-2 ring-white/60" : "opacity-50"
                }`}
              />
            ))}
            <button
              onClick={() => patch({ enabled: !draft.enabled })}
              className={`ml-auto rounded px-2 py-0.5 text-[10px] ${
                draft.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-white/[0.06] text-white/35"
              }`}
            >
              {draft.enabled ? "enabled" : "disabled"}
            </button>
          </div>

          <Targets
            label="Apps"
            empty="No blocked apps configured yet."
            options={apps.map((a) => ({ value: a.process_name, label: a.display_name || a.process_name }))}
            selected={draft.process_names}
            onToggle={(v) => patch({ process_names: toggleIn(draft.process_names, v) })}
          />
          <Targets
            label="Sites"
            empty="No blocked sites configured yet."
            options={sites.map((d) => ({ value: d, label: d }))}
            selected={draft.domains}
            onToggle={(v) => patch({ domains: toggleIn(draft.domains, v) })}
          />

          <div className="flex gap-2">
            <button
              onClick={() => save(draft)}
              disabled={busy}
              className="flex-1 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-300 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setErr("");
              }}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 font-mono text-xs text-white/80"
    >
      {timeOptions(value).map((t) => (
        <option key={t} value={t} className="bg-[#0a0a0f]">
          {t}
        </option>
      ))}
    </select>
  );
}

function Targets({
  label,
  empty,
  options,
  selected,
  onToggle,
}: {
  label: string;
  empty: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-white/35">
        {label} {selected.length > 0 && `· ${selected.length}`}
      </div>
      {options.length === 0 ? (
        <p className="mt-1 text-[10px] text-white/25">{empty}</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                onClick={() => onToggle(o.value)}
                className={`max-w-full truncate rounded px-1.5 py-0.5 text-[10px] ${
                  on ? "bg-indigo-500/25 text-indigo-200" : "bg-white/[0.05] text-white/45"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
