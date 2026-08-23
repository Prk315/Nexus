import { describe, expect, it } from "vitest";
import {
  PRECEDENCE_COPY,
  RULE_PRECEDENCE,
  activeActionFields,
  activeMatchFields,
  blankRule,
  describeRuleActions,
  describeRuleMatch,
  nextRuleSort,
  orderRules,
  reorderRules,
  ruleTitle,
  ruleValidity,
  ruleWarnings,
} from "./rules";
import type { MailRule } from "./types";

function rule(over: Partial<MailRule> & { id: string }): MailRule {
  return {
    name: `rule ${over.id}`,
    enabled: true,
    sort: 0,
    created_at: "2026-08-23T10:00:00Z",
    match_sender: null,
    match_domain: null,
    match_subject: null,
    match_list_id: null,
    set_category: null,
    set_importance: null,
    set_urgency: null,
    set_status: null,
    ...over,
  };
}

describe("precedence", () => {
  it("is all-match-apply, per the migration", () => {
    // Not first-match-wins: a category-only rule must not block a later
    // urgency-only rule, or the user writes the cross product.
    expect(RULE_PRECEDENCE).toBe("all-match-apply");
  });

  it("tells the user the lowest matching rule wins", () => {
    const copy = PRECEDENCE_COPY[RULE_PRECEDENCE];
    expect(copy).toContain("Every matching rule applies");
    expect(copy).toContain("wins any conflict");
    expect(copy).not.toContain("skipped");
  });
});

