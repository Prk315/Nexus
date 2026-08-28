import { describe, it, expect } from "vitest";
import { stripeColor, stripeLabel, assigneeColor, COLOR_BY, COLOR_BY_LABELS } from "./cardColor";

const task = (over: Record<string, unknown> = {}) => ({
  id: 1, title: "t", done: false, priority: null, due_date: null,
  time_estimate: null, aggregate_estimate: null, planning: null,
  team_id: null, assigned_to: null, ...over,
}) as never;

const ctx = (over: Partial<{ tags: string[]; colors: Record<string, string> }> = {}) => ({
  tagsOf: () => over.tags ?? [],
  tagColor: (t: string) => (over.colors ?? {})[t],
  members: [{ user_id: "u1", display_name: "Jo" }] as never,
});

const L = (c: string) => Number(/oklch\(([\d.]+)/.exec(c)![1]);

describe("no value means NO stripe", () => {
  // ⚠️ The rule the feature turns on. A grey "unset" stripe would read as a
  // real category — "the grey ones" — and the board would quietly grow a group
  // that does not exist.
  it("returns null rather than a default colour, for every dimension", () => {
    for (const by of COLOR_BY) {
      expect(stripeColor(task(), by, ctx()), by).toBeNull();
    }
  });

  it("returns null when the tags carry no colour", () => {
    expect(stripeColor(task(), "tag", ctx({ tags: ["untinted"] }))).toBeNull();
  });

  it("returns null for `none`, even when everything else is set", () => {
    const t = task({ priority: "high", team_id: 1, assigned_to: "u1" });
    expect(stripeColor(t, "none", ctx({ tags: ["a"], colors: { a: "#f00" } }))).toBeNull();
  });
});

describe("tag", () => {
  // One stripe per card. Blending three tags produces a fourth colour that is
  // in no legend.
  it("takes the first tag that has a colour, not a blend", () => {
    const c = ctx({ tags: ["plain", "red", "blue"], colors: { red: "#ff0000", blue: "#0000ff" } });
    expect(stripeColor(task(), "tag", c)).toBe("#ff0000");
    expect(stripeLabel(task(), "tag", c)).toBe("#red");
  });

  // The SHARED resolver is passed in rather than reimplemented, so one word is
  // one colour in a note, in the tag panel and here.
  it("uses whatever the shared resolver says", () => {
    const c = ctx({ tags: ["x"], colors: { x: "rebeccapurple" } });
    expect(stripeColor(task(), "tag", c)).toBe("rebeccapurple");
  });
});

describe("priority and urgency", () => {
  it("colours all three steps of each", () => {
    for (const v of ["low", "medium", "high"]) {
      expect(stripeColor(task({ priority: v }), "priority", ctx()), v).toBeTruthy();
      expect(stripeColor(task({ planning: { urgency: v } }), "urgency", ctx()), v).toBeTruthy();
    }
  });

  // ⚠️ A three-step scale distinguished by HUE alone is the classic
  // deuteranopia failure — red and green at one lightness are the same stripe.
  // Moving in lightness too means the order survives with no colour vision.
  it("separates the steps by lightness, not only by hue", () => {
    const l = ["low", "medium", "high"].map((v) => L(stripeColor(task({ priority: v }), "priority", ctx())!));
    expect(l[0]).toBeGreaterThan(l[1]);
    expect(l[1]).toBeGreaterThan(l[2]);
    // And far enough apart to be told apart in a 3px stripe.
    expect(l[0] - l[2]).toBeGreaterThan(0.12);
  });

  it("says what the colour means", () => {
    expect(stripeLabel(task({ priority: "high" }), "priority", ctx())).toBe("Priority: high");
    expect(stripeLabel(task(), "priority", ctx())).toBeNull();
  });
});

describe("assignee", () => {
  // ⚠️ `assigned_to` is documented as meaningless when `team_id` is null, so a
  // personal task must not get a colour for a person who was never assigned.
  it("gives a personal task no stripe, however assigned_to reads", () => {
    expect(stripeColor(task({ assigned_to: "u1" }), "assignee", ctx())).toBeNull();
  });

  // "Everyone" is the ABSENCE of an assignee, not a person.
  it("gives `all` no stripe", () => {
    expect(stripeColor(task({ team_id: 1, assigned_to: "all" }), "assignee", ctx())).toBeNull();
  });

  it("colours a real assignee, and names them", () => {
    const t = task({ team_id: 1, assigned_to: "u1" });
    expect(stripeColor(t, "assignee", ctx())).toBeTruthy();
    expect(stripeLabel(t, "assignee", ctx())).toBe("Jo");
  });

  it("is stable for one id and different across ids", () => {
    expect(assigneeColor("abc")).toBe(assigneeColor("abc"));
    const seen = new Set(["a", "b", "c", "d", "e", "f"].map(assigneeColor));
    expect(seen.size).toBe(6);
  });

  it("keeps every derived colour in the readable lightness band", () => {
    // Same reasoning as the text palette: one value has to work on a light and
    // a dark surface, and it is derived rather than chosen, so it is asserted.
    for (const id of ["a", "bb", "ccc", "u1", "870ca14b", "a33625c2"]) {
      const l = L(assigneeColor(id));
      expect(l, id).toBeGreaterThanOrEqual(0.55);
      expect(l, id).toBeLessThanOrEqual(0.7);
    }
  });
});

describe("the option list", () => {
  it("labels every option, so the picker cannot show a bare key", () => {
    for (const c of COLOR_BY) expect(COLOR_BY_LABELS[c], c).toBeTruthy();
  });

  it("starts at none, so a block gains no colour it was not asked for", () => {
    expect(COLOR_BY[0]).toBe("none");
  });
});
