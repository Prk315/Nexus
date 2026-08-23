import { describe, expect, it } from "vitest";
import { indexCategories, pickableCategories, resolveCategory } from "./categories";
import type { MailCategory } from "./types";

function cat(over: Partial<MailCategory> & { name: string }): MailCategory {
  return {
    id: `id-${over.name}`,
    color: "teal",
    emoji: "📧",
    sort: 0,
    enabled: true,
    ...over,
  };
}

const rows = [
  cat({ name: "Invoices", color: "amber", emoji: "🧾", sort: 1 }),
  cat({ name: "University", color: "blue", emoji: "🎓", sort: 0 }),
  cat({ name: "Old Stuff", enabled: false, sort: 2 }),
  cat({ name: "No Colour", color: "", sort: 3 }),
  cat({ name: "Bad Colour", color: "chartreuse", sort: 4 }),
];
const byName = indexCategories(rows);

describe("resolveCategory", () => {
  it("returns null only for no category at all", () => {
    expect(resolveCategory(null, byName)).toBeNull();
    expect(resolveCategory("", byName)).toBeNull();
    expect(resolveCategory("   ", byName)).toBeNull();
  });

  it("resolves a matching row to its colour and emoji", () => {
    const r = resolveCategory("Invoices", byName)!;
    expect(r.resolution).toBe("matched");
    expect(r.hex).toBe("#f59e0b");
    expect(r.emoji).toBe("🧾");
    expect(r.name).toBe("Invoices");
  });

  it("matches case-insensitively, since the name is the join key", () => {
    // `Invoices` vs `invoices` would otherwise orphan mail the user believes
    // is filed.
    expect(resolveCategory("invoices", byName)?.resolution).toBe("matched");
    expect(resolveCategory("  UNIVERSITY ", byName)?.resolution).toBe("matched");
  });

  it("uses the row's own name, not the message's spelling", () => {
    expect(resolveCategory("invoices", byName)?.name).toBe("Invoices");
  });

  it("still renders a disabled category rather than hiding it", () => {
    // Disabling hides a category from pickers going forward; it does not
    // retroactively un-file mail. Hiding the chip would make the message look
    // uncategorised and invite a duplicate under a second name.
    const r = resolveCategory("Old Stuff", byName)!;
    expect(r.resolution).toBe("disabled");
    expect(r.name).toBe("Old Stuff");
  });

  it("marks an unmatched name as unknown instead of dropping it", () => {
    const r = resolveCategory("Renamed Away", byName)!;
    expect(r.resolution).toBe("unknown");
    expect(r.name).toBe("Renamed Away");
  });

  it("does not signal a broken colour through the hue", () => {
    // Every distinctive colour is also one a user may have picked. `Invoices`
    // is legitimately amber; if amber were also the "unrecognised colour"
    // fallback, the two would be indistinguishable — the Week view's teal
    // problem. The signal lives in `colorResolution`, not in `hex`.
    const ok = resolveCategory("Invoices", byName)!;
    const bad = resolveCategory("Bad Colour", byName)!;
    const unset = resolveCategory("No Colour", byName)!;

    expect(ok.colorResolution).toBe("ok");
    expect(bad.colorResolution).toBe("unrecognized");
    expect(unset.colorResolution).toBe("unset");

    // Both failure modes degrade to the same neutral, and neither collides
    // with a real palette entry.
    expect(bad.hex).toBe("#64748b");
    expect(unset.hex).toBe("#64748b");
    expect(bad.hex).not.toBe(ok.hex);
  });

  it("keeps hue as the signal only where no user colour can collide", () => {
    // An unmatched *name* has no row, so no user-chosen colour exists to be
    // confused with. Violet is safe there, and matches the untriaged bucket.
    const unknown = resolveCategory("Renamed Away", byName)!;
    expect(unknown.hex).toBe("#8b5cf6");
    expect(unknown.colorResolution).toBe("ok");
  });

});

describe("pickableCategories", () => {
  it("offers only enabled categories, in sort order", () => {
    const names = pickableCategories(rows).map((c) => c.name);
    expect(names).toEqual(["University", "Invoices", "No Colour", "Bad Colour"]);
    expect(names).not.toContain("Old Stuff");
  });

  it("does not mutate the input", () => {
    const before = rows.map((c) => c.name);
    pickableCategories(rows);
    expect(rows.map((c) => c.name)).toEqual(before);
  });
});
