/**
 * Pure helpers for the rules editor: ordering, reordering, and turning a rule
 * into the sentence the list shows. No React, no Supabase.
 *
 * # The panel does not evaluate rules
 *
 * `n8n-ingest` applies them server-side, before the model, so a rule always
 * beats the model deterministically and two clients can never classify the
 * same message two ways. Same split as `focus-evaluate` → `blocking_state`:
 * the thing that can compute the verdict computes it once, and every reader
 * just reads it. Nothing in this file matches a message against a rule, and
 * nothing should — a second implementation of the matcher would drift from the
 * one that actually runs, and the UI would start explaining outcomes that
 * never happen.
 */

import type { MailAxis, MailRule, MailRuleField } from "./types";
import { IMPORTANCE_LABEL, URGENCY_LABEL } from "./axes";

/**
 * How the ingest function resolves two rules that both match.
 *
 * ⚠️ **Inferred, not read.** Unit 1's amended migration was not yet pushed
 * when this was written, so this is derived from the column shape rather than
 * from the SQL: `mail_messages.rule_id` is **singular**. Under all-match-apply
 * two rules could set different axes on one message and a single id could not
 * say which one was responsible — the column would have to be `rule_ids`, or
 * one per field. A single nullable `rule_id` is only expressible if exactly
 * one rule decides a message.
 *
 * If the migration turns out to say otherwise, the copy below is the only
 * thing that has to change — the editor's CRUD and reordering are identical
 * under either semantics, because `sort` is precedence either way.
 */
export type RulePrecedence = "first-match-wins" | "all-match-apply";

export const RULE_PRECEDENCE: RulePrecedence = "first-match-wins";

/**
 * A sentence for each semantics, so switching `RULE_PRECEDENCE` when unit 1's
 * migration lands is a one-token change rather than a rewrite.
 */
export const PRECEDENCE_COPY: Record<RulePrecedence, string> = {
  "first-match-wins":
    "Checked top to bottom. The first rule that matches wins; the rest are skipped.",
  "all-match-apply":
    "Checked top to bottom. Every matching rule applies, and later rules override earlier ones.",
};

/**
 * Rules never apply retroactively — `n8n-ingest` runs them as mail arrives.
 * Editing one changes nothing about mail already in the tray, and without
 * saying so an edit that visibly does nothing reads as a broken save.
 */
export const RETROACTIVITY_COPY =
  "Rules apply as mail arrives. Editing them does not re-triage messages already in the list.";

export const RULE_FIELD_LABEL: Record<MailRuleField, string> = {
  sender: "Sender is",
  domain: "Domain is",
  subject: "Subject contains",
  list_id: "List-Id is",
};

/** Evaluation order: `sort` ascending, name as a tiebreak so it is total. */
export function compareRules(a: MailRule, b: MailRule): number {
  if (a.sort !== b.sort) return a.sort - b.sort;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Rules in the order the ingest function will check them.
 *
 * Disabled rules are **kept in place**, not filtered out. Their position is
 * the thing the user is reasoning about when they re-enable one, and a list
 * that silently reflows on toggle makes precedence impossible to plan.
 */
export function orderRules(rules: readonly MailRule[]): MailRule[] {
  return [...rules].sort(compareRules);
}

/**
 * The move produced by dragging (or nudging) the rule at `from` to `to`.
 *
 * Returns the full `[{id, sort}]` set to persist, renumbered densely from 0.
 * Renumbering everything rather than computing a fractional sort keeps the
 * stored order readable, and — more importantly — makes the write idempotent:
 * applying the same move twice lands on the same numbers, so a retried save
 * cannot interleave rules.
 *
 * Returns an empty array for a no-op move, so callers can skip the round-trip.
 */
export function reorderRules(
  rules: readonly MailRule[],
  from: number,
  to: number,
): { id: string; sort: number }[] {
  const ordered = orderRules(rules);
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= ordered.length ||
    to >= ordered.length
  ) {
    return [];
  }
  const moved = ordered.slice();
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);
  return moved.map((r, i) => ({ id: r.id, sort: i }));
}

/** The `sort` a newly created rule should get: last, so it changes nothing. */
export function nextRuleSort(rules: readonly MailRule[]): number {
  return rules.reduce((max, r) => Math.max(max, r.sort), -1) + 1;
}

/**
 * The human-readable "what this rule does" line.
 *
 * Built from the actions actually set. A rule with no actions is called out
 * explicitly rather than rendering as an empty string — an inert rule sitting
 * in a precedence list is exactly the kind of thing that silently swallows
 * mail under first-match-wins, and it should look wrong.
 */
export function describeRuleActions(rule: MailRule): string {
  const parts: string[] = [];
  if (rule.set_category) parts.push(`file as ${rule.set_category}`);
  if (rule.set_importance) {
    parts.push(`${IMPORTANCE_LABEL[rule.set_importance].toLowerCase()} importance`);
  }
  if (rule.set_urgency) parts.push(URGENCY_LABEL[rule.set_urgency].toLowerCase());
  if (rule.auto_archive) parts.push("archive immediately");
  if (parts.length === 0) return "does nothing";
  return parts.join(", ");
}

/** The "what this rule matches" line. */
export function describeRuleMatch(rule: MailRule): string {
  const pattern = rule.pattern.trim();
  return `${RULE_FIELD_LABEL[rule.field]} ${pattern || "…"}`;
}

/**
 * Problems worth showing next to a rule, in the editor.
 *
 * These are advisory, never blocking — the database is the authority on what
 * is storable, and a client-side validator that refuses a row the server would
 * accept is its own kind of bug.
 */
export function ruleWarnings(rule: MailRule, all: readonly MailRule[]): string[] {
  const warnings: string[] = [];
  if (!rule.pattern.trim()) {
    warnings.push("No pattern — this rule cannot match anything.");
  }
  if (describeRuleActions(rule) === "does nothing") {
    warnings.push(
      RULE_PRECEDENCE === "first-match-wins"
        ? "No actions — under first-match-wins this stops later rules without doing anything."
        : "No actions — this rule has no effect.",
    );
  }
  const duplicate = all.find(
    (r) =>
      r.id !== rule.id &&
      r.field === rule.field &&
      r.pattern.trim().toLowerCase() === rule.pattern.trim().toLowerCase(),
  );
  if (duplicate && rule.pattern.trim()) {
    warnings.push(`Same match as “${duplicate.name}”.`);
  }
  return warnings;
}

/** A blank rule for the "new rule" form. `id` is assigned by the database. */
export function blankRule(sort: number): Omit<MailRule, "id"> {
  return {
    name: "",
    enabled: true,
    sort,
    field: "sender",
    pattern: "",
    set_category: null,
    set_importance: null as MailAxis | null,
    set_urgency: null as MailAxis | null,
    auto_archive: false,
  };
}
