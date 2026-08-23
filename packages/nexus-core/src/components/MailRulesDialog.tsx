import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { cn } from "../utils";
import type {
  MailAxis,
  MailCategory,
  MailRule,
  MailRuleMatchField,
  MailRuleStatus,
} from "../mail/types";
import { MAIL_RULE_MATCH_FIELDS, MAIL_RULE_STATUSES } from "../mail/types";
import type { MailRulesApi } from "../mail/rulesApi";
import { pickableCategories } from "../mail/categories";
import {
  MATCH_FIELD_LABEL,
  MATCH_FIELD_PLACEHOLDER,
  MATCH_MODE_COPY,
  PRECEDENCE_COPY,
  RETROACTIVITY_COPY,
  RULE_PRECEDENCE,
  RULE_STATUS_LABEL,
  blankRule,
  describeRuleActions,
  nextRuleSort,
  orderRules,
  reorderRules,

  ruleValidity,
  ruleWarnings,
} from "../mail/rules";
import { AXIS_LEVELS, IMPORTANCE_LABEL, URGENCY_LABEL } from "../mail/axes";

/**
 * The triage rules editor.
 *
 * **This edits rules as data. It never evaluates them.** `n8n-ingest` applies
 * them server-side, after the model, so a rule beats the model
 * deterministically and two clients cannot classify one message two ways.
 *
 * Two semantics the layout has to carry honestly:
 *
 * - **Matching is AND.** Four optional fields; every one filled in must match.
 *   They are shown as a labelled stack with an explicit "and" note rather than
 *   a field/value picker, because a picker would imply you pick *one*.
 * - **Precedence is all-match-apply, last write wins.** So the list reads
 *   top-to-bottom as application order, and the *bottom* is the strong end —
 *   the opposite of most priority lists, which is exactly why it is labelled
 *   at both ends and why an overwritten field names the rule that beats it.
 *
 * Chrome is copied from `apps/PathFinder/src/components/ui/dialog.tsx` so the
 * two apps' modals match, but imports `Dialog` from the unified `radix-ui`
 * package to follow nexus-core's existing `DropdownMenu` convention.
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

/** A local draft that has never been stored. `id` is assigned by the database. */
type DraftRule = MailRule & { unsaved?: true };

const DRAFT_ID = "__draft__";

/**
 * A tri-state action select.
 *
 * The empty option is **not** "medium" and not "leave to the model": under
 * all-match-apply an *earlier rule* may have set this field, and a null action
 * declines to participate rather than clearing it. The wording has to say that,
 * or a user will add a "leave alone" rule expecting it to reset something.
 */
