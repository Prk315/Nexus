/**
 * Pure helpers for the rules editor: ordering, reordering, validity, and
 * turning a rule into the sentences the list shows. No React, no Supabase.
 *
 * # The panel does not evaluate rules
 *
 * `n8n-ingest` applies them server-side, after the model, and a rule always
 * wins over the model's verdict. That is the house "no client derives policy"
 * rule — the same shape as `focus-evaluate` collapsing six tables into one
 * `blocking_state` row. Nothing in this file matches a message against a rule,
 * and nothing should: a second matcher would drift from the one that actually
 * runs, and the UI would start explaining outcomes that never happen.
 */

import type {
  MailRule,
  MailRuleActionField,
  MailRuleMatchField,
  MailRuleStatus,
} from "./types";
import { MAIL_RULE_ACTION_FIELDS, MAIL_RULE_MATCH_FIELDS } from "./types";
import { IMPORTANCE_LABEL, URGENCY_LABEL } from "./axes";

export type RulePrecedence = "first-match-wins" | "all-match-apply";

/**
 * Confirmed against `20260823120000_n8n_mail_bus.sql`.
 *
 * **All** enabled matching rules apply, in ascending `sort`, each non-null
 * action overwriting the previous — so the **highest `sort`** among matching
 * rules wins a direct conflict. Deliberately not first-match-wins: a rule that
 * only sets a category must not block a later rule that only sets urgency, or
 * the user would have to write the cross product of every combination.
 *
 * (An earlier draft of this file inferred first-match-wins from
 * `mail_messages.rule_id` being singular. The inference was wrong but the
 * observation was not: `rule_id` records the rule that last set **the axes**,
 * not the whole verdict, so a category-only rule is deliberately not blamed
 * for an importance it never touched. One id, many contributing rules.)
 */
export const RULE_PRECEDENCE: RulePrecedence = "all-match-apply";

/** A sentence for each semantics, so the constant above is the only switch. */
export const PRECEDENCE_COPY: Record<RulePrecedence, string> = {
  "first-match-wins":
    "Checked top to bottom. The first rule that matches wins; the rest are skipped.",
  "all-match-apply":
    "Every matching rule applies, top to bottom. Later rules overwrite earlier ones, so the lowest matching rule in this list wins any conflict.",
};

/**
 * Rules never apply retroactively — `n8n-ingest` runs them as mail arrives.
 * Without saying so, an edit that visibly changes nothing reads as a broken
 * save.
 */
export const RETROACTIVITY_COPY =
  "Rules apply as mail arrives. Editing them does not re-triage messages already in the list.";

/** All non-null match fields must hold. One rule cannot express "or". */
export const MATCH_MODE_COPY =
  "All the fields you fill in must match (and). Leave a field blank and it won't narrow anything. For “either/or”, write two rules.";

export const MATCH_FIELD_LABEL: Record<MailRuleMatchField, string> = {
  match_sender: "From address",
  match_domain: "From domain",
  match_subject: "Subject contains",
  match_list_id: "List-Id",
};

export const MATCH_FIELD_PLACEHOLDER: Record<MailRuleMatchField, string> = {
  match_sender: "anna@studie.dk",
  match_domain: "bank.dk",
  match_subject: "invoice",
  match_list_id: "list.example.com",
};

export const ACTION_FIELD_LABEL: Record<MailRuleActionField, string> = {
  set_category: "Category",
  set_importance: "Importance",
  set_urgency: "Urgency",
  set_status: "File as",
};

export const RULE_STATUS_LABEL: Record<MailRuleStatus, string> = {
  read: "Mark read",
  archived: "Archive (skips the list)",
};

/** The match fields a rule actually constrains on. */
export function activeMatchFields(rule: MailRule): MailRuleMatchField[] {
  return MAIL_RULE_MATCH_FIELDS.filter((f) => !!rule[f]?.trim());
}

/** The action fields a rule actually sets. */
export function activeActionFields(rule: MailRule): MailRuleActionField[] {
  return MAIL_RULE_ACTION_FIELDS.filter((f) => rule[f] !== null && rule[f] !== undefined);
}

/**
 * Evaluation order: `sort` ascending, then `created_at`, then `id` — the
 * evaluator's exact tie-break.
 *
 * The tie-break is not decoration. Two rules sharing a `sort` would otherwise
 * be applied in whatever order the query planner returned, and a conflicting
 * pair would flip between runs. The editor has to show the same order the
 * evaluator uses or the list is a lie.
 */
