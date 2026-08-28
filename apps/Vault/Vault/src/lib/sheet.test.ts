import { describe, it, expect } from "vitest";
import {
  colName, refName, parseRef, expandRange, expandRanges, sheetNames,
  evaluateSheet, isFormula, fmtCell, MAX_DEPTH, type Sheet,
} from "./sheet";

const sheet = (cells: Record<string, string>, rows = 6, cols = 4): Sheet =>
  ({ cells: new Map(Object.entries(cells)), rows, cols });

const val = (s: Sheet, ref: string) => evaluateSheet(s).get(ref);

describe("addresses", () => {
  it("names columns the way a spreadsheet does, past Z", () => {
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
    expect(colName(26)).toBe("AA");
    expect(colName(27)).toBe("AB");
    expect(colName(51)).toBe("AZ");
    expect(colName(52)).toBe("BA");
  });

  it("round-trips every address it can name", () => {
    for (let col = 0; col < 60; col++) {
      for (const row of [0, 1, 9, 99]) {
        expect(parseRef(refName({ col, row }))).toEqual({ col, row });
      }
    }
  });

  it("refuses what is not an address", () => {
    for (const bad of ["", "A", "1", "A0", "a1", "A 1", "$A$1", "AA"]) {
      expect(parseRef(bad), bad).toBeNull();
    }
  });

  it("expands a range in reading order, either way round", () => {
    expect(expandRange({ col: 0, row: 0 }, { col: 1, row: 1 }).map(refName))
      .toEqual(["A1", "B1", "A2", "B2"]);
    // A3:A1 is the same range as A1:A3 — a user drags a selection both ways.
    expect(expandRange({ col: 0, row: 2 }, { col: 0, row: 0 }).map(refName))
      .toEqual(["A1", "A2", "A3"]);
  });
});

describe("expandRanges", () => {
  const filled = (set: string[]) => (r: string) => set.includes(r);

  it("rewrites an aggregate into an expression the evaluator already knows", () => {
    expect(expandRanges("sum(A1:A3)", filled(["A1", "A2", "A3"]))).toBe("(A1 + A2 + A3)");
    expect(expandRanges("avg(A1:A2)", filled(["A1", "A2"]))).toBe("((A1 + A2) / 2)");
    expect(expandRanges("min(A1:A3)", filled(["A1", "A2", "A3"]))).toBe("min(min(A1, A2), A3)");
  });

  // ⚠️ Absent is not zero — the fourth place this rule appears. A sum over ten
  // rows where three are filled is the sum of three, and the average divides
  // by three.
  it("drops empty cells rather than counting them as zero", () => {
    expect(expandRanges("sum(A1:A3)", filled(["A1", "A3"]))).toBe("(A1 + A3)");
    expect(expandRanges("avg(A1:A4)", filled(["A1", "A2"]))).toBe("((A1 + A2) / 2)");
    expect(expandRanges("count(A1:A9)", filled(["A1", "A5"]))).toBe("2");
  });

  it("yields null, not zero, for an aggregate over nothing", () => {
    expect(expandRanges("sum(A1:A9)", filled([]))).toBe("nullv");
    // …except count, where zero is the honest answer to "how many".
    expect(expandRanges("count(A1:A9)", filled([]))).toBe("0");
  });

  // A partially rewritten string would reach the parser as a syntax error and
  // report the wrong problem entirely.
  it("returns null for a malformed range or an unknown aggregate", () => {
    expect(expandRanges("median(A1:A3)", filled(["A1"]))).toBeNull();
    expect(expandRanges("sum(A0:A3)", filled(["A1"]))).toBeNull();
  });

  it("leaves an expression with no range alone", () => {
    expect(expandRanges("A1 * 2 + B1", filled(["A1", "B1"]))).toBe("A1 * 2 + B1");
  });
});

