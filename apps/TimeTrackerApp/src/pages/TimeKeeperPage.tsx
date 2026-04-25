import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks/useAppDispatch";
import {
  fetchBlockerState,
  fetchInstalledApps,
  setBlockerEnabled,
  addBlockedApp,
  removeBlockedApp,
  setAppEnabled,
  type InstalledApp,
} from "../store/slices/blockerSlice";
import {
  fetchBlockedSites,
  addBlockedSite,
  removeBlockedSite,
  setSiteEnabled,
  syncBlockedSites,
} from "../store/slices/siteBlockerSlice";
import {
  fetchScheduleBlocks,
  addScheduleBlock,
  updateScheduleBlock,
  removeScheduleBlock,
  fetchUnlockRules,
  addUnlockRule,
  removeUnlockRule,
  fetchTodayMinutes,
  type FocusBlock,
} from "../store/slices/scheduleSlice";
import Toggle from "../components/shared/Toggle";

// ── Platform detection ────────────────────────────────────────────────────────

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

// ── Constants ─────────────────────────────────────────────────────────────────

const HOUR_H = 44; // px per hour on the timeline
const TOTAL_H = 24 * HOUR_H; // 1056px

const BLOCK_COLORS = [
  "#4f46e5", "#0891b2", "#059669", "#d97706",
  "#dc2626", "#7c3aed", "#be185d", "#0f766e",
];

const DAYS_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAYS_VALS = [1, 2, 3, 4, 5, 6, 7];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

function parseMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── App Blocker ───────────────────────────────────────────────────────────────

