import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ─── The invariant ───────────────────────────────────────────────────────────
//
// Nothing reachable from the note SCHEMA may import a Supabase client.
//
// `lib/noteSchemaGuard.ts` decides whether a stored note is safe to open, and it
// does that by building the schema from `buildNoteExtensions()`. `lib/supabase.ts`
// calls `createClient()` at MODULE SCOPE and throws "supabaseUrl is required"
// when the env vars are absent — so a single import anywhere in that graph makes
// "is this note safe?" depend on a configured network client. That is backwards:
// the guard exists precisely to run when things are broken.
//
// This has been got wrong before and worked around by hand twice —
// `lib/taskTags.ts` and `lib/taskFields.ts` are both "the pure half" of a module
// whose other half talks to the network, split for exactly this reason. The
// comment at the top of `PathfinderBlockLazy.tsx` states the rule. It is easy to
// break by adding one import to a file three hops away, and nothing about the
// failure points at the cause: the app still runs, and only the guard breaks,
// only when the env is missing.
//
// So it is asserted rather than remembered. The walk is a plain regex over the
// import graph — no bundler, no resolution of node_modules, which is fine
// because the rule only concerns relative imports inside src/.

const SRC = resolve(__dirname, "..");

/** Entry points that must stay client-free. */
const ROOTS = [
  "extensions/noteExtensions.ts",
  "extensions/PathfinderBlock.ts",
  "lib/noteSchemaGuard.ts",
];

const FORBIDDEN = "lib/supabase";

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // a package, not our graph
  const base = resolve(dirname(fromFile), spec);
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Every module reachable from `entry` by relative import, and how we got there. */
function walk(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    const path = seen.get(file)!;
    const src = readFileSync(file, "utf8");
    // Static imports and re-exports. A DYNAMIC import() is deliberately not
    // followed: that is exactly the escape hatch PathfinderBlockLazy uses to
    // reach the data layer without putting it on the schema path.
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*["']([^"']+)["']/g)) {
      const next = resolveImport(file, m[1]);
      if (!next || seen.has(next)) continue;
      seen.set(next, [...path, next]);
      queue.push(next);
    }
  }
  return seen;
}

describe("the note schema path stays client-free", () => {
  for (const root of ROOTS) {
    it(`${root} cannot reach ${FORBIDDEN}`, () => {
      const entry = resolve(SRC, root);
      expect(existsSync(entry), `${root} has moved — update ROOTS`).toBe(true);

      const reached = walk(entry);
      const offender = [...reached.keys()].find((f) => f.includes(`${FORBIDDEN}.ts`));
      const trail = offender
        ? reached.get(offender)!.map((f) => f.replace(SRC + "/", "")).join("\n  → ")
        : "";
      expect(offender, `${root} reaches a Supabase client:\n  ${trail}`).toBeUndefined();
    });
  }

  // A second invariant on the same walk, added when shared blocks put the first
  // VALUE import from a co-editing-adjacent module into NoteEditor.
  //
  // NoteEditor imports from `collab/` as TYPES ONLY so that yjs and both Tiptap
  // collaboration packages stay out of the eager note bundle — a comment at the
  // top of the file says so, and a comment is not a mechanism. `useSharedBlocks`
  // deliberately lives in `lib/` for this reason; the failure it prevents is a
  // future refactor tidying it back into `collab/` and silently adding the whole
  // CRDT stack to every note open.
  it("NoteEditor cannot statically reach yjs", () => {
    const entry = resolve(SRC, "components/NoteEditor.tsx");
    expect(existsSync(entry)).toBe(true);
    const reached = walk(entry);
    const offender = [...reached.keys()].find((f) =>
      /\b(yjs|y-prosemirror|Collaboration)\b/.test(readFileSync(f, "utf8").match(/from\s*["'][^"']+["']/g)?.join(" ") ?? ""));
    const trail = offender ? reached.get(offender)!.map((f) => f.replace(SRC + "/", "")).join("\n  → ") : "";
    expect(offender, `NoteEditor reaches the CRDT stack:\n  ${trail}`).toBeUndefined();
  });

  it("the walk actually works — a known importer IS caught", () => {
    // Without this, a broken walk would make every assertion above pass
    // vacuously, which is the failure mode a test like this really has.
    const known = resolve(SRC, "lib/vaultTaskFields.ts");
    const reached = walk(known);
    expect([...reached.keys()].some((f) => f.includes(`${FORBIDDEN}.ts`))).toBe(true);
  });
});