describe("evaluateSheet", () => {
  it("computes a formula over literal cells", () => {
    expect(val(sheet({ A1: "2", A2: "3", B1: "=A1 * A2" }), "B1")?.value).toBe(6);
  });

  it("follows a chain of formulas", () => {
    const s = sheet({ A1: "10", B1: "=A1 * 2", C1: "=B1 + 5" });
    expect(val(s, "C1")?.value).toBe(25);
  });

  it("sums a range, skipping the gaps", () => {
    const s = sheet({ A1: "1", A3: "3", A4: "=sum(A1:A3)" });
    expect(val(s, "A4")?.value).toBe(4);
  });

  // Caught by writing the test above carelessly, which is exactly how a user
  // writes it: the total goes at the bottom of the column and the range is
  // dragged over the whole column including the total. Every spreadsheet calls
  // this a circular reference, and so must this one — the range expands to
  // individual cells, so the self-reference is a real one, not a special case.
  it("treats a range that contains its own cell as a cycle", () => {
    const s = sheet({ A1: "1", A3: "3", A4: "=sum(A1:A4)" });
    expect(val(s, "A4")?.error).toBe("circular reference");
  });

  // ⚠️ The load-bearing test. `A1 = B1` / `B1 = A1` is one keystroke away in any
  // real sheet, and unbounded recursion inside a ProseMirror plugin is a blank
  // white page, not an error message.
  describe("cycles", () => {
    it("reports a direct cycle instead of recursing forever", () => {
      const s = sheet({ A1: "=B1", B1: "=A1" });
      expect(val(s, "A1")?.error).toBe("circular reference");
      expect(val(s, "B1")?.error).toBeTruthy();
    });

    it("reports a cycle through three cells", () => {
      const s = sheet({ A1: "=B1", B1: "=C1", C1: "=A1" });
      expect(val(s, "A1")?.error).toBeTruthy();
    });

    it("reports a cell that references itself", () => {
      expect(val(sheet({ A1: "=A1 + 1" }), "A1")?.error).toBe("circular reference");
    });

    // A cycle in one corner must not take the rest of the sheet down with it.
    it("leaves unrelated cells computing correctly", () => {
      const s = sheet({ A1: "=B1", B1: "=A1", C1: "4", D1: "=C1 * 2" });
      expect(val(s, "A1")?.error).toBeTruthy();
      expect(val(s, "D1")?.value).toBe(8);
      expect(val(s, "D1")?.error).toBeNull();
    });

    it("stops a chain longer than MAX_DEPTH rather than blowing the stack", () => {
      const cells: Record<string, string> = { A1: "1" };
      for (let i = 2; i <= MAX_DEPTH + 20; i++) cells[`A${i}`] = `=A${i - 1} + 1`;
      const s = sheet(cells, MAX_DEPTH + 40, 2);
      // No assertion about which cells succeed — only that it terminates and
      // reports rather than throwing out of the evaluator.
      expect(() => evaluateSheet(s)).not.toThrow();
    });
  });

  describe("references", () => {
    // "A1" is a substring of "A12". A substring test would resolve A1 for a
    // formula that only mentions A12 — extra work, and a cycle reported
    // through a cell the user never referenced.
    it("matches on word boundaries, so A1 is not found inside A12", () => {
      const s = sheet({ A12: "7", A1: "=A12", B1: "=A12 * 2" }, 14, 3);
      expect(val(s, "B1")?.value).toBe(14);
      expect(val(s, "A1")?.value).toBe(7);
    });

    // An empty cell is a normal thing to point at; reporting it as an error
    // would make half of every sheet under construction red.
    it("reads an empty cell inside the table as null, not an error", () => {
      const r = val(sheet({ A1: "=B1" }), "A1");
      expect(r?.error).toBeNull();
      expect(r?.value).toBeNull();
    });

    // …but a reference outside it is a mistake worth naming.
    it("names a reference outside the table", () => {
      const r = val(sheet({ A1: "=Z99" }, 3, 3), "A1");
      expect(r?.error).toBeTruthy();
      expect(r?.error).toContain("Z99");
    });

    it("has every in-bounds address available, and nothing else", () => {
      const names = sheetNames({ cells: new Map(), rows: 2, cols: 2 });
      expect(names.sort()).toEqual(["A1", "A2", "B1", "B2", "nullv"].sort());
    });
  });

  describe("failures stay local and legible", () => {
    it("keeps a syntax error in one cell out of the others", () => {
      const s = sheet({ A1: "=1 +", B1: "=2 + 2" });
      expect(val(s, "A1")?.error).toBeTruthy();
      expect(val(s, "B1")?.value).toBe(4);
    });

    it("never yields Infinity from a division by zero", () => {
      const s = sheet({ A1: "0", B1: "=1 / A1" });
      const r = val(s, "B1");
      expect(r?.value).toBeNull();
      expect(Number.isFinite(r?.value as number)).toBe(false);
    });

    it("treats a non-numeric literal cell as null rather than NaN", () => {
      const s = sheet({ A1: "hello", B1: "=A1 + 1" });
      expect(val(s, "B1")?.value).toBeNull();
    });
  });

  it("leaves non-formula cells out of the result entirely", () => {
    const out = evaluateSheet(sheet({ A1: "1", A2: "text" }));
    expect(out.size).toBe(0);
  });
});

describe("isFormula and fmtCell", () => {
  it("recognises a formula, including one with leading space", () => {
    expect(isFormula("=1+1")).toBe(true);
    expect(isFormula("  =1+1")).toBe(true);
    expect(isFormula("1+1")).toBe(false);
    expect(isFormula("")).toBe(false);
  });

  it("renders null as a dash rather than as zero or blank", () => {
    // Blank would be indistinguishable from an empty cell; 0 would be a lie.
    expect(fmtCell(null)).toBe("—");
    expect(fmtCell(0)).toBe("0");
    expect(fmtCell(1.005)).toBe("1");
    expect(fmtCell(1.567)).toBe("1.57");
    expect(fmtCell(true)).toBe("yes");
    expect(fmtCell(false)).toBe("no");
  });
});
