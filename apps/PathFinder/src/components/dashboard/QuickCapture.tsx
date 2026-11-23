// The Dashboard's capture bar: one input that can file anything.
//
// The dashboard could already add a task, but everything else the day throws
// at you — a reminder with a time, a shopping item, a note, an event — meant
// finding the right sidebar box first, and on the phone there was no sidebar at
// all. This bar takes the text, a kind, and (where the kind has one) a time or
// date, and files it where it belongs.
//
// Tasks go through the Dashboard's own create path (due today, so the row
// appears in the list underneath). Everything else goes through the quick-tool
// provider's `capture`, so the sidebar badge moves the moment it is filed.
//
// The tool boxes sit on the right of the bar: the same buttons as the sidebar,
// placed where the day is actually planned.

import { useState } from "react";
import {
  CheckSquare, Bell, ShoppingCart, Brush, FileText, Zap, Calendar, Clock, Handshake, Plus, AlarmClock,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { QuickPanelButtons, useQuickPanels, type CaptureKind, type QuickPanelId } from "../QuickPanels";
import { parseChoreInput, parseShoppingInput } from "../../lib/quickItems";
import { fromLocalInputValue, reminderPresets, toLocalInputValue } from "../../lib/reminders";
import { todayDateStr } from "../../lib/quickSchedule";

type Kind = "task" | CaptureKind;

const KINDS: { id: Kind; label: string; icon: React.ComponentType<{ className?: string }>; placeholder: string; panel?: QuickPanelId }[] = [
  { id: "task",      label: "Task",      icon: CheckSquare,  placeholder: "Task for today…" },
  { id: "reminder",  label: "Reminder",  icon: Bell,         placeholder: "Remind me to…",          panel: "reminders" },
  { id: "shopping",  label: "Shopping",  icon: ShoppingCart, placeholder: "2x milk @netto",         panel: "shopping" },
  { id: "chore",     label: "Chore",     icon: Brush,        placeholder: "wipe counters #kitchen", panel: "chores" },
  { id: "note",      label: "Note",      icon: FileText,     placeholder: "Note title…",            panel: "notes" },
  { id: "brain",     label: "Brain dump", icon: Zap,         placeholder: "Whatever's on your mind…", panel: "brain" },
  { id: "event",     label: "Event",     icon: Calendar,     placeholder: "Event…",                 panel: "events" },
  { id: "deadline",  label: "Deadline",  icon: Clock,        placeholder: "Deadline…",              panel: "deadlines" },
  { id: "agreement", label: "Agreement", icon: Handshake,    placeholder: "What was agreed…",       panel: "agreements" },
];

const KIND_KEY = "pf-dash-capture-kind";

export function QuickCapture({ onCreateTask }: {
  /** The Dashboard's own task-create path (due today). */
  onCreateTask: (title: string) => Promise<void>;
}) {
  const { capture, openPanel } = useQuickPanels();
  // The last-used kind sticks: a run of shopping items shouldn't need the chip
  // re-picked for every line.
  const [kind, setKind] = useState<Kind>(() => {
    try {
      const v = localStorage.getItem(KIND_KEY);
      return KINDS.some((k) => k.id === v) ? (v as Kind) : "task";
    } catch { return "task"; }
  });
  const [text, setText] = useState("");
  const [date, setDate] = useState(() => todayDateStr());
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string; panel?: QuickPanelId } | null>(null);

  const def = KINDS.find((k) => k.id === kind)!;

  const pick = (k: Kind) => {
    setKind(k);
    try { localStorage.setItem(KIND_KEY, k); } catch { /* not persisted */ }
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (kind === "task") await onCreateTask(t);
      else await capture(kind, t, { date, reminder: { remind_at: remindAt, lead_minutes: null } });
      setText("");
      setRemindAt(null);
      setFlash({ ok: true, msg: `Added to ${def.label}`, panel: def.panel });
    } catch (e) {
      // The text stays in the box so nothing typed is lost to a failed write.
      setFlash({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const hint = (() => {
    if (!text.trim()) return null;
    if (kind === "shopping") {
      const p = parseShoppingInput(text);
      return p.quantity || p.store ? `${p.title}${p.quantity ? ` · qty ${p.quantity}` : ""}${p.store ? ` · @${p.store}` : ""}` : null;
    }
    if (kind === "chore") {
      const p = parseChoreInput(text);
      return p.area ? `${p.title} · #${p.area}` : null;
    }
    return null;
  })();

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 min-w-[14rem] items-center gap-1.5">
          <def.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); if (flash) setFlash(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={def.placeholder}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          {(kind === "event" || kind === "deadline") && (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayDateStr())}
              className="h-7 rounded border border-border bg-transparent px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          )}
          {kind === "reminder" && (
            <input
              type="datetime-local"
              value={toLocalInputValue(remindAt)}
              onChange={(e) => setRemindAt(fromLocalInputValue(e.target.value))}
              title="When (optional)"
              className="h-7 rounded border border-border bg-transparent px-1.5 text-xs tabular-nums outline-none focus:ring-1 focus:ring-ring"
            />
          )}
          <button
            onClick={submit}
            disabled={!text.trim() || busy}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        <QuickPanelButtons layout="row" size="sm" className="shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => pick(k.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              kind === k.id
                ? "border-primary/50 bg-primary/10 text-foreground font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
            )}
          >
            <k.icon className="h-3 w-3" />
            {k.label}
          </button>
        ))}
        {kind === "reminder" && reminderPresets(new Date()).map((p) => (
          <button
            key={p.label}
            onClick={() => setRemindAt(p.iso)}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <AlarmClock className="h-2.5 w-2.5" /> {p.label}
          </button>
        ))}
      </div>

      {(hint || flash) && (
        <div className="flex items-center gap-2 pl-0.5 text-[11px]">
          {hint && !flash && <span className="text-muted-foreground">Adds {hint}</span>}
          {flash && (
            <span className={flash.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
              {flash.msg}
              {flash.ok && flash.panel && (
                <button
                  data-quick-panel-trigger
                  onClick={() => openPanel(flash.panel!)}
                  className="ml-1.5 underline underline-offset-2 hover:no-underline"
                >
                  Open
                </button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
