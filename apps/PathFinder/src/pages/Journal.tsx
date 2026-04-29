import { useEffect, useState, useRef, useCallback } from "react";
import { BookOpen, Sun, Moon, ChevronLeft, ChevronRight, Pencil, Trash2, Plus, X, Check } from "lucide-react";
import { getJournalForPeriod, saveJournalForPeriod, getRules, createRule, updateRule, deleteRule } from "../lib/api";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { Rule } from "../types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", day: "numeric", month: "short",
  });
}

interface JournalTextareaProps {
  date: string;
  period: string;
}

function JournalTextarea({ date, period }: JournalTextareaProps) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedValueRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setValue("");
    savedValueRef.current = "";
    getJournalForPeriod(date, period).then((content) => {
      if (!cancelled) {
        setValue(content);
        savedValueRef.current = content;
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [date, period]);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const handleBlur = useCallback(async () => {
    if (value === savedValueRef.current) return;
    savedValueRef.current = value;
    await saveJournalForPeriod(date, period, value);
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, [date, period, value]);

  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        disabled={loading}
        placeholder={loading ? "Loading…" : `Write your ${period} entry…`}
        className={cn(
          "w-full min-h-[120px] rounded-xl border border-input bg-background px-4 py-3 text-sm resize-none",
          "focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50",
          "disabled:opacity-50"
        )}
      />
      <span
        className={cn(
          "absolute bottom-3 right-3 text-xs text-muted-foreground/70 transition-opacity duration-500",
          saved ? "opacity-100" : "opacity-0"
        )}
      >
        Saved
      </span>
    </div>
  );
}

interface RuleItemProps {
  rule: Rule;
  onUpdated: (rule: Rule) => void;
  onDeleted: (id: number) => void;
}

function RuleItem({ rule, onUpdated, onDeleted }: RuleItemProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(rule.title);
  const [body, setBody] = useState(rule.body ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const updated = await updateRule(rule.id, { title: title.trim(), body: body.trim() || null });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTitle(rule.title);
    setBody(rule.body ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Rule title"
          className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details (optional)"
          rows={2}
          className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !title.trim()}>
            <Check className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-xl border border-border bg-card px-4 py-3 flex gap-3 items-start">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{rule.title}</p>
        {rule.body && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{rule.body}</p>}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDeleted(rule.id)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

interface AddRuleFormProps {
  onAdded: (rule: Rule) => void;
  onCancel: () => void;
}

function AddRuleForm({ onAdded, onCancel }: AddRuleFormProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const rule = await createRule({ title: title.trim(), body: body.trim() || null });
      onAdded(rule);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onCancel(); }}
        placeholder="Rule title"
        className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
        className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={saving || !title.trim()}>
          <Check className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

const TODAY = todayISO();

export function Journal() {
  const [date, setDate] = useState(TODAY);
  const [rules, setRules] = useState<Rule[]>([]);
  const [addingRule, setAddingRule] = useState(false);

  useEffect(() => {
    getRules().then(setRules);
  }, []);

  const handleDeleteRule = async (id: number) => {
    await deleteRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleRuleUpdated = (updated: Rule) => {
    setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleRuleAdded = (rule: Rule) => {
    setRules((prev) => [...prev, rule]);
    setAddingRule(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Journal</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate((d) => shiftDate(d, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[110px] text-center text-sm font-medium tabular-nums">
            {formatDateLabel(date)}
          </span>
          <button
            onClick={() => setDate((d) => shiftDate(d, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {date !== TODAY && (
            <Button size="sm" variant="outline" onClick={() => setDate(TODAY)}>
              Today
            </Button>
          )}
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">Morning</h2>
        </div>
        <JournalTextarea key={`${date}-morning`} date={date} period="morning" />
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Moon className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">Evening</h2>
        </div>
        <JournalTextarea key={`${date}-evening`} date={date} period="evening" />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-center border-t border-border pt-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-2">Rules</span>
        </div>

        {rules.length === 0 && !addingRule && (
          <p className="text-sm text-muted-foreground text-center py-2">No rules yet. Add one to keep yourself accountable.</p>
        )}

        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleItem
              key={rule.id}
              rule={rule}
              onUpdated={handleRuleUpdated}
              onDeleted={handleDeleteRule}
            />
          ))}

          {addingRule ? (
            <AddRuleForm onAdded={handleRuleAdded} onCancel={() => setAddingRule(false)} />
          ) : (
            <button
              onClick={() => setAddingRule(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add rule
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
