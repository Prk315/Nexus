import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { cn } from "../utils";
import type { MailAxis, MailCategory, MailRule, MailRuleField } from "../mail/types";
import type { MailRulesApi } from "../mail/rulesApi";
import { pickableCategories } from "../mail/categories";
import {
  PRECEDENCE_COPY,
  RETROACTIVITY_COPY,
  RULE_FIELD_LABEL,
  RULE_PRECEDENCE,
  blankRule,
  describeRuleActions,
  nextRuleSort,
  orderRules,
  reorderRules,
  ruleWarnings,
} from "../mail/rules";
import { AXIS_LEVELS, IMPORTANCE_LABEL, URGENCY_LABEL } from "../mail/axes";

/**
 * The triage rules editor.
 *
 * **This edits rules as data. It never evaluates them.** `n8n-ingest` applies
 * them server-side, before the model, so a rule beats the model
 * deterministically and two clients cannot classify the same message two ways.
 * Nothing here matches a message against a rule — a second matcher would drift
 * from the one that actually runs and the UI would start explaining outcomes
 * that never happen.
 *
 * Chrome is copied from `apps/PathFinder/src/components/ui/dialog.tsx` so the
 * two apps' modals are visually identical, but imports `Dialog` from the
 * unified `radix-ui` package to match nexus-core's existing `DropdownMenu`
 * convention.
 */

export type MailRulesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: readonly MailRule[];
  categories: readonly MailCategory[];
  api: MailRulesApi;
  /** Called after any successful write, so the caller can invalidate its cache. */
  onChanged: () => void;
};

const inputCls =
  "h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring w-full";

const FIELDS: MailRuleField[] = ["sender", "domain", "subject", "list_id"];

/** A tri-state axis select: the empty option means "leave it to the model". */
function AxisSelect({
  value,
  labels,
  onChange,
  ariaLabel,
}: {
  value: MailAxis | null;
  labels: Record<MailAxis, string>;
  onChange: (v: MailAxis | null) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className={inputCls}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as MailAxis | null)}
    >
      {/* Not "medium" — an unset action leaves the field for the model, which
          is a different instruction from "set it to the middle". */}
      <option value="">— leave to model —</option>
      {AXIS_LEVELS.map((l) => (
        <option key={l} value={l}>
          {labels[l]}
        </option>
      ))}
    </select>
  );
}

