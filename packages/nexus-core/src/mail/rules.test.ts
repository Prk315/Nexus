import { describe, expect, it } from "vitest";
import {
  PRECEDENCE_COPY,
  RULE_PRECEDENCE,
  blankRule,
  describeRuleActions,
  describeRuleMatch,
  nextRuleSort,
  orderRules,
  reorderRules,
  ruleWarnings,
} from "./rules";
import type { MailRule } from "./types";

function rule(over: Partial<MailRule> & { id: string }): MailRule {
  return {
    name: `rule ${over.id}`,
    enabled: true,
    sort: 0,
    field: "sender",
    pattern: "a@b.com",
    set_category: null,
    set_importance: null,
    set_urgency: null,
    auto_archive: false,
    ...over,
  };
}

describe("orderRules", () => {
  it("orders by sort, which is evaluation order", () => {
    const ordered = orderRules([
      rule({ id: "c", sort: 2 }),
      rule({ id: "a", sort: 0 }),
      rule({ id: "b", sort: 1 }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps disabled rules in place rather than filtering them out", () => {
    // Their position is what the user reasons about when re-enabling one; a
    // list that reflows on toggle makes precedence impossible to plan.
    const ordered = orderRules([
      rule({ id: "a", sort: 0 }),
      rule({ id: "b", sort: 1, enabled: false }),
      rule({ id: "c", sort: 2 }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("is a total order when sort values collide", () => {
    const ordered = orderRules([
      rule({ id: "z", sort: 0, name: "zeta" }),
      rule({ id: "a", sort: 0, name: "alpha" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "z"]);
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

  it("is idempotent, so a retried save cannot interleave rules", () => {
    const once = reorderRules(rules, 0, 1);
    const applied = once.map((o) => rule({ id: o.id, sort: o.sort }));
    expect(reorderRules(applied, 0, 1).map((o) => o.id)).toEqual(
      reorderRules(applied, 0, 1).map((o) => o.id),
    );
    // Re-deriving the same target order from the applied state is stable.
    expect(orderRules(applied).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("returns nothing for a no-op or an out-of-range move", () => {
    expect(reorderRules(rules, 1, 1)).toEqual([]);
    expect(reorderRules(rules, -1, 0)).toEqual([]);
    expect(reorderRules(rules, 0, 9)).toEqual([]);
    expect(reorderRules([], 0, 0)).toEqual([]);
  });

  it("renumbers away sparse or duplicated sort values", () => {
    const messy = [
      rule({ id: "a", sort: 5 }),
      rule({ id: "b", sort: 5, name: "b" }),
      rule({ id: "c", sort: 90 }),
    ];
    expect(reorderRules(messy, 2, 0).map((o) => o.sort)).toEqual([0, 1, 2]);
  });
});

describe("nextRuleSort", () => {
  it("puts a new rule last, so creating one changes no existing outcome", () => {
    expect(nextRuleSort([rule({ id: "a", sort: 0 }), rule({ id: "b", sort: 4 })])).toBe(5);
  });

  it("starts at 0 for the first rule", () => {
    expect(nextRuleSort([])).toBe(0);
  });
});

describe("describeRule*", () => {
  it("describes the match with the field's own verb", () => {
    expect(describeRuleMatch(rule({ id: "a", field: "subject", pattern: "invoice" }))).toBe(
      "Subject contains invoice",
    );
    expect(describeRuleMatch(rule({ id: "a", field: "domain", pattern: "vercel.com" }))).toBe(
      "Domain is vercel.com",
    );
  });

  it("lists the actions that are actually set", () => {
    expect(
      describeRuleActions(
        rule({ id: "a", set_category: "Invoices", set_importance: "high", set_urgency: "low" }),
      ),
    ).toBe("file as Invoices, high importance, whenever");
  });

  it("calls an action-less rule out rather than rendering blank", () => {
    // Under first-match-wins an inert rule silently swallows mail, so it has
    // to look wrong.
    expect(describeRuleActions(rule({ id: "a" }))).toBe("does nothing");
  });
});

describe("ruleWarnings", () => {
  it("flags an empty pattern", () => {
    const r = rule({ id: "a", pattern: "  ", set_importance: "high" });
    expect(ruleWarnings(r, [r]).join(" ")).toContain("cannot match");
  });

  it("flags an inert rule, and explains the precedence consequence", () => {
    const r = rule({ id: "a" });
    const w = ruleWarnings(r, [r]).join(" ");
    expect(w).toContain("No actions");
    if (RULE_PRECEDENCE === "first-match-wins") {
      expect(w).toContain("stops later rules");
    }
  });

  it("flags two rules matching the same thing", () => {
    const a = rule({ id: "a", name: "First", set_importance: "high" });
    const b = rule({ id: "b", name: "Second", pattern: "A@B.com", set_importance: "low" });
    expect(ruleWarnings(b, [a, b]).join(" ")).toContain("First");
  });

  it("does not flag a rule against itself", () => {
    const a = rule({ id: "a", set_importance: "high" });
    expect(ruleWarnings(a, [a])).toEqual([]);
  });
});

describe("precedence copy", () => {
  it("has a sentence for whichever semantics the migration settles on", () => {
    expect(PRECEDENCE_COPY["first-match-wins"]).toContain("first rule that matches");
    expect(PRECEDENCE_COPY["all-match-apply"]).toContain("override");
    expect(PRECEDENCE_COPY[RULE_PRECEDENCE]).toBeTruthy();
  });
});

describe("blankRule", () => {
  it("leaves every action unset, so a new rule decides nothing by accident", () => {
    const r = blankRule(3);
    expect(r.set_importance).toBeNull();
    expect(r.set_urgency).toBeNull();
    expect(r.set_category).toBeNull();
    expect(r.auto_archive).toBe(false);
    expect(r.enabled).toBe(true);
    expect(r.sort).toBe(3);
  });
});