function AppBlockerSection() {
  const dispatch = useAppDispatch();
  const { enabled, apps, installedApps, loading } = useAppSelector((s) => s.blocker);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [selectedMode, setSelectedMode] = useState<"always" | "focus_only">("always");

  const openPicker = () => {
    if (installedApps.length === 0) dispatch(fetchInstalledApps());
    setShowPicker(true);
  };
  const addApp = (app: InstalledApp) => {
    dispatch(addBlockedApp({ display_name: app.display_name, process_name: app.process_name, block_mode: selectedMode }));
    setShowPicker(false);
    setPickerFilter("");
  };
  const filtered = installedApps.filter((a) => a.display_name.toLowerCase().includes(pickerFilter.toLowerCase()));
  const alreadyBlocked = new Set(apps.map((a) => a.process_name));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>App Blocker</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            Blocked apps are quit automatically while blocking is active.
          </div>
        </div>
        <Toggle checked={enabled} onChange={async (v) => { await dispatch(setBlockerEnabled(v)); await dispatch(syncBlockedSites()); }} label="" />
      </div>

      {apps.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {apps.map((app) => (
            <div key={app.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--surface-raised)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13 }}>{app.display_name}</span>
                <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>
                  {app.block_mode === "always" ? "always" : "during focus"}
                </span>
              </div>
              <Toggle checked={app.enabled} onChange={(v) => dispatch(setAppEnabled({ id: app.id, enabled: v }))} label="" />
              <button onClick={() => dispatch(removeBlockedApp(app.id))} style={{ background: "transparent", color: "var(--text-muted)", fontSize: 14, padding: "2px 4px", cursor: "pointer" }} title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={selectedMode} onChange={(e) => setSelectedMode(e.target.value as "always" | "focus_only")} style={{ fontSize: 12, padding: "4px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)" }}>
          <option value="always">Block always</option>
          <option value="focus_only">Block during focus only</option>
        </select>
        <button onClick={openPicker} style={btnSmallPrimary}>+ Add app</button>
      </div>

      {showPicker && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
            <input autoFocus placeholder="Search apps…" value={pickerFilter} onChange={(e) => setPickerFilter(e.target.value)} style={{ width: "100%", fontSize: 13, background: "transparent", border: "none", outline: "none" }} />
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {loading && <div style={{ padding: "12px 10px", fontSize: 12, color: "var(--text-muted)" }}>Scanning…</div>}
            {!loading && filtered.slice(0, 100).map((app) => (
              <button key={app.process_name} disabled={alreadyBlocked.has(app.process_name)} onClick={() => addApp(app)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 13, background: "transparent", color: alreadyBlocked.has(app.process_name) ? "var(--text-muted)" : "var(--text)", cursor: alreadyBlocked.has(app.process_name) ? "not-allowed" : "pointer", borderBottom: "1px solid var(--border)" }}>
                {app.display_name}
                {alreadyBlocked.has(app.process_name) && <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-muted)" }}>already blocked</span>}
              </button>
            ))}
          </div>
          <div style={{ padding: "6px 10px", borderTop: "1px solid var(--border)" }}>
            <button onClick={() => setShowPicker(false)} style={{ fontSize: 12, color: "var(--text-muted)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Site Blocker ──────────────────────────────────────────────────────────────

function SiteBlockerSection() {
  const dispatch = useAppDispatch();
  const { sites, loading } = useAppSelector((s) => s.siteBlocker);
  const blockerEnabled = useAppSelector((s) => s.blocker.enabled);
  const [input, setInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleAdd = async () => {
    const domain = input.trim();
    if (!domain) return;
    const result = await dispatch(addBlockedSite(domain));
    if (addBlockedSite.fulfilled.match(result)) {
      setInput("");
      if (!IS_IOS && blockerEnabled) {
        setSyncing(true); setSyncError(null);
        const r = await dispatch(syncBlockedSites());
        if (syncBlockedSites.rejected.match(r)) setSyncError(r.error.message ?? "Failed to update /etc/hosts");
        setSyncing(false);
      }
    }
  };

  const handleRemove = async (id: number) => {
    await dispatch(removeBlockedSite(id));
    if (!IS_IOS && blockerEnabled) await dispatch(syncBlockedSites());
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    await dispatch(setSiteEnabled({ id, enabled }));
    if (!IS_IOS && blockerEnabled) await dispatch(syncBlockedSites());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {IS_IOS ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          Blocked sites are enforced via Safari Content Blocker — enable in Settings › Safari › Extensions
        </p>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          Blocked sites are redirected to 127.0.0.1 via /etc/hosts. Requires your Mac password to apply.
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdd()} placeholder="example.com" style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }} />
        <button onClick={handleAdd} style={addBtnStyle} disabled={!input.trim() || syncing}>{syncing ? "Applying…" : "Block"}</button>
      </div>
      {!IS_IOS && syncError && <p style={{ fontSize: 12, color: "var(--danger, #e55)", margin: 0 }}>{syncError}</p>}
      {loading ? <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</p>
        : sites.length === 0 ? <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No sites blocked yet.</p>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sites.map((site) => (
              <div key={site.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 13 }}>{site.domain}</span>
                <Toggle checked={site.enabled} onChange={(v) => handleToggle(site.id, v)} />
                <button onClick={() => handleRemove(site.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16 }}>×</button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Schedule timeline ─────────────────────────────────────────────────────────

function ScheduleSection() {
  const dispatch = useAppDispatch();
  const blocks = useAppSelector((s) => s.schedule.blocks);
  const blockedApps = useAppSelector((s) => s.blocker.apps);
  const blockedSites = useAppSelector((s) => s.siteBlocker.sites);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<FocusBlock | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Scroll to 7am on mount
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = 7 * HOUR_H;
    }
  }, []);

  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedBlock) {
      setEditing({ ...selectedBlock });
    } else {
      setEditing(null);
    }
  }, [selectedId, blocks]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollTop = timelineRef.current?.scrollTop ?? 0;
    const y = e.clientY - rect.top + scrollTop;
    const hour = Math.min(22, Math.floor(y / HOUR_H));
    const startHH = String(hour).padStart(2, "0");
    const endHH = String(hour + 2).padStart(2, "0");
    dispatch(addScheduleBlock({
      name: "New Block",
      start_time: `${startHH}:00`,
      end_time: `${endHH}:00`,
      days_of_week: "1,2,3,4,5",
      color: BLOCK_COLORS[blocks.length % BLOCK_COLORS.length],
    })).then((r) => {
      if (addScheduleBlock.fulfilled.match(r)) setSelectedId(r.payload.id);
    });
  };

  const saveEditing = async () => {
    if (!editing) return;
    await dispatch(updateScheduleBlock(editing));
  };

  const deleteBlock = async () => {
    if (!editing) return;
    await dispatch(removeScheduleBlock(editing.id));
    setSelectedId(null);
  };

  const toggleDay = (val: number) => {
    if (!editing) return;
    const current = editing.days_of_week.split(",").filter(Boolean).map(Number);
    const next = current.includes(val)
      ? current.filter((d) => d !== val)
      : [...current, val].sort((a, b) => a - b);
    setEditing({ ...editing, days_of_week: next.join(",") });
  };

  const toggleApp = (processName: string) => {
    if (!editing) return;
    const has = editing.blocked_apps.includes(processName);
    setEditing({
      ...editing,
      blocked_apps: has
        ? editing.blocked_apps.filter((p) => p !== processName)
        : [...editing.blocked_apps, processName],
    });
  };

  const toggleSite = (domain: string) => {
    if (!editing) return;
    const has = editing.blocked_sites.includes(domain);
    setEditing({
      ...editing,
      blocked_sites: has
        ? editing.blocked_sites.filter((d) => d !== domain)
        : [...editing.blocked_sites, domain],
    });
  };

  const activeDays = editing?.days_of_week.split(",").filter(Boolean).map(Number) ?? [];

  return (
    <div style={{ display: "flex", gap: 0, height: 560, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>

      {/* Left: timeline */}
      <div style={{ display: "flex", flexDirection: "column", width: 220, borderRight: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Day View</span>
          <button
            onClick={() => {
              const hour = new Date().getHours();
              dispatch(addScheduleBlock({
                name: "New Block",
                start_time: `${String(hour).padStart(2, "0")}:00`,
                end_time: `${String(Math.min(23, hour + 2)).padStart(2, "0")}:00`,
                days_of_week: "1,2,3,4,5",
                color: BLOCK_COLORS[blocks.length % BLOCK_COLORS.length],
              })).then((r) => {
                if (addScheduleBlock.fulfilled.match(r)) setSelectedId(r.payload.id);
              });
            }}
            style={{ fontSize: 16, background: "transparent", color: "var(--accent)", cursor: "pointer", lineHeight: 1 }}
            title="Add block"
          >+</button>
        </div>

        {/* Timeline scroll area */}
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          style={{ flex: 1, overflowY: "auto", position: "relative", cursor: "crosshair" }}
        >
          <div style={{ height: TOTAL_H, position: "relative" }}>
            {/* Hour grid lines and labels */}
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ position: "absolute", top: h * HOUR_H, left: 0, right: 0, height: HOUR_H, borderTop: "1px solid var(--border)", pointerEvents: "none" }}>
                <span style={{ position: "absolute", left: 6, top: 2, fontSize: 10, color: "var(--text-muted)", userSelect: "none" }}>
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}

            {/* Schedule blocks */}
            {blocks.map((block) => {
              const startMin = parseMinutes(block.start_time);
              const endMin = parseMinutes(block.end_time);
              const top = (startMin / 60) * HOUR_H;
              const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_H);
              const isSelected = block.id === selectedId;
              return (
                <div
                  key={block.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(block.id === selectedId ? null : block.id); }}
                  style={{
                    position: "absolute",
                    top,
                    left: 48,
                    right: 6,
                    height,
                    background: block.color + (block.enabled ? "cc" : "44"),
                    borderLeft: `3px solid ${block.color}`,
                    borderRadius: 4,
                    cursor: "pointer",
                    padding: "2px 5px",
                    overflow: "hidden",
                    boxShadow: isSelected ? `0 0 0 2px ${block.color}` : undefined,
                    transition: "box-shadow 0.1s",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{block.name}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.85)" }}>{block.start_time}–{block.end_time}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: editor */}
      <div style={{ flex: 1, overflowY: "auto", background: "var(--surface)" }}>
        {!editing ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 13, gap: 8 }}>
            <div style={{ fontSize: 28 }}>📅</div>
            <div>Click a block to edit it</div>
            <div style={{ fontSize: 11 }}>or click the + button / empty timeline to create one</div>
          </div>
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Name + color */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                style={{ flex: 1, fontSize: 14, fontWeight: 600, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
              />
              <Toggle checked={editing.enabled} onChange={(v) => setEditing({ ...editing, enabled: v })} label="" />
            </div>

            {/* Color picker */}
            <div>
              <div style={labelStyle}>Color</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {BLOCK_COLORS.map((c) => (
                  <button key={c} onClick={() => setEditing({ ...editing, color: c })} style={{ width: 22, height: 22, borderRadius: "50%", background: c, border: editing.color === c ? "2px solid var(--text)" : "2px solid transparent", cursor: "pointer" }} />
                ))}
              </div>
            </div>

            {/* Time range */}
            <div>
              <div style={labelStyle}>Time</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={editing.start_time} onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} style={selectStyle}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>to</span>
                <select value={editing.end_time} onChange={(e) => setEditing({ ...editing, end_time: e.target.value })} style={selectStyle}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Days of week */}
            <div>
              <div style={labelStyle}>Days</div>
              <div style={{ display: "flex", gap: 4 }}>
                {DAYS_LABELS.map((label, i) => {
                  const val = DAYS_VALS[i];
                  const on = activeDays.includes(val);
                  return (
                    <button key={val} onClick={() => toggleDay(val)} style={{ width: 28, height: 28, borderRadius: "50%", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", background: on ? "var(--accent)" : "var(--surface)", color: on ? "#fff" : "var(--text-muted)", cursor: "pointer" }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Apps to block */}
            {blockedApps.length > 0 && (
              <div>
                <div style={labelStyle}>Block apps</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 130, overflowY: "auto" }}>
                  {blockedApps.map((app) => {
                    const checked = editing.blocked_apps.includes(app.process_name);
                    return (
                      <label key={app.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleApp(app.process_name)} style={{ cursor: "pointer" }} />
                        {app.display_name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sites to block */}
            {blockedSites.length > 0 && (
              <div>
                <div style={labelStyle}>Block sites</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 130, overflowY: "auto" }}>
                  {blockedSites.map((site) => {
                    const checked = editing.blocked_sites.includes(site.domain);
                    return (
                      <label key={site.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleSite(site.domain)} style={{ cursor: "pointer" }} />
                        {site.domain}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {(blockedApps.length === 0 && blockedSites.length === 0) && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                Add apps and sites in the Blockers tab first, then assign them to schedule blocks here.
              </p>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
              <button onClick={saveEditing} style={btnPrimary}>Save</button>
              <button onClick={deleteBlock} style={btnDanger}>Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Time Rewards ──────────────────────────────────────────────────────────────

function RewardsSection() {
  const dispatch = useAppDispatch();
  const { unlockRules, todayMinutes } = useAppSelector((s) => s.schedule);
  const blockedApps = useAppSelector((s) => s.blocker.apps);
  const blockedSites = useAppSelector((s) => s.siteBlocker.sites);

  const [addType, setAddType] = useState<"app" | "site">("app");
  const [addTarget, setAddTarget] = useState("");
  const [addMinutes, setAddMinutes] = useState(60);

  // Refresh today's minutes every 30 seconds
  useEffect(() => {
    dispatch(fetchTodayMinutes());
    const id = setInterval(() => dispatch(fetchTodayMinutes()), 30_000);
    return () => clearInterval(id);
  }, [dispatch]);

  const handleAdd = async () => {
    if (!addTarget) return;
    const payload =
      addType === "app"
        ? { process_name: addTarget, required_minutes: addMinutes }
        : { domain: addTarget, required_minutes: addMinutes };
    await dispatch(addUnlockRule(payload));
    setAddTarget("");
    setAddMinutes(60);
  };

  const appOptions = blockedApps.filter(
    (a) => !unlockRules.some((r) => r.process_name === a.process_name)
  );
  const siteOptions = blockedSites.filter(
    (s) => !unlockRules.some((r) => r.domain === s.domain)
  );

  const getLabel = (rule: (typeof unlockRules)[0]) => {
    if (rule.process_name) {
      return blockedApps.find((a) => a.process_name === rule.process_name)?.display_name ?? rule.process_name;
    }
    return rule.domain ?? "?";
  };

  const todayH = Math.floor(todayMinutes / 60);
  const todayM = todayMinutes % 60;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Today's total */}
      <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 24 }}>⏱</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Today: {todayH}h {todayM}m tracked</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Apps and sites unlock once you hit their threshold</div>
        </div>
      </div>

      {/* Rules list */}
      {unlockRules.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No rewards set up yet. Add one below.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {unlockRules.map((rule) => {
            const pct = Math.min(100, Math.round((todayMinutes / rule.required_minutes) * 100));
            const unlocked = todayMinutes >= rule.required_minutes;
            return (
              <div key={rule.id} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface)", border: `1px solid ${unlocked ? "var(--success, #16a34a)" : "var(--border)"}`, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, flex: 1 }}>
                    {rule.domain ? "🌐" : "🖥️"} <strong>{getLabel(rule)}</strong>
                    <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>unlocks after {rule.required_minutes}m</span>
                  </span>
                  {unlocked && <span style={{ fontSize: 11, color: "var(--success, #16a34a)", fontWeight: 600 }}>Unlocked</span>}
                  <button onClick={() => dispatch(removeUnlockRule(rule.id))} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 14 }}>×</button>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: unlocked ? "var(--success, #16a34a)" : "var(--accent)", borderRadius: 2, transition: "width 0.5s" }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{todayMinutes}/{rule.required_minutes} min • {pct}%</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add form */}
      <div style={{ padding: "12px 14px", borderRadius: 8, border: "1px dashed var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={labelStyle}>Add a time reward</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
            {(["app", "site"] as const).map((t) => (
              <button key={t} onClick={() => { setAddType(t); setAddTarget(""); }} style={{ padding: "4px 12px", fontSize: 12, background: addType === t ? "var(--accent)" : "transparent", color: addType === t ? "#fff" : "var(--text-muted)", border: "none", cursor: "pointer" }}>
                {t === "app" ? "App" : "Site"}
              </button>
            ))}
          </div>

          <select value={addTarget} onChange={(e) => setAddTarget(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 120 }}>
            <option value="">— pick one —</option>
            {addType === "app"
              ? appOptions.map((a) => <option key={a.process_name} value={a.process_name}>{a.display_name}</option>)
              : siteOptions.map((s) => <option key={s.domain} value={s.domain}>{s.domain}</option>)
            }
          </select>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="number"
              min={1}
              value={addMinutes}
              onChange={(e) => setAddMinutes(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ width: 60, ...selectStyle }}
            />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>min</span>
          </div>

          <button onClick={handleAdd} disabled={!addTarget} style={btnSmallPrimary}>Add</button>
        </div>

        {(addType === "app" ? appOptions.length === 0 : siteOptions.length === 0) && (
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
            No {addType === "app" ? "apps" : "sites"} available — add them in the Blockers tab first.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TimeKeeperPage() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchBlockerState());
    dispatch(fetchBlockedSites());
    dispatch(fetchScheduleBlocks());
    dispatch(fetchUnlockRules());
  }, [dispatch]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* Schedule — full width, main feature */}
      <section>
        <h3 style={sectionTitle}>Daily Schedule</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
          Click the timeline to create blocks. Each block defines which apps and sites are blocked during that time window.
        </p>
        <ScheduleSection />
      </section>

      {/* Blockers + Rewards — side by side below the timeline */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>

        <section style={{ flex: "1 1 320px", minWidth: 280 }}>
          <h3 style={sectionTitle}>Blockers</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {!IS_IOS && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Apps</div>
                <AppBlockerSection />
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Websites</div>
              <SiteBlockerSection />
            </div>
          </div>
        </section>

        <section style={{ flex: "1 1 320px", minWidth: 280 }}>
          <h3 style={sectionTitle}>Time Rewards</h3>
          <RewardsSection />
        </section>

      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 6,
};

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};

const btnSmallPrimary: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--accent-fg, #fff)",
  padding: "4px 12px",
  fontSize: 12,
  borderRadius: "var(--radius-sm)",
  border: "none",
  cursor: "pointer",
  fontWeight: 500,
};

const btnPrimary: React.CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  padding: "6px 16px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const btnDanger: React.CSSProperties = {
  background: "transparent",
  color: "var(--danger, #dc2626)",
  padding: "6px 16px",
  borderRadius: 6,
  border: "1px solid var(--danger, #dc2626)",
  cursor: "pointer",
  fontSize: 13,
};

const addBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
