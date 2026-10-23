import { VaultGraph, VaultNode, NodeKind } from "../../types";

// A builder for the tests in this folder. Kept out of the `.test.ts` files so
// the three of them describe the SAME vault — the seeded dev one: UNI over four
// subject folders over five course folders each, plus the reader node whose
// kind this branch does not know.
//
// Not imported by any component; it exists so a test can say "Mathematics" and
// mean something.

const OWNER = "27eaf403-c5b4-43d5-aef4-01f37a08e590";

export interface Spec {
  id: string;
  kind?: string;
  tags?: string[];
  children?: Spec[];
  team_id?: string | null;
  user_id?: string;
}

export function buildGraph(roots: Spec[]): VaultGraph {
  const nodes: Record<string, VaultNode> = {};
  const edges: Record<string, string[]> = {};
  const back_edges: Record<string, string[]> = {};

  function add(spec: Spec, parent: string | null) {
    if (!nodes[spec.id]) {
      nodes[spec.id] = {
        id: spec.id,
        name: spec.id,
        // Cast: the point of the reader node is a kind this build's union has
        // never heard of, which is exactly what the tree must survive.
        kind: { type: spec.kind ?? "Folder" } as NodeKind,
        tags: spec.tags ?? [],
        team_id: spec.team_id ?? null,
        user_id: spec.user_id ?? OWNER,
      };
    }
    if (parent) {
      (edges[parent] ??= []).push(spec.id);
      (back_edges[spec.id] ??= []).push(parent);
    }
    for (const child of spec.children ?? []) add(child, spec.id);
  }

  for (const r of roots) add(r, null);
  return { nodes, edges, back_edges, tag_colors: { math: "#3b82f6", robots: "#ef4444" } };
}

/** The seeded dev vault, small enough to assert against by hand. */
export function uniGraph(): VaultGraph {
  const course = (subject: string, tag: string, n: number): Spec[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${subject}-c${i + 1}`,
      kind: "Folder",
      tags: [tag],
    }));

  return buildGraph([
    {
      id: "UNI",
      children: [
        {
          id: "Mathematics",
          tags: ["math"],
          children: [
            ...course("Mathematics", "math", 5),
            // The reader branch's node: an unknown kind, under Mathematics.
            { id: "Kalkulus (reader)", kind: "Reader", tags: ["math"] },
          ],
        },
        { id: "Information Systems", tags: ["information-systems"], children: course("IS", "information-systems", 5) },
        { id: "Robotics", tags: ["robots"], children: course("Robotics", "robots", 5) },
        { id: "Quantum Engineering", tags: ["quantum-engineering"], children: course("QE", "quantum-engineering", 5) },
      ],
    },
  ]);
}
