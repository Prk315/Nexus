import { useEffect, useRef, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
import { useAppDispatch, useAppSelector } from "../hooks/useAppDispatch";
import { fetchConfig, updateConfig, setTheme, setPomodoro } from "../store/slices/settingsSlice";
import { fetchCategories, updateCategories } from "../store/slices/categoriesSlice";
import { setPomodoroEnabled } from "../store/slices/timerSlice";
import { runSync, runPush, runPull } from "../store/slices/syncSlice";
import { testSupabaseConnection, exportCsv, exportJson, importJson } from "../lib/tauriApi";
import Toggle from "../components/shared/Toggle";

// ── Categories CRUD ───────────────────────────────────────────────────────────

function CategoriesEditor() {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((s) => s.categories.items);

  // Which category is expanded
  const [expanded, setExpanded] = useState<string | null>(null);
  // Inline rename state
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingSubOf, setEditingSubOf] = useState<string | null>(null);
  const [editingSubIdx, setEditingSubIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  // Add-new inputs
  const [newCatName, setNewCatName] = useState("");
  const [addingSubTo, setAddingSubTo] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState("");

  const editRef = useRef<HTMLInputElement>(null);
  useEffect(() => { editRef.current?.focus(); }, [editingCategory, editingSubOf]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const save_ = (updated: Record<string, string[]>) => dispatch(updateCategories(updated));

  const addCategory = () => {
    const name = newCatName.trim();
    if (!name || categories[name]) return;
    save_({ ...categories, [name]: [] });
    setNewCatName("");
    setExpanded(name);
  };

  const deleteCategory = (cat: string) => {
    const updated = { ...categories };
    delete updated[cat];
    save_(updated);
    if (expanded === cat) setExpanded(null);
  };

  const renameCategory = (oldName: string, newName: string) => {
    newName = newName.trim();
    if (!newName || newName === oldName) { setEditingCategory(null); return; }
    // Preserve insertion order by rebuilding
    const entries = Object.entries(categories).map(([k, v]) =>
      k === oldName ? [newName, v] : [k, v]
    ) as [string, string[]][];
    save_(Object.fromEntries(entries));
    if (expanded === oldName) setExpanded(newName);
    setEditingCategory(null);
  };

  const addSub = (cat: string) => {
    const name = newSubName.trim();
    if (!name || categories[cat].includes(name)) return;
    save_({ ...categories, [cat]: [...categories[cat], name] });
    setNewSubName("");
    setAddingSubTo(null);
  };

  const deleteSub = (cat: string, sub: string) => {
    save_({ ...categories, [cat]: categories[cat].filter((s) => s !== sub) });
  };

  const renameSub = (cat: string, idx: number, newName: string) => {
    newName = newName.trim();
    if (!newName) { setEditingSubOf(null); setEditingSubIdx(null); return; }
    const subs = categories[cat].map((s, i) => (i === idx ? newName : s));
    save_({ ...categories, [cat]: subs });
    setEditingSubOf(null);
    setEditingSubIdx(null);
  };

  const moveCategory = (cat: string, dir: -1 | 1) => {
    const entries = Object.entries(categories);
    const idx = entries.findIndex(([k]) => k === cat);
    const target = idx + dir;
    if (target < 0 || target >= entries.length) return;
    [entries[idx], entries[target]] = [entries[target], entries[idx]];
    save_(Object.fromEntries(entries));
  };

  const moveSub = (cat: string, idx: number, dir: -1 | 1) => {
    const subs = [...categories[cat]];
    const target = idx + dir;
    if (target < 0 || target >= subs.length) return;
    [subs[idx], subs[target]] = [subs[target], subs[idx]];
    save_({ ...categories, [cat]: subs });
  };

  const categoryNames = Object.keys(categories);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 480 }}>

      {/* Category list */}
      {categoryNames.map((cat, catIdx) => {
        const subs = categories[cat];
        const isExpanded = expanded === cat;

        return (
          <div
            key={cat}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
              background: "var(--surface)",
            }}
          >
            {/* Category row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 10px",
                background: isExpanded ? "var(--surface-raised)" : "transparent",
                borderBottom: isExpanded ? "1px solid var(--border)" : "none",
              }}
            >
              {/* Expand toggle */}
              <button
                onClick={() => setExpanded(isExpanded ? null : cat)}
                style={{ ...iconBtn, fontSize: 10, color: "var(--text-muted)", width: 20 }}
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? "▾" : "›"}
              </button>

              {/* Name / inline edit */}
              {editingCategory === cat ? (
                <input
                  ref={editRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => renameCategory(cat, editValue)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") renameCategory(cat, editValue);
                    if (e.key === "Escape") setEditingCategory(null);
                  }}
                  style={{ flex: 1, fontSize: 13, padding: "2px 6px" }}
                />
              ) : (
                <span
                  onDoubleClick={() => { setEditingCategory(cat); setEditValue(cat); }}
                  title="Double-click to rename"
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                    cursor: "text",
                    userSelect: "none",
                  }}
                >
                  {cat}
                  {subs.length > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
                      {subs.length} sub{subs.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              )}

              {/* Reorder */}
              <button onClick={() => moveCategory(cat, -1)} disabled={catIdx === 0} style={iconBtn} title="Move up">↑</button>
              <button onClick={() => moveCategory(cat, 1)} disabled={catIdx === categoryNames.length - 1} style={iconBtn} title="Move down">↓</button>

              {/* Add sub */}
              <button
                onClick={() => {
                  setExpanded(cat);
                  setAddingSubTo(cat);
                  setNewSubName("");
                }}
                style={{ ...iconBtn, color: "var(--text-muted)" }}
                title="Add sub-project"
              >
                +
              </button>

              {/* Delete category */}
              <button
                onClick={() => deleteCategory(cat)}
                style={{ ...iconBtn, color: "var(--danger)" }}
                title="Delete project"
              >
                ✕
              </button>
            </div>

            {/* Sub-projects */}
            {isExpanded && (
              <div>
                {subs.map((sub, subIdx) => (
                  <div
                    key={sub}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 10px 7px 32px",
                      borderBottom: subIdx < subs.length - 1 || addingSubTo === cat
                        ? "1px solid var(--border)"
                        : "none",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 2 }}>└</span>

                    {editingSubOf === cat && editingSubIdx === subIdx ? (
                      <input
                        ref={editRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => renameSub(cat, subIdx, editValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameSub(cat, subIdx, editValue);
                          if (e.key === "Escape") { setEditingSubOf(null); setEditingSubIdx(null); }
                        }}
                        style={{ flex: 1, fontSize: 12, padding: "2px 6px" }}
                      />
                    ) : (
                      <span
                        onDoubleClick={() => {
                          setEditingSubOf(cat);
                          setEditingSubIdx(subIdx);
                          setEditValue(sub);
                        }}
                        title="Double-click to rename"
                        style={{ flex: 1, fontSize: 12, color: "var(--text-secondary)", cursor: "text", userSelect: "none" }}
                      >
                        {sub}
                      </span>
                    )}

                    <button onClick={() => moveSub(cat, subIdx, -1)} disabled={subIdx === 0} style={iconBtn} title="Move up">↑</button>
                    <button onClick={() => moveSub(cat, subIdx, 1)} disabled={subIdx === subs.length - 1} style={iconBtn} title="Move down">↓</button>
                    <button onClick={() => deleteSub(cat, sub)} style={{ ...iconBtn, color: "var(--danger)" }} title="Delete">✕</button>
                  </div>
                ))}

                {/* Add sub-project input */}
                {addingSubTo === cat ? (
                  <div style={{ display: "flex", gap: 6, padding: "7px 10px 7px 32px" }}>
                    <input
                      autoFocus
                      placeholder="Sub-project name"
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addSub(cat);
                        if (e.key === "Escape") { setAddingSubTo(null); setNewSubName(""); }
                      }}
                      style={{ flex: 1, fontSize: 12, padding: "4px 8px" }}
                    />
                    <button
                      onClick={() => addSub(cat)}
                      style={{ ...btnSmallPrimary }}
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setAddingSubTo(null); setNewSubName(""); }}
                      style={{ ...btnSmallSecondary }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingSubTo(cat); setNewSubName(""); }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 10px 7px 32px",
                      textAlign: "left",
                      fontSize: 12,
                      color: "var(--text-muted)",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                  >
                    + Add sub-project
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Add new category */}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input
          placeholder="New project name"
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCategory()}
          style={{ flex: 1, fontSize: 13 }}
        />
        <button onClick={addCategory} style={btnSmallPrimary}>Add project</button>
      </div>
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const { config, theme, pomodoro } = useAppSelector((s) => s.settings);
  const pomodoroEnabled = useAppSelector((s) => s.timer.pomodoroEnabled);
  const sync = useAppSelector((s) => s.sync);

  const [supaUrl, setSupaUrl] = useState("");
  const [supaKey, setSupaKey] = useState("");
  const [connStatus, setConnStatus] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchConfig());
    dispatch(fetchCategories());
  }, [dispatch]);

  useEffect(() => {
    if (config?.supabase) {
      setSupaUrl(config.supabase.url);
      setSupaKey(config.supabase.key);
    }
  }, [config]);

  const saveSupabase = () => {
    dispatch(updateConfig({ key: "supabase.url", value: supaUrl }));
    dispatch(updateConfig({ key: "supabase.key", value: supaKey }));
  };

  const testConn = async () => {
    const ok = await testSupabaseConnection();
    setConnStatus(ok ? "Connected" : "Failed");
    setTimeout(() => setConnStatus(null), 3000);
  };

  const handleExportCsv = async () => {
    const path = await save({
      defaultPath: `timetracker_export_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    const count = await exportCsv({ outputPath: path });
    alert(`Exported ${count} entries to ${path}`);
  };

  const handleExportJson = async () => {
    const path = await save({
      defaultPath: `timetracker_export_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    const count = await exportJson({ outputPath: path });
    alert(`Exported ${count} entries to ${path}`);
  };

  const handleImportJson = async () => {
    const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return;
    const result = await importJson(path as string);
    setImportResult(`Imported ${result.imported}, skipped ${result.skipped}`);
    setTimeout(() => setImportResult(null), 5000);
  };

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 28, overflowY: "auto" }}>

      {/* Appearance */}
      <section>
        <h3 style={sectionTitle}>Appearance</h3>
        <div style={{ display: "flex", gap: 8 }}>
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              onClick={() => dispatch(setTheme(t))}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                borderRadius: "var(--radius-sm)",
                background: theme === t ? "var(--accent)" : "var(--surface-raised)",
                color: theme === t ? "var(--accent-fg)" : "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* Timer / Pomodoro */}
      <section>
        <h3 style={sectionTitle}>Timer</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
          <Toggle
            checked={pomodoroEnabled}
            onChange={(v) => dispatch(setPomodoroEnabled(v))}
            label="Enable Pomodoro"
          />
          {pomodoroEnabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 2 }}>
              {(
                [
                  { label: "Work (min)", key: "workMinutes" as const, value: pomodoro.workMinutes },
                  { label: "Short break (min)", key: "breakMinutes" as const, value: pomodoro.breakMinutes },
                  { label: "Long break (min)", key: "longBreakMinutes" as const, value: pomodoro.longBreakMinutes },
                  { label: "Sessions per cycle", key: "sessionsPerCycle" as const, value: pomodoro.sessionsPerCycle },
                ] as const
              ).map(({ label, key, value }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label style={{ fontSize: 13, color: "var(--text-secondary)", width: 160 }}>{label}</label>
                  <input
                    type="number"
                    min={1}
                    value={value}
                    onChange={(e) => dispatch(setPomodoro({ [key]: Number(e.target.value) }))}
                    style={{ width: 70 }}
                  />
                </div>
              ))}
            </div>
          )}
          {config && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)", width: 160 }}>
                Default hourly rate (€)
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={config.default_hourly_rate}
                onChange={(e) =>
                  dispatch(updateConfig({ key: "default_hourly_rate", value: Number(e.target.value) }))
                }
                style={{ width: 70 }}
              />
            </div>
          )}
        </div>
      </section>

      {/* Projects */}
      <section>
        <h3 style={sectionTitle}>Projects</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          Double-click a name to rename it. Use ↑↓ to reorder. Projects appear in the dashboard quick-start browser.
        </p>
        <CategoriesEditor />
      </section>

      {/* Supabase Sync */}
      <section>
        <h3 style={sectionTitle}>Supabase Sync</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 400 }}>
          <input placeholder="Project URL" value={supaUrl} onChange={(e) => setSupaUrl(e.target.value)} />
          <input placeholder="Anon key" type="password" value={supaKey} onChange={(e) => setSupaKey(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveSupabase} style={btnPrimary}>Save</button>
            <button onClick={testConn} style={btnSecondary}>Test Connection</button>
          </div>
          {connStatus && (
            <div style={{ fontSize: 12, color: connStatus === "Connected" ? "var(--success)" : "var(--danger)" }}>
              {connStatus}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => dispatch(runSync())} disabled={sync.isSyncing} style={btnSecondary}>Sync Both</button>
            <button onClick={() => dispatch(runPush())} disabled={sync.isSyncing} style={btnSecondary}>Push</button>
            <button onClick={() => dispatch(runPull())} disabled={sync.isSyncing} style={btnSecondary}>Pull</button>
          </div>
          {sync.lastSync && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Last sync: {new Date(sync.lastSync).toLocaleString()}
            </div>
          )}
          {sync.error && <div style={{ fontSize: 12, color: "var(--danger)" }}>{sync.error}</div>}
        </div>
        {config && (
          <div style={{ marginTop: 12 }}>
            <Toggle
              checked={config.supabase.auto_sync}
              onChange={(v) => dispatch(updateConfig({ key: "supabase.auto_sync", value: v }))}
              label="Sync automatically every 5 minutes"
            />
          </div>
        )}
      </section>

      {/* Export / Import — desktop only (iOS has no filesystem access) */}
      {!IS_IOS && (
        <section>
          <h3 style={sectionTitle}>Export / Import</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleExportCsv} style={btnSecondary}>Export CSV</button>
            <button onClick={handleExportJson} style={btnSecondary}>Export JSON</button>
            <button onClick={handleImportJson} style={btnSecondary}>Import JSON</button>
          </div>
          {importResult && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{importResult}</div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 12,
};

const iconBtn: React.CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  padding: "2px 5px",
  fontSize: 12,
  borderRadius: 3,
  cursor: "pointer",
  flexShrink: 0,
};

const btnSmallPrimary: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--accent-fg)",
  padding: "4px 12px",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  cursor: "pointer",
  flexShrink: 0,
};

const btnSmallSecondary: React.CSSProperties = {
  background: "var(--surface-raised)",
  color: "var(--text-secondary)",
  border: "1px solid var(--border)",
  padding: "4px 10px",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  cursor: "pointer",
  flexShrink: 0,
};

const btnPrimary: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--accent-fg)",
  padding: "7px 14px",
  borderRadius: "var(--radius-sm)",
  fontSize: 13,
};

const btnSecondary: React.CSSProperties = {
  background: "var(--surface-raised)",
  color: "var(--text-secondary)",
  border: "1px solid var(--border)",
  padding: "7px 14px",
  borderRadius: "var(--radius-sm)",
  fontSize: 13,
};