function ActionSelect<T extends string>({
  value,
  options,
  labels,
  onChange,
  ariaLabel,
}: {
  value: T | null;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T | null) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className={inputCls}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as T | null)}
    >
      <option value="">— leave as set —</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o]}
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
  onSaveDraft,
}: {
  rule: DraftRule;
  all: readonly MailRule[];
  categories: readonly MailCategory[];
  index: number;
  count: number;
  busy: boolean;
  onPatch: (patch: Partial<MailRule>) => void;
  onCommit: (patch: Partial<MailRule>) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
  onSaveDraft: () => void;
}) {
  const validity = ruleValidity(rule);
  const warnings = rule.unsaved ? validity.reasons : ruleWarnings(rule, all);
  const pickable = pickableCategories(categories);
  // A rule may reference a category renamed, deleted or disabled since. Keep it
  // selectable rather than snapping to the first option, which would silently
  // rewrite the rule just by opening the editor.
  const orphanCategory =
    rule.set_category && !pickable.some((c) => c.name === rule.set_category)
      ? rule.set_category
      : null;
  const isLast = index === count - 1;

  return (
    <li
      className={cn(
        "rounded-lg border p-2.5 flex flex-col gap-2",
        rule.unsaved
          ? "border-primary/50 bg-primary/[0.03]"
          : rule.enabled
            ? "border-border"
            : "border-dashed border-border/60 opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground/60">
          {rule.unsaved ? "•" : index + 1}
        </span>
        <input
          aria-label="Rule name"
          className={cn(inputCls, "flex-1 font-medium")}
          placeholder="Name (optional)"
          value={rule.name ?? ""}
          onChange={(e) => onPatch({ name: e.target.value })}
          onBlur={(e) => !rule.unsaved && onCommit({ name: e.target.value })}
        />
        {!rule.unsaved && (
          <>
            <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => onCommit({ enabled: e.target.checked })}
              />
              On
            </label>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                title="Apply earlier (weaker)"
                disabled={index === 0 || busy}
                onClick={() => onMove(index - 1)}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Apply later (stronger)"
                disabled={isLast || busy}
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
          </>
        )}
      </div>

      {/* Match — four ANDed fields, shown as a stack so none reads as a choice. */}
      <div className="rounded-md border border-border/60 p-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Matches when
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {MAIL_RULE_MATCH_FIELDS.map((f: MailRuleMatchField) => (
            <label key={f} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">
                {MATCH_FIELD_LABEL[f]}
              </span>
              <input
                className={inputCls}
                placeholder={MATCH_FIELD_PLACEHOLDER[f]}
                value={rule[f] ?? ""}
                onChange={(e) => onPatch({ [f]: e.target.value || null } as Partial<MailRule>)}
                onBlur={(e) =>
                  !rule.unsaved &&
                  onCommit({ [f]: e.target.value.trim() || null } as Partial<MailRule>)
                }
              />
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/60">{MATCH_MODE_COPY}</p>
      </div>

      {/* Actions */}
      <div className="rounded-md border border-border/60 p-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Then set
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <select
            aria-label="Set category"
            className={inputCls}
            value={rule.set_category ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              rule.unsaved ? onPatch({ set_category: v }) : onCommit({ set_category: v });
            }}
          >
            <option value="">— leave as set —</option>
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
          {/*
            Only `read` and `archived`. The database CHECKs `set_status` to that
            subset: a rule may pre-read or archive, but may never claim you
            replied to something.
          */}
          <ActionSelect<MailRuleStatus>
            ariaLabel="Set status"
            value={rule.set_status}
            options={MAIL_RULE_STATUSES}
            labels={RULE_STATUS_LABEL}
            onChange={(v) =>
              rule.unsaved ? onPatch({ set_status: v }) : onCommit({ set_status: v })
            }
          />
          <ActionSelect<MailAxis>
            ariaLabel="Set importance"
            value={rule.set_importance}
            options={AXIS_LEVELS}
            labels={IMPORTANCE_LABEL}
            onChange={(v) =>
              rule.unsaved ? onPatch({ set_importance: v }) : onCommit({ set_importance: v })
            }
          />
          <ActionSelect<MailAxis>
            ariaLabel="Set urgency"
            value={rule.set_urgency}
            options={AXIS_LEVELS}
            labels={URGENCY_LABEL}
            onChange={(v) =>
              rule.unsaved ? onPatch({ set_urgency: v }) : onCommit({ set_urgency: v })
            }
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/60">
          “Leave as set” doesn't clear anything — it just lets whatever an
          earlier rule (or the model) decided stand.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] text-muted-foreground/60">
          {describeRuleActions(rule)}
        </span>
        {rule.unsaved ? (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={!validity.valid || busy}
            className="shrink-0 rounded-md border border-border bg-primary/10 px-2 py-1 text-xs text-foreground hover:bg-primary/20 disabled:opacity-40"
          >
            Save rule
          </button>
        ) : (
          isLast && (
            <span className="shrink-0 text-[10px] text-muted-foreground/50">
              applied last — wins conflicts
            </span>
          )
        )}
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
  // Local working copy so typing is not a round-trip per keystroke. Seeded when
  // the dialog opens — not on every prop change, which would stomp an
  // in-progress edit the moment a background refetch landed.
  const [saved, setSaved] = useState<MailRule[]>(() => orderRules(rules));
  const [draft, setDraft] = useState<DraftRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSaved(orderRules(rules));
      setDraft(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ordered = orderRules(saved);

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

  function patchLocal(id: string, patch: Partial<MailRule>) {
    if (id === DRAFT_ID) {
      setDraft((d) => (d ? { ...d, ...patch } : d));
      return;
    }
    setSaved((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function commit(id: string, patch: Partial<MailRule>) {
    patchLocal(id, patch);
    void run(async () => {
      await api.update(id, patch);
    });
  }

  function move(from: number, to: number) {
    const order = reorderRules(ordered, from, to);
    if (order.length === 0) return;
    const bySort = new Map(order.map((o) => [o.id, o.sort]));
    setSaved((rs) => rs.map((r) => ({ ...r, sort: bySort.get(r.id) ?? r.sort })));
    void run(async () => {
      await api.reorder(order);
    });
  }

  function startDraft() {
    setDraft({
      ...blankRule(nextRuleSort(saved)),
      id: DRAFT_ID,
      created_at: new Date().toISOString(),
      unsaved: true,
    });
  }

  function saveDraft() {
    if (!draft) return;
    void run(async () => {
      const { id: _id, created_at: _c, unsaved: _u, ...payload } = draft;
      const created = await api.create(payload);
      setSaved((rs) => [...rs, created]);
      setDraft(null);
    });
  }

  function remove(id: string) {
    void run(async () => {
      await api.remove(id);
      setSaved((rs) => rs.filter((r) => r.id !== id));
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
            <p className="mt-1 text-xs text-muted-foreground/70">{RETROACTIVITY_COPY}</p>
          </div>

          {error && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {error}
            </p>
          )}

          {/*
            Both ends of the list are labelled. Most priority lists put the
            winner at the top; this one is the other way round, and an unlabelled
            list would be read backwards by everyone who has ever used one.
          */}
          {ordered.length > 1 && (
            <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">
              applied first ↓ applied last (wins)
            </p>
          )}

          <div className="max-h-[56vh] overflow-y-auto pr-1 -mr-1">
            {ordered.length === 0 && !draft ? (
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
                    // Counts the unsaved draft too: while one is open it sits
                    // below every saved rule, so the "applied last" marker has
                    // to move off them or two rules claim to win.
                    count={ordered.length + (draft ? 1 : 0)}
                    busy={busy}
                    // Selects and checkboxes commit immediately — one deliberate
                    // gesture, one write. Free text only updates the local copy
                    // here and persists on blur, so a rule name is not saved
                    // once per character.
                    onPatch={(patch) => patchLocal(rule.id, patch)}
                    onCommit={(patch) => commit(rule.id, patch)}
                    onMove={(to) => move(i, to)}
                    onDelete={() => remove(rule.id)}
                    onSaveDraft={() => {}}
                  />
                ))}
                {draft && (
                  <RuleCard
                    rule={draft}
                    all={ordered}
                    categories={categories}
                    index={ordered.length}
                    count={ordered.length + 1}
                    busy={busy}
                    onPatch={(patch) => patchLocal(DRAFT_ID, patch)}
                    onCommit={(patch) => patchLocal(DRAFT_ID, patch)}
                    onMove={() => {}}
                    onDelete={() => setDraft(null)}
                    onSaveDraft={saveDraft}
                  />
                )}
              </ul>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startDraft}
                disabled={busy || !!draft}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                New rule
              </button>
              {/*
                A new rule goes last, which under all-match-apply also makes it
                the strongest. Usually what you want, but never harmless.
              */}
              {draft && (
                <span className="text-[10px] text-muted-foreground/60">
                  goes last — will win conflicts with the rules above
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                // Text edits commit on blur; closing while an input still has
                // focus would otherwise drop the last field typed.
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
