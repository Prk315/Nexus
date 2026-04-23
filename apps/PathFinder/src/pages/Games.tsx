import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus, Trash2, Pencil, X, ChevronDown, ChevronRight,
  Gamepad2, FileText, Columns3, BookOpenText,
} from "lucide-react";
import {
  getGames, createGame, updateGame, deleteGame,
  getGameFeatures, createGameFeature, setGameFeatureStatus, deleteGameFeature,
  getGameDevlog, addGameDevlogEntry, deleteGameDevlogEntry,
} from "../lib/api";
import { Progress } from "../components/ui/progress";
import { cn } from "../lib/utils";
import type { Game, GameFeature, GameDevlogEntry } from "../types";

// ── Constants ─────────────────────────────────────────────────────────────────

const GAME_STATUSES = [
  { value: "concept",   label: "Concept",   color: "bg-slate-500/10 text-slate-500 border-slate-400/30" },
  { value: "prototype", label: "Prototype", color: "bg-blue-500/10 text-blue-500 border-blue-400/30" },
  { value: "in_dev",    label: "In Dev",    color: "bg-violet-500/10 text-violet-500 border-violet-400/30" },
  { value: "alpha",     label: "Alpha",     color: "bg-amber-500/10 text-amber-500 border-amber-400/30" },
  { value: "beta",      label: "Beta",      color: "bg-orange-500/10 text-orange-500 border-orange-400/30" },
  { value: "released",  label: "Released",  color: "bg-emerald-500/10 text-emerald-500 border-emerald-400/30" },
  { value: "paused",    label: "Paused",    color: "bg-muted text-muted-foreground border-border" },
] as const;

type GameStatus = (typeof GAME_STATUSES)[number]["value"];

const FEATURE_COLS = [
  { id: "idea",   label: "Ideas" },
  { id: "in_dev", label: "In Dev" },
  { id: "done",   label: "Done" },
] as const;

const PRIORITY_OPTS = ["high", "medium", "low"] as const;

const COLOR_OPTS = [
  "violet", "blue", "indigo", "emerald", "teal", "cyan",
  "orange", "amber", "pink", "rose", "red", "slate",
] as const;

const COLOR_DOT: Record<string, string> = {
  violet:  "bg-violet-500",  blue:    "bg-blue-500",
  indigo:  "bg-indigo-500",  emerald: "bg-emerald-500",
  teal:    "bg-teal-500",    cyan:    "bg-cyan-500",
  orange:  "bg-orange-500",  amber:   "bg-amber-500",
  pink:    "bg-pink-500",    rose:    "bg-rose-500",
  red:     "bg-red-500",     slate:   "bg-slate-400",
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500", medium: "bg-amber-400", low: "bg-slate-400",
};

function statusInfo(s: string) {
  return GAME_STATUSES.find((x) => x.value === s) ?? GAME_STATUSES[0];
}

// ── Field / input helpers ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "h-8 rounded-md border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-full";
const textareaCls = "rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none w-full";

// ── Game Form ─────────────────────────────────────────────────────────────────

interface GameForm {
  title: string; genre: string; platform: string; engine: string;
  status: GameStatus; description: string; color: string;
}