describe("orderRules", () => {
  it("orders by sort ascending — first applied first", () => {
    const ordered = orderRules([
      rule({ id: "c", sort: 2 }),
      rule({ id: "a", sort: 0 }),
      rule({ id: "b", sort: 1 }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a sort tie on created_at then id, exactly as the evaluator does", () => {
    // Two rules sharing a sort would otherwise apply in planner order, and a
    // conflicting pair would flip between runs.
    const ordered = orderRules([
      rule({ id: "z", sort: 0, created_at: "2026-08-23T12:00:00Z" }),
      rule({ id: "a", sort: 0, created_at: "2026-08-23T09:00:00Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "z"]);

    const sameInstant = orderRules([
      rule({ id: "b", sort: 0 }),
      rule({ id: "a", sort: 0 }),
    ]);
    expect(sameInstant.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps disabled rules in place rather than filtering them out", () => {
    const ordered = orderRules([
      rule({ id: "a", sort: 0 }),
      rule({ id: "b", sort: 1, enabled: false }),
      rule({ id: "c", sort: 2 }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const input = [rule({ id: "b", sort: 1 }), rule({ id: "a", sort: 0 })];
    orderRules(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("reorderRules", () => {
  const rules = [
    rule({ id: "a", sort: 0 }),
    rule({ id: "b", sort: 1 }),
    rule({ id: "c", sort: 2 }),
  ];

  it("moves a rule down and renumbers densely from 0", () => {
    expect(reorderRules(rules, 0, 2)).toEqual([
      { id: "b", sort: 0 },
      { id: "c", sort: 1 },
      { id: "a", sort: 2 },
    ]);
  });

  it("moves a rule up", () => {
    expect(reorderRules(rules, 2, 0)).toEqual([
      { id: "c", sort: 0 },
      { id: "a", sort: 1 },
      { id: "b", sort: 2 },
    ]);
  });

  it("renumbers away sparse or duplicated sort values", () => {
    // Duplicated sorts are exactly the case where the evaluator's tie-break
    // decides a conflict, so collapsing them to a dense order is the fix.
    const messy = [
      rule({ id: "a", sort: 5 }),
      rule({ id: "b", sort: 5, created_at: "2026-08-23T11:00:00Z" }),
      rule({ id: "c", sort: 90 }),
    ];
    expect(reorderRules(messy, 2, 0).map((o) => o.sort)).toEqual([0, 1, 2]);
  });

  it("is idempotent, so a retried save cannot interleave precedence", () => {
    const once = reorderRules(rules, 0, 1);
    const applied = once.map((o) => rule({ id: o.id, sort: o.sort }));
    expect(orderRules(applied).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(reorderRules(applied, 0, 1)).toEqual(reorderRules(applied, 0, 1));
  });

  it("returns nothing for a no-op or an out-of-range move", () => {
    expect(reorderRules(rules, 1, 1)).toEqual([]);
    expect(reorderRules(rules, -1, 0)).toEqual([]);
    expect(reorderRules(rules, 0, 9)).toEqual([]);
    expect(reorderRules([], 0, 0)).toEqual([]);
  });
});

describe("nextRuleSort", () => {
  it("puts a new rule last, which under all-match-apply makes it strongest", () => {
    expect(nextRuleSort([rule({ id: "a", sort: 0 }), rule({ id: "b", sort: 4 })])).toBe(5);
  });

  it("starts at 0 for the first rule", () => {
    expect(nextRuleSort([])).toBe(0);
  });
});

describe("matching is AND", () => {
  it("joins every filled field with 'and'", () => {
    const r = rule({ id: "a", match_domain: "bank.dk", match_subject: "invoice" });
    expect(describeRuleMatch(r)).toBe("from domain bank.dk and subject contains invoice");
  });

  it("ignores blank fields, which do not narrow anything", () => {
    const r = rule({ id: "a", match_domain: "bank.dk", match_subject: "   " });
    expect(activeMatchFields(r)).toEqual(["match_domain"]);
    expect(describeRuleMatch(r)).toBe("from domain bank.dk");
  });

  it("says so plainly when nothing constrains it", () => {
    expect(describeRuleMatch(rule({ id: "a" }))).toBe("matches everything");
  });
});

describe("describeRuleActions", () => {
  it("lists the actions that are set, including status", () => {
    expect(
      describeRuleActions(
        rule({
          id: "a",
          set_category: "Bill",
          set_importance: "high",
          set_urgency: "low",
          set_status: "archived",
        }),
      ),
    ).toBe("file as Bill, high importance, whenever, archive (skips the list)");
  });

  it("calls an action-less rule out rather than rendering blank", () => {
    expect(describeRuleActions(rule({ id: "a" }))).toBe("does nothing");
  });

  it("counts only the fields actually set", () => {
    expect(activeActionFields(rule({ id: "a", set_urgency: "high" }))).toEqual([
      "set_urgency",
    ]);
  });
});

describe("ruleValidity mirrors the database CHECKs", () => {
  it("refuses a rule with no match fields", () => {
    // mail_rules_has_match. A rule with none matches EVERY message, and with
    // set_status='archived' silently empties the inbox.
    const v = ruleValidity(rule({ id: "a", set_status: "archived" }));
    expect(v.valid).toBe(false);
    expect(v.reasons.join(" ")).toContain("every message");
  });

  it("refuses a rule with no actions", () => {
    const v = ruleValidity(rule({ id: "a", match_domain: "x.dk" }));
    expect(v.valid).toBe(false);
    expect(v.reasons.join(" ")).toContain("at least one action");
  });

  it("accepts one match plus one action", () => {
    expect(
      ruleValidity(rule({ id: "a", match_domain: "x.dk", set_urgency: "high" })).valid,
    ).toBe(true);
  });

  it("treats whitespace as blank, matching the trim the evaluator would see", () => {
    expect(
      ruleValidity(rule({ id: "a", match_domain: "   ", set_urgency: "high" })).valid,
    ).toBe(false);
  });
});

describe("ruleWarnings", () => {
  it("names the later rule that overwrites a field — the all-match-apply trap", () => {
    // The rule looks correct, sits right there in the list, and does nothing.
    const early = rule({ id: "a", sort: 0, name: "Broad", match_domain: "x.dk", set_urgency: "low" });
    const late = rule({ id: "b", sort: 1, name: "Narrow", match_domain: "x.dk", set_urgency: "high" });
    const w = ruleWarnings(early, [early, late]).join(" ");
    expect(w).toContain("Urgency is overwritten by “Narrow” below");
  });

  it("does not warn the winning rule", () => {
    const early = rule({ id: "a", sort: 0, match_domain: "x.dk", set_urgency: "low" });
    const late = rule({ id: "b", sort: 1, match_domain: "y.dk", set_urgency: "high" });
    expect(ruleWarnings(late, [early, late]).join(" ")).not.toContain("overwritten");
  });

  it("ignores a disabled rule as an overrider", () => {
    const early = rule({ id: "a", sort: 0, match_domain: "x.dk", set_urgency: "low" });
    const late = rule({ id: "b", sort: 1, enabled: false, match_domain: "x.dk", set_urgency: "high" });
    expect(ruleWarnings(early, [early, late]).join(" ")).not.toContain("overwritten");
  });

  it("does not treat a different action field as a conflict", () => {
    // The whole reason this is not first-match-wins: these two compose.
    const a = rule({ id: "a", sort: 0, match_domain: "x.dk", set_category: "Bill" });
    const b = rule({ id: "b", sort: 1, match_domain: "x.dk", set_urgency: "high" });
    expect(ruleWarnings(a, [a, b]).join(" ")).not.toContain("overwritten");
  });

  it("flags two rules matching exactly the same mail", () => {
    const a = rule({ id: "a", name: "First", match_domain: "x.dk", set_urgency: "low" });
    const b = rule({ id: "b", name: "Second", sort: 1, match_domain: "X.DK", set_category: "Bill" });
    expect(ruleWarnings(b, [a, b]).join(" ")).toContain("First");
  });

  it("does not flag a rule against itself", () => {
    const a = rule({ id: "a", match_domain: "x.dk", set_importance: "high" });
    expect(ruleWarnings(a, [a])).toEqual([]);
  });
});

describe("ruleTitle", () => {
  it("prefers the name", () => {
    expect(ruleTitle(rule({ id: "a", name: "Bank statements" }))).toBe("Bank statements");
  });

  it("falls back to the first match field, since name is nullable", () => {
    expect(ruleTitle(rule({ id: "a", name: null, match_domain: "bank.dk" }))).toBe(
      "From domain bank.dk",
    );
  });

  it("has something to show for a rule with neither", () => {
    expect(ruleTitle(rule({ id: "a", name: "  " }))).toBe("Untitled rule");
  });
});

describe("blankRule", () => {
  it("is deliberately not storable, so a placeholder never becomes a live rule", () => {
    const r = { ...blankRule(3), id: "draft", created_at: "2026-08-23T10:00:00Z" };
    expect(ruleValidity(r).valid).toBe(false);
    expect(ruleValidity(r).reasons).toHaveLength(2);
  });

  it("sets no action by accident", () => {
    const r = blankRule(3);
    expect(r.set_importance).toBeNull();
    expect(r.set_urgency).toBeNull();
    expect(r.set_category).toBeNull();
    expect(r.set_status).toBeNull();
    expect(r.enabled).toBe(true);
    expect(r.sort).toBe(3);
  });
});
