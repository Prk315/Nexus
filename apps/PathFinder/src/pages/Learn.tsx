import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain, BookOpen, FileText, GraduationCap, ClipboardList, Link2,
  CheckCircle2, Circle, Plus, ExternalLink, RefreshCw, Flame,
} from "lucide-react";
import {
  getLearnDay, getLearnMaterials, logLearnProgress, createLearnMaterial,
  updateLearnMaterial, markLearnDayDone,
} from "../lib/api";
import type { LearnMaterial, LearnPlan, MaterialKind, MaterialStatus } from "../lib/api";
import { deltaForLogTo } from "../lib/learnProgress";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";

// The Learn tab: the composed learning day (written by the learn-plan edge
// function on pg_cron) + the materials whose progress DRIVES tomorrow's
// composition. Logging here is not bookkeeping — it is the input the
// generator reads to pick the next reading range.

const KIND_META: Record<MaterialKind, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  book: { label: "Books", icon: BookOpen },
  document: { label: "Documents", icon: FileText },
  paper: { label: "Papers", icon: FileText },
  lesson: { label: "Lessons", icon: GraduationCap },
  assignment: { label: "Assignments", icon: ClipboardList },
  course: { label: "Courses", icon: GraduationCap },
};
const KIND_ORDER: MaterialKind[] = ["book", "lesson", "assignment", "document", "paper", "course"];

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// ── Today card ──────────────────────────────────────────────────────────────

function BriefText({ md }: { md: string }) {
  // The brief is deterministic markdown from the generator; render it with a
  // tiny line-level pass rather than pulling a markdown stack into this page.
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {md.split("\n").map((line, i) => {
        if (line.startsWith("# ")) return null;
        if (line.startsWith("## ")) {
          return <div key={i} className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{line.slice(3)}</div>;
        }
        if (!line.trim()) return null;
        const text = line.replace(/\*\*/g, "").replace(/^\s*[-]\s*/, "· ");
        return <div key={i}>{text}</div>;
      })}
    </div>
  );
}

function TodayCard({ plan, onDone, onRefresh }: {
  plan: LearnPlan | null;
  onDone: () => void;
  onRefresh: () => void;
}) {
  const [showBrief, setShowBrief] = useState(true);
  if (!plan) {
    // Missing means "not generated", never "nothing to do" — same rule as
    // blocking_state. The cron passes every 30 minutes.
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        Today's plan hasn't been generated yet — the generator runs every 30 minutes.
        <Button variant="ghost" size="sm" className="ml-2" onClick={onRefresh}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Check again
        </Button>
      </div>
    );
  }
  const b = plan.blocks;
  const rows: Array<{ label: string; minutes: number | undefined; body: React.ReactNode }> = [
    { label: "Intro", minutes: b.intro?.minutes, body: <span>Read the brief below — say the say-backs out loud first.</span> },
    {
      label: "Reading",
      minutes: b.reading?.minutes,
      body: b.reading
        ? <span>{b.reading.title}, {b.reading.unit_label === "pages" ? "pp." : b.reading.unit_label} <b>{b.reading.from}–{b.reading.to}</b></span>
        : <span className="text-muted-foreground">no active reading material</span>,
    },
    {
      label: "Lesson",
      minutes: b.lesson?.minutes,
      body: b.lesson?.retention
        ? <span className="text-muted-foreground">retention day — the review session <i>is</i> the work</span>
        : (
          <span className="inline-flex items-center gap-1.5">
            {b.lesson?.title}
            {b.lesson?.url && (
              <a href={b.lesson.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                open <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </span>
        ),
    },
    {
      label: "Repetition",
      minutes: b.review?.minutes,
      body: <span>
        {b.review?.due_concepts != null
          ? `${b.review.due_concepts} concepts due — Dagens lektion in Nexus Learn`
          : "open Dagens lektion in Nexus Learn"}
      </span>,
    },
  ];
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Brain className="h-4 w-4" /> Today — {plan.planDate}
        </h2>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowBrief((v) => !v)}
          >
            {showBrief ? "hide brief" : "show brief"}
          </button>
          {plan.status === "done" ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> done
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={onDone}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark day done
            </Button>
          )}
        </div>
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{i + 1}</span>
            <div className="min-w-0">
              <span className="font-medium">{r.label}</span>
              {r.minutes ? <span className="ml-1.5 text-xs text-muted-foreground">{r.minutes} min</span> : null}
              <div className="text-muted-foreground">{r.body}</div>
            </div>
          </li>
        ))}
      </ol>
      {showBrief && (
        <div className="rounded-lg bg-muted/40 p-3">
          <BriefText md={plan.briefMd} />
        </div>
      )}
    </div>
  );
}

// ── Material row ────────────────────────────────────────────────────────────