function RuleCard({
  rule,
  all,
  categories,
  index,
  count,
  busy,
  onPatch,
  onCommit,
  onMove,
  onDelete,
}: {
  rule: MailRule;
  all: readonly MailRule[];
  categories: readonly MailCategory[];
  index: number;
  count: number;
  busy: boolean;
  onPatch: (patch: Partial<Omit<MailRule, "id">>) => void;
  /** Persist a free-text field. Called on blur, not per keystroke. */
  onCommit: (patch: Partial<Omit<MailRule, "id">>) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
}) {
  const warnings = ruleWarnings(rule, all);
  const pickable = pickableCategories(categories);
  // A rule may reference a category that was renamed, deleted or disabled
  // since. Keep it selectable rather than silently snapping to the first
  // option, which would rewrite the rule just by opening the editor.
  const orphanCategory =
    rule.set_category && !pickable.some((c) => c.name === rule.set_category)
      ? rule.set_category
      : null;

  return (
    <li
      className={cn(
        "rounded-lg border p-2.5 flex flex-col gap-2",
        rule.enabled ? "border-border" : "border-dashed border-border/60 opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground/60">
          {index + 1}
        </span>
        <input
          aria-label="Rule name"
          className={cn(inputCls, "flex-1 font-medium")}
          placeholder="Rule name"
          value={rule.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          onBlur={(e) => onCommit({ name: e.target.value })}
        />
        <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
          />
          On
        </label>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            title="Move up"
            disabled={index === 0 || busy}
            onClick={() => onMove(index - 1)}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Move down"
            disabled={index === count - 1 || busy}
            onClick={() => onMove(index + 1)}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Delete rule"
            disabled={busy}
            onClick={onDelete}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[10rem_1fr] gap-2">
        <select
          aria-label="Match field"
          className={inputCls}
          value={rule.field}
          onChange={(e) => onPatch({ field: e.target.value as MailRuleField })}
        >
          {FIELDS.map((f) => (
            <option key={f} value={f}>
              {RULE_FIELD_LABEL[f]}
            </option>
          ))}
        </select>
        <input
          aria-label="Match pattern"
          className={inputCls}
          placeholder={rule.field === "subject" ? "invoice" : "someone@example.com"}
          value={rule.pattern}
          onChange={(e) => onPatch({ pattern: e.target.value })}
          onBlur={(e) => onCommit({ pattern: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <select
          aria-label="Set category"
          className={inputCls}
          value={rule.set_category ?? ""}
          onChange={(e) => onPatch({ set_category: e.target.value || null })}
        >
          <option value="">— no category —</option>
          {orphanCategory && (
            <option value={orphanCategory}>{orphanCategory} (missing)</option>
          )}
          {pickable.map((c) => (
            <option key={c.id} value={c.name}>
              {c.emoji ? `${c.emoji} ` : ""}
              {c.name}
            </option>
          ))}
        </select>
        <AxisSelect
          ariaLabel="Set importance"
          value={rule.set_importance}
          labels={IMPORTANCE_LABEL}
          onChange={(v) => onPatch({ set_importance: v })}
        />
        <AxisSelect
          ariaLabel="Set urgency"
          value={rule.set_urgency}
          labels={URGENCY_LABEL}
          onChange={(v) => onPatch({ set_urgency: v })}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.auto_archive}
            onChange={(e) => onPatch({ auto_archive: e.target.checked })}
          />
          Archive immediately (skips the triage list)
        </label>
        <span className="truncate text-[10px] text-muted-foreground/60">
          {describeRuleActions(rule)}
        </span>
      </div>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {warnings.map((w) => (
            <li key={w} className="text-[10px] text-amber-600 dark:text-amber-400">
              {w}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function MailRulesDialog({
  open,
  onOpenChange,
  rules,
  categories,
  api,
  onChanged,
}: MailRulesDialogProps) {
  // Local working copy so typing is not a round-trip per keystroke. Seeded from
  // props whenever the dialog opens — not on every prop change, which would
  // stomp an in-progress edit the moment a background refetch landed.
  const [draft, setDraft] = useState<MailRule[]>(() => orderRules(rules));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(orderRules(rules));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ordered = orderRules(draft);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Edits are saved on blur rather than per keystroke: a rule name is edited a
   * character at a time and one write per character would both hammer Supabase
   * and make every intermediate string a persisted state.
   */
  function patchLocal(id: string, patch: Partial<Omit<MailRule, "id">>) {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function commit(id: string, patch: Partial<Omit<MailRule, "id">>) {
    patchLocal(id, patch);
    void run(async () => {
      await api.update(id, patch);
    });
  }

  function move(from: number, to: number) {
    const order = reorderRules(ordered, from, to);
    if (order.length === 0) return;
    const bySort = new Map(order.map((o) => [o.id, o.sort]));
    setDraft((d) => d.map((r) => ({ ...r, sort: bySort.get(r.id) ?? r.sort })));
    void run(async () => {
      await api.reorder(order);
    });
  }

  function add() {
    void run(async () => {
      const created = await api.create(blankRule(nextRuleSort(draft)) as Omit<MailRule, "id">);
      setDraft((d) => [...d, created]);
    });
  }

  function remove(id: string) {
    void run(async () => {
      await api.remove(id);
      setDraft((d) => d.filter((r) => r.id !== id));
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-card p-6 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="mb-3">
            <Dialog.Title className="text-base font-semibold text-foreground">
              Triage rules
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {PRECEDENCE_COPY[RULE_PRECEDENCE]}
            </Dialog.Description>
            {/*
              Without this, editing a rule and seeing the list below it not
              change reads as a broken save.
            */}
            <p className="mt-1 text-xs text-muted-foreground/70">{RETROACTIVITY_COPY}</p>
          </div>

          {error && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1">
            {ordered.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs italic text-muted-foreground">
                No rules yet. Everything is classified by the model.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {ordered.map((rule, i) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    all={ordered}
                    categories={categories}
                    index={i}
                    count={ordered.length}
                    busy={busy}
                    // Checkboxes and selects commit immediately — one
                    // deliberate gesture, one write. Free text only updates the
                    // local draft here and persists on blur, so a rule name is
                    // not saved once per character.
                    onPatch={(patch) => {
                      const isText = "name" in patch || "pattern" in patch;
                      if (isText) patchLocal(rule.id, patch);
                      else commit(rule.id, patch);
                    }}
                    onCommit={(patch) => commit(rule.id, patch)}
                    onMove={(to) => move(i, to)}
                    onDelete={() => remove(rule.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={add}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              New rule
            </button>
            <button
              type="button"
              onClick={() => {
                // Text edits commit on blur; closing while an input still has
                // focus would otherwise drop the last field the user typed.
                (document.activeElement as HTMLElement | null)?.blur();
                onOpenChange(false);
              }}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Done
            </button>
          </div>

          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