export function compareRules(a: MailRule, b: MailRule): number {
  if (a.sort !== b.sort) return a.sort - b.sort;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/**
 * Rules in the order the ingest function applies them — first applied at the
 * top, last (and therefore winning) at the bottom.
 *
 * Disabled rules are **kept in place**, not filtered out. Their position is
 * what the user reasons about when re-enabling one, and a list that reflows on
 * toggle makes precedence impossible to plan.
 */
export function orderRules(rules: readonly MailRule[]): MailRule[] {
  return [...rules].sort(compareRules);
}

/**
 * The move produced by dragging (or nudging) the rule at `from` to `to`.
 *
 * Returns the full `[{id, sort}]` set to persist, renumbered densely from 0.
 * Renumbering everything rather than computing a fractional sort keeps the
 * stored order readable and makes the write idempotent — applying the same
 * move twice lands on the same numbers.
 *
 * That matters more under all-match-apply than it would under first-match-wins:
 * a partially-applied reorder can silently swap which of a *conflicting pair*
 * wins for all future mail, and because both rules still appear in the list —
 * just in an order the database disagrees with — there is nothing to see. Hence
 * one atomic write; see `createMailRulesApi.reorder`.
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

/**
 * The `sort` a newly created rule should get: last.
 *
 * Under all-match-apply that also makes it the **strongest** — a new rule wins
 * conflicts with every existing one. That is the right default (you wrote it
 * because the current behaviour was wrong) but it is the opposite of harmless,
 * so the editor says so rather than letting it be a surprise.
 */
export function nextRuleSort(rules: readonly MailRule[]): number {
  return rules.reduce((max, r) => Math.max(max, r.sort), -1) + 1;
}

/** The display name for a rule that never got one. */
export function ruleTitle(rule: MailRule): string {
  const named = rule.name?.trim();
  if (named) return named;
  const match = activeMatchFields(rule);
  if (match.length === 0) return "Untitled rule";
  return `${MATCH_FIELD_LABEL[match[0]]} ${rule[match[0]]?.trim()}`;
}

/** "From domain bank.dk and Subject contains invoice" — always AND. */
export function describeRuleMatch(rule: MailRule): string {
  const fields = activeMatchFields(rule);
  if (fields.length === 0) return "matches everything";
  return fields
    .map((f) => `${MATCH_FIELD_LABEL[f].toLowerCase()} ${rule[f]?.trim()}`)
    .join(" and ");
}

/**
 * The "what this rule does" line, built from the actions actually set.
 *
 * A rule with no actions is called out explicitly rather than rendering blank —
 * the database refuses to store one, so this is what the user sees before the
 * write is attempted.
 */
export function describeRuleActions(rule: MailRule): string {
  const parts: string[] = [];
  if (rule.set_category) parts.push(`file as ${rule.set_category}`);
  if (rule.set_importance) {
    parts.push(`${IMPORTANCE_LABEL[rule.set_importance].toLowerCase()} importance`);
  }
  if (rule.set_urgency) parts.push(URGENCY_LABEL[rule.set_urgency].toLowerCase());
  if (rule.set_status) parts.push(RULE_STATUS_LABEL[rule.set_status].toLowerCase());
  if (parts.length === 0) return "does nothing";
  return parts.join(", ");
}

/**
 * Whether the database will accept this rule.
 *
 * Mirrors `mail_rules_has_match` and `mail_rules_has_action`. Checked in the UI
 * so a new rule is never *attempted* in an unstorable state — but the database
 * remains the authority, and nothing here refuses a row the server would take.
 */
export function ruleValidity(rule: MailRule): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (activeMatchFields(rule).length === 0) {
    reasons.push(
      "Needs at least one match field — a rule with none matches every message.",
    );
  }
  if (activeActionFields(rule).length === 0) {
    reasons.push("Needs at least one action, or it does nothing.");
  }
  return { valid: reasons.length === 0, reasons };
}

/**
 * Advisory problems shown next to a saved rule.
 *
 * Never blocking: the database is the authority on what is storable, and a
 * client-side validator that refuses a row the server would accept is its own
 * kind of bug.
 */
export function ruleWarnings(rule: MailRule, all: readonly MailRule[]): string[] {
  const warnings: string[] = [...ruleValidity(rule).reasons];

  const ordered = orderRules(all);
  const index = ordered.findIndex((r) => r.id === rule.id);
  const later = index >= 0 ? ordered.slice(index + 1) : [];
  const mine = activeMatchFields(rule);

  // Under all-match-apply, a *later* rule silently wins any field they share.
  // That is the single most confusing thing about this model — the rule looks
  // correct, sits right there in the list, and does nothing — so name the rule
  // that beats it rather than leaving it to be discovered.
  for (const f of activeActionFields(rule)) {
    const overrider = later.find((r) => r.enabled && r[f] !== null && r[f] !== undefined);
    if (overrider) {
      warnings.push(
        `${ACTION_FIELD_LABEL[f]} is overwritten by “${ruleTitle(overrider)}” below.`,
      );
    }
  }

  const duplicate = all.find(
    (r) =>
      r.id !== rule.id &&
      MAIL_RULE_MATCH_FIELDS.every(
        (f) => (r[f]?.trim().toLowerCase() ?? "") === (rule[f]?.trim().toLowerCase() ?? ""),
      ),
  );
  if (duplicate && mine.length > 0) {
    warnings.push(`Matches exactly the same mail as “${ruleTitle(duplicate)}”.`);
  }

  return warnings;
}

/**
 * A blank rule for the "new rule" form.
 *
 * Every field is empty, which means it is **deliberately not storable** — both
 * database CHECKs fail. The editor holds it as an unsaved draft and only writes
 * once `ruleValidity` passes, rather than inserting a placeholder that would be
 * a real rule matching real mail in the meantime.
 */
export function blankRule(sort: number): Omit<MailRule, "id" | "created_at"> {
  return {
    name: "",
    enabled: true,
    sort,
    match_sender: null,
    match_domain: null,
    match_subject: null,
    match_list_id: null,
    set_category: null,
    set_importance: null,
    set_urgency: null,
    set_status: null,
  };
}