function GameFormPanel({
  initial, onSave, onCancel,
}: {
  initial?: Game;
  onSave: (f: GameForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<GameForm>({
    title:       initial?.title       ?? "",
    genre:       initial?.genre       ?? "",
    platform:    initial?.platform    ?? "",
    engine:      initial?.engine      ?? "",
    status:      (initial?.status as GameStatus) ?? "concept",
    description: initial?.description ?? "",
    color:       initial?.color       ?? "violet",
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<GameForm>) => setForm((f) => ({ ...f, ...p }));

  async function handleSave() {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{initial ? "Edit game" : "New game"}</h3>

      <Field label="Title">
        <input autoFocus className={inputCls} placeholder="Game title"
          value={form.title} onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }} />
      </Field>

      <Field label="Description">
        <textarea className={textareaCls} rows={2} placeholder="Short description of the game…"
          value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Genre">
          <input className={inputCls} placeholder="e.g. Roguelike, Platformer…"
            value={form.genre} onChange={(e) => set({ genre: e.target.value })} />
        </Field>
        <Field label="Platform">
          <input className={inputCls} placeholder="e.g. PC, Mobile, Web…"
            value={form.platform} onChange={(e) => set({ platform: e.target.value })} />
        </Field>
        <Field label="Engine">
          <input className={inputCls} placeholder="e.g. Unity, Godot, Bevy…"
            value={form.engine} onChange={(e) => set({ engine: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={(e) => set({ status: e.target.value as GameStatus })}>
            {GAME_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Color">
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {COLOR_OPTS.map((c) => (
            <button key={c} onClick={() => set({ color: c })}
              className={cn("h-5 w-5 rounded-full transition-all", COLOR_DOT[c],
                form.color === c ? "ring-2 ring-offset-1 ring-ring scale-110" : "opacity-60 hover:opacity-100")} />
          ))}
        </div>
      </Field>

      <div className="flex items-center gap-2 pt-1">
        <button disabled={!form.title.trim() || saving} onClick={handleSave}
          className="flex-1 h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {initial ? "Save changes" : "Create game"}
        </button>
        <button onClick={onCancel} className="h-8 px-3 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ game, onUpdate }: { game: Game; onUpdate: (g: Game) => void }) {
  const [coreMechanic,   setCoreMechanic]   = useState(game.core_mechanic   ?? "");
  const [targetAudience, setTargetAudience] = useState(game.target_audience ?? "");
  const [inspiration,    setInspiration]    = useState(game.inspiration     ?? "");
  const [dirty,          setDirty]          = useState(false);
  const [saving,         setSaving]         = useState(false);

  function track<T extends string>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  async function save() {
    setSaving(true);
    try {
      const g = await updateGame(game.id, {
        title: game.title, genre: game.genre, platform: game.platform,
        engine: game.engine, status: game.status, description: game.description,
        color: game.color,
        core_mechanic:   coreMechanic   || null,
        target_audience: targetAudience || null,
        inspiration:     inspiration    || null,
      });
      onUpdate(g);
      setDirty(false);
    } finally { setSaving(false); }
  }

  return (
    <div className="p-6 flex flex-col gap-5 max-w-2xl">
      {game.description && (
        <p className="text-sm text-muted-foreground border-l-2 border-border pl-3">{game.description}</p>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        {game.genre    && <div><span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">Genre</span>{game.genre}</div>}
        {game.platform && <div><span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">Platform</span>{game.platform}</div>}
        {game.engine   && <div><span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">Engine</span>{game.engine}</div>}
      </div>

      <Field label="Core mechanic — what makes it fun?">
        <textarea className={textareaCls} rows={3}
          placeholder="Describe the central gameplay loop or mechanic…"
          value={coreMechanic} onChange={(e) => track(setCoreMechanic)(e.target.value)} />
      </Field>
      <Field label="Target audience — who is this for?">
        <textarea className={textareaCls} rows={2}
          placeholder="Who will enjoy this game? Age range, interests, skill level…"
          value={targetAudience} onChange={(e) => track(setTargetAudience)(e.target.value)} />
      </Field>
      <Field label="Inspiration — what games or ideas influenced this?">
        <textarea className={textareaCls} rows={2}
          placeholder="Reference games, art styles, mechanics you're building on…"
          value={inspiration} onChange={(e) => track(setInspiration)(e.target.value)} />
      </Field>

      {dirty && (
        <button onClick={save} disabled={saving}
          className="self-start h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving ? "Saving…" : "Save"}
        </button>
      )}
    </div>
  );
}

// ── Tab: Features (kanban) ────────────────────────────────────────────────────

function FeatureCard({ feature, cols, onMove, onDelete }: {
  feature: GameFeature;
  cols: typeof FEATURE_COLS;
  onMove: (status: string) => void;
  onDelete: () => void;
}) {
  const colIdx = cols.findIndex((c) => c.id === feature.status);
  return (
    <div className="rounded-md border border-border bg-card p-2.5 flex flex-col gap-1.5 group">
      <div className="flex items-start gap-1.5">
        <span className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", PRIORITY_DOT[feature.priority] ?? "bg-slate-400")} />
        <span className="flex-1 text-sm leading-snug">{feature.title}</span>
        <button onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0">
          <X className="h-3 w-3" />
        </button>
      </div>
      {feature.description && (
        <p className="text-[11px] text-muted-foreground leading-snug pl-3.5">{feature.description}</p>
      )}
      <div className="flex items-center gap-0.5 pl-3.5">
        {colIdx > 0 && (
          <button onClick={() => onMove(cols[colIdx - 1].id)}
            className="text-[9px] px-1 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors">←</button>
        )}
        {colIdx < cols.length - 1 && (
          <button onClick={() => onMove(cols[colIdx + 1].id)}
            className="text-[9px] px-1 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors">→</button>
        )}
      </div>
    </div>
  );
}

function AddFeatureInCol({ colId, gameId, onAdd }: {
  colId: string; gameId: number;
  onAdd: (f: GameFeature) => void;
}) {
  const [open,     setOpen]     = useState(false);
  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [priority, setPriority] = useState("medium");

  async function commit() {
    if (!title.trim()) return;
    const f = await createGameFeature({ game_id: gameId, title: title.trim(), description: desc || null, status: colId, priority });
    onAdd(f);
    setTitle(""); setDesc(""); setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
        <Plus className="h-3 w-3" /> Add feature
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2">
      <input autoFocus className="h-7 rounded border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-full"
        placeholder="Feature title…" value={title} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setOpen(false); }} />
      <input className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring w-full"
        placeholder="Short description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex items-center gap-1">
        <select className="h-6 flex-1 rounded border border-input bg-transparent px-1 text-xs focus:outline-none"
          value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={commit}
          className="h-6 px-2 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">Add</button>
        <button onClick={() => setOpen(false)}
          className="h-6 w-6 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function FeaturesTab({ game }: { game: Game }) {
  const [features, setFeatures] = useState<GameFeature[]>([]);

  const load = useCallback(async () => {
    setFeatures(await getGameFeatures(game.id));
  }, [game.id]);

  useEffect(() => { load(); }, [load]);

  async function handleMove(id: number, status: string) {
    const f = await setGameFeatureStatus(id, status);
    setFeatures((prev) => prev.map((x) => x.id === id ? f : x));
  }
  async function handleDelete(id: number) {
    await deleteGameFeature(id);
    setFeatures((prev) => prev.filter((x) => x.id !== id));
  }
  function handleAdd(f: GameFeature) {
    setFeatures((prev) => [...prev, f]);
  }

  return (
    <div className="flex gap-3 p-6 h-full overflow-x-auto">
      {FEATURE_COLS.map((col) => {
        const colFeatures = features.filter((f) => f.status === col.id);
        return (
          <div key={col.id} className="flex flex-col gap-2 w-64 shrink-0">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{col.label}</span>
              <span className="text-[10px] text-muted-foreground">{colFeatures.length}</span>
            </div>
            <div className="flex flex-col gap-2 flex-1">
              {colFeatures.map((f) => (
                <FeatureCard key={f.id} feature={f} cols={FEATURE_COLS}
                  onMove={(status) => handleMove(f.id, status)}
                  onDelete={() => handleDelete(f.id)} />
              ))}
              <AddFeatureInCol colId={col.id} gameId={game.id} onAdd={handleAdd} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Devlog ───────────────────────────────────────────────────────────────

function DevlogTab({ game }: { game: Game }) {
  const [entries,   setEntries]   = useState<GameDevlogEntry[]>([]);
  const [draft,     setDraft]     = useState("");
  const [expanded,  setExpanded]  = useState<Set<number>>(new Set());
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setEntries(await getGameDevlog(game.id));
  }, [game.id]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!draft.trim()) return;
    const e = await addGameDevlogEntry({ game_id: game.id, content: draft.trim() });
    setEntries((prev) => [e, ...prev]);
    setDraft("");
  }

  async function handleDelete(id: number) {
    await deleteGameDevlogEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function fmtDate(iso: string) {
    return iso.slice(0, 10);
  }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-2xl">
      {/* New entry */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New entry</p>
        <textarea
          ref={textRef}
          className={textareaCls}
          rows={4}
          placeholder="What did you work on? Any decisions, ideas, or blockers…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd(); }}
        />
        <button onClick={handleAdd} disabled={!draft.trim()}
          className="self-start h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          Log entry <span className="text-xs opacity-60 ml-1">⌘↩</span>
        </button>
      </div>

      {/* Entry list */}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No devlog entries yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => {
            const lines = e.content.split("\n");
            const isLong = lines.length > 3 || e.content.length > 200;
            const isExp  = expanded.has(e.id);
            return (
              <div key={e.id} className="rounded-lg border border-border bg-card p-3 group">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(e.created_at)}</span>
                  <div className="flex-1" />
                  <button onClick={() => handleDelete(e.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className={cn("text-sm text-foreground whitespace-pre-wrap leading-relaxed", !isExp && isLong && "line-clamp-3")}>
                  {e.content}
                </p>
                {isLong && (
                  <button onClick={() => toggleExpand(e.id)}
                    className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {isExp ? <><ChevronDown className="h-3 w-3" /> Show less</> : <><ChevronRight className="h-3 w-3" /> Show more</>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Game Detail (tabbed) ──────────────────────────────────────────────────────

type Tab = "overview" | "features" | "devlog";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",  label: "Overview",  icon: FileText },
  { id: "features",  label: "Features",  icon: Columns3 },
  { id: "devlog",    label: "Devlog",    icon: BookOpenText },
];

function GameDetail({
  game, onUpdate, onDelete,
}: {
  game: Game; onUpdate: (g: Game) => void; onDelete: () => void;
}) {
  const [tab,     setTab]     = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);

  const si = statusInfo(game.status);
  const pct = game.feature_count === 0 ? 0 : Math.round((game.done_count / game.feature_count) * 100);

  async function handleSaveEdit(form: GameForm) {
    const g = await updateGame(game.id, {
      title: form.title, genre: form.genre || null, platform: form.platform || null,
      engine: form.engine || null, status: form.status, description: form.description || null,
      color: form.color,
      core_mechanic: game.core_mechanic, target_audience: game.target_audience,
      inspiration: game.inspiration,
    });
    onUpdate(g);
    setEditing(false);
  }

  async function handleDelete() {
    await deleteGame(game.id);
    onDelete();
  }

  if (editing) {
    return (
      <div className="p-6 max-w-xl">
        <GameFormPanel initial={game} onSave={handleSaveEdit} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-start gap-3">
          <div className={cn("h-3 w-3 rounded-full shrink-0 mt-1.5", COLOR_DOT[game.color] ?? "bg-violet-500")} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-lg font-semibold truncate">{game.title}</h2>
              <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", si.color)}>{si.label}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {game.genre    && <span>{game.genre}</span>}
              {game.platform && <span>· {game.platform}</span>}
              {game.engine   && <span>· {game.engine}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setEditing(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={handleDelete}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors" title="Delete game">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {game.feature_count > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <Progress value={game.done_count} max={game.feature_count} className="flex-1 h-1.5" />
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{pct}% features done · {game.done_count}/{game.feature_count}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-border px-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "overview" && <OverviewTab game={game} onUpdate={onUpdate} />}
        {tab === "features" && <FeaturesTab game={game} />}
        {tab === "devlog"   && <DevlogTab   game={game} />}
      </div>
    </div>
  );
}

// ── Games Page ────────────────────────────────────────────────────────────────

export function Games() {
  const [games,      setGames]      = useState<Game[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating,   setCreating]   = useState(false);
  const [filter,     setFilter]     = useState<GameStatus | "all">("all");

  const load = useCallback(async () => {
    setGames(await getGames());
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = games.filter((g) => filter === "all" || g.status === filter);
  const selected = games.find((g) => g.id === selectedId) ?? null;

  async function handleCreate(form: GameForm) {
    const g = await createGame({
      title: form.title, genre: form.genre || null, platform: form.platform || null,
      engine: form.engine || null, status: form.status,
      description: form.description || null, color: form.color,
    });
    setGames((prev) => [g, ...prev]);
    setSelectedId(g.id);
    setCreating(false);
  }

  function handleUpdate(updated: Game) {
    setGames((prev) => prev.map((g) => g.id === updated.id ? updated : g));
  }

  function handleDelete() {
    setGames((prev) => prev.filter((g) => g.id !== selectedId));
    setSelectedId(null);
  }

  return (
    <div className="flex h-[calc(100vh-2.5rem)] overflow-hidden">

      {/* Sidebar */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">Games</span>
          <button onClick={() => { setCreating(true); setSelectedId(null); }}
            className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="New game">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Status filter */}
        <div className="shrink-0 overflow-x-auto border-b border-border">
          <div className="flex min-w-max px-1 py-1 gap-0.5">
            <button onClick={() => setFilter("all")}
              className={cn("px-2 py-1 rounded text-[10px] font-medium transition-colors",
                filter === "all" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
              All
            </button>
            {GAME_STATUSES.map((s) => (
              <button key={s.value} onClick={() => setFilter(s.value)}
                className={cn("px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
                  filter === s.value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 h-32 text-center px-4">
              <Gamepad2 className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No games yet.</p>
            </div>
          ) : filtered.map((g) => {
            const pct = g.feature_count === 0 ? 0 : Math.round((g.done_count / g.feature_count) * 100);
            const si  = statusInfo(g.status);
            return (
              <button key={g.id} onClick={() => { setSelectedId(g.id); setCreating(false); }}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 transition-colors",
                  selectedId === g.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"
                )}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", COLOR_DOT[g.color] ?? "bg-violet-500")} />
                  <span className="text-sm font-medium truncate flex-1">{g.title}</span>
                </div>
                <div className="flex items-center gap-2 pl-4">
                  <span className={cn("text-[9px] px-1.5 py-0 rounded-full border font-medium shrink-0", si.color)}>{si.label}</span>
                  {g.genre && <span className="text-[10px] text-muted-foreground truncate">{g.genre}</span>}
                </div>
                {g.feature_count > 0 && (
                  <div className="flex items-center gap-2 mt-1.5 pl-4">
                    <Progress value={g.done_count} max={g.feature_count} className="flex-1 h-1" />
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{pct}%</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {creating ? (
          <div className="p-6 max-w-xl">
            <GameFormPanel onSave={handleCreate} onCancel={() => setCreating(false)} />
          </div>
        ) : selected ? (
          <GameDetail key={selected.id} game={selected} onUpdate={handleUpdate} onDelete={handleDelete} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Gamepad2 className="h-12 w-12 opacity-20" />
            <p className="text-sm">Select a game or create a new one</p>
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Plus className="h-4 w-4" /> New game
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