function MaterialRow({ m, onLogged, onChanged }: {
  m: LearnMaterial;
  onLogged: () => void;
  onChanged: () => void;
}) {
  const [toPage, setToPage] = useState("");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const pct = m.fraction != null ? Math.round(m.fraction * 100) : null;

  const log = async () => {
    const to = Number(toPage);
    // ⚠️ Number("") is 0 and 0 is finite — an empty field must not log page 0.
    if (!toPage.trim() || !Number.isFinite(to) || busy) return;
    setBusy(true);
    try {
      const delta = deltaForLogTo(m.position, to);
      await logLearnProgress({
        materialId: m.id,
        kind: m.kind === "lesson" ? "lesson" : "reading",
        unitsFrom: delta != null ? m.position : null,
        unitsTo: to,
        unitsDelta: delta,
        minutes: minutes.trim() ? Number(minutes) : null,
      });
      setToPage(""); setMinutes("");
      onLogged();
    } finally { setBusy(false); }
  };

  const logMinutesOnly = async () => {
    if (!minutes.trim() || busy) return;
    setBusy(true);
    try {
      await logLearnProgress({
        materialId: m.id,
        kind: m.kind === "lesson" ? "lesson" : m.kind === "assignment" ? "exercise" : "reading",
        minutes: Number(minutes),
      });
      setMinutes("");
      onLogged();
    } finally { setBusy(false); }
  };

  const cycleStatus = async () => {
    const next: MaterialStatus = m.status === "active" ? "done" : m.status === "done" ? "paused" : "active";
    await updateLearnMaterial(m.id, { status: next });
    onChanged();
  };

  const paged = m.unitLabel === "pages" && (m.kind === "book" || m.kind === "document" || m.kind === "paper");

  return (
    <div className={cn("rounded-lg border p-3", m.status !== "active" && "opacity-60")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{m.title}</span>
            {m.url && (
              <a href={m.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                <Link2 className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {paged && (
              <>at {m.unitLabel === "pages" ? "p." : ""} {Math.floor(m.position)}
                {m.total_units != null && <> / {Math.floor(m.total_units)}</>}
                {" · "}
              </>
            )}
            {m.lastActivity ? `last ${m.lastActivity}` : "no activity yet"}
            {m.dueDate && <> · due {m.dueDate}</>}
          </div>
        </div>
        <button
          onClick={cycleStatus}
          title={`status: ${m.status} (click to cycle)`}
          className="flex-none text-xs font-medium"
        >
          {m.status === "done"
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            : m.status === "paused"
              ? <Circle className="h-5 w-5 text-muted-foreground/40" />
              : <Circle className="h-5 w-5 text-primary/70" />}
        </button>
      </div>

      {pct != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}

      {m.status === "active" && (
        <div className="mt-2 flex items-center gap-1.5">
          {paged && (
            <Input
              value={toPage}
              onChange={(e) => setToPage(e.target.value)}
              placeholder="to page"
              inputMode="numeric"
              className="h-7 w-20 text-xs"
              onKeyDown={(e) => { if (e.key === "Enter") log(); }}
            />
          )}
          <Input
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="min"
            inputMode="numeric"
            className="h-7 w-14 text-xs"
            onKeyDown={(e) => { if (e.key === "Enter") (paged && toPage.trim() ? log() : logMinutesOnly()); }}
          />
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy}
            onClick={() => (paged && toPage.trim() ? log() : logMinutesOnly())}>
            Log
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Add material ────────────────────────────────────────────────────────────

function AddMaterial({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MaterialKind>("book");
  const [title, setTitle] = useState("");
  const [total, setTotal] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await createLearnMaterial({
        kind,
        title: title.trim(),
        totalUnits: total.trim() ? Number(total) : null,
        url: url.trim() || null,
      });
      setTitle(""); setTotal(""); setUrl(""); setOpen(false);
      onAdded();
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> Add material
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as MaterialKind)}
        className="h-8 rounded-md border bg-background px-2 text-xs"
      >
        {KIND_ORDER.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="h-8 w-52 text-xs" />
      <Input value={total} onChange={(e) => setTotal(e.target.value)} placeholder="total pages" inputMode="numeric" className="h-8 w-24 text-xs" />
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="url (optional)" className="h-8 w-40 text-xs" />
      <Button size="sm" className="h-8" disabled={busy || !title.trim()} onClick={add}>Add</Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function Learn() {
  const [plan, setPlan] = useState<LearnPlan | null>(null);
  const [materials, setMaterials] = useState<LearnMaterial[] | null>(null); // null = loading
  const [error, setError] = useState<string | null>(null);
  const date = todayYmd();

  const load = useCallback(async () => {
    try {
      setError(null);
      const [p, m] = await Promise.all([getLearnDay(date), getLearnMaterials()]);
      setPlan(p);
      setMaterials(m);
    } catch (e) {
      // signedOut/loading/error are distinct from "zero rows" — never render
      // a failure as an empty tracker.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const g = new Map<MaterialKind, LearnMaterial[]>();
    for (const m of materials ?? []) {
      const list = g.get(m.kind) ?? [];
      list.push(m);
      g.set(m.kind, list);
    }
    return g;
  }, [materials]);

  const weekMinutes = useMemo(() => {
    // Shown top-right as a tiny "this week" pulse; the brief holds the rest.
    return null; // v1: the brief carries week totals
  }, []);
  void weekMinutes;

  const markDone = async () => {
    await markLearnDayDone(date);
    load();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Flame className="h-5 w-5 text-primary" /> Learn
        </h1>
        <AddMaterial onAdded={load} />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          Couldn't load the Learn data: {error}
        </div>
      )}

      <TodayCard plan={plan} onDone={markDone} onRefresh={load} />

      {materials === null && !error && (
        <div className="text-sm text-muted-foreground">Loading materials…</div>
      )}

      {KIND_ORDER.map((kind) => {
        const list = grouped.get(kind);
        if (!list?.length) return null;
        const Meta = KIND_META[kind];
        return (
          <section key={kind} className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Meta.icon className="h-4 w-4" /> {Meta.label}
            </h2>
            <div className="space-y-2">
              {list.map((m) => (
                <MaterialRow key={m.id} m={m} onLogged={load} onChanged={load} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
