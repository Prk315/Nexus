/**
 * Layer derivation — LEARN_PLAN.md, "Layered unit flow (pinned, 2026-08-10)".
 *
 * A unit is consumed as interleaved LAYERS (theory chunk → example → drills,
 * repeated), then one rapid tap-round, then the test — not as one theory slab
 * followed by all the practice. Layers are derived **client-side** from the
 * existing v1 content; nothing is re-authored and no schema changes.
 *
 * Algorithm (pure, deterministic, no fetching):
 *
 *  1. `practice[]` splits in two, preserving authored order:
 *     the non-`tiles` groups become the layers (one layer per group), and
 *     every `archetype: "tiles"` group goes to the final round.
 *  2. Anchoring — walk the layer groups in order; each takes the theory boxes
 *     **not yet assigned** whose `concept_id` is in that group's
 *     `concept_ids`, in theory order. First group to name a concept wins it,
 *     so a later group repeating an earlier concept adds no theory.
 *  3. Orphans — theory boxes no group named. Each attaches to the layer
 *     holding the nearest *anchored* box by theory-order position (ties go to
 *     the earlier layer, so a box between two layers is read before its
 *     drills rather than after). A box trailing every anchor appends to the
 *     last layer. Orphans never become anchors themselves, so the result does
 *     not depend on the order orphans are visited.
 *  4. Each layer's theory is re-sorted into original theory order.
 *
 * Degenerate cases:
 *  - one non-tiles group → one layer (the old Theory → Practice flow);
 *  - no tiles groups → no final round (`finalRound: []`);
 *  - no non-tiles groups but theory exists → a single theory-only layer with
 *    `group: null` (otherwise the theory would be unreachable);
 *  - nothing at all → `layers: []`;
 *  - no anchors anywhere (no theory box's concept is named by any group) →
 *    step 3's "nearest" is undefined, so boxes are spread proportionally over
 *    the layers by theory position. This is the one place the pinned rule is
 *    silent; the literal "append to last" reading would dump the entire
 *    theory into the final layer, which is exactly the front/back-loading the
 *    layered flow exists to avoid.
 *
 * The test's `unlock_ratio` still counts across ALL drills (layers + final
 * round) — that gate is global and is unaffected by how the drills are split
 * up here. `totalDrills` is exported for exactly that sum.
 *
 * An authored `layers` field may override this later; the derivation is the
 * v1 mechanism.
 */

import type { Drill, PracticeGroup, TheoryBox, UnitContent, UnitFlow, UnitLayer } from "./types";

export function deriveLayers(content: UnitContent): UnitFlow {
  const theory: TheoryBox[] = content.theory ?? [];
  const practice: PracticeGroup[] = content.practice ?? [];

  const layerGroups = practice.filter((g) => g.archetype !== "tiles");
  const finalRound = practice.filter((g) => g.archetype === "tiles");
  const finalDrills: Drill[] = finalRound.flatMap((g) => g.drills ?? []);
  const totalDrills = practice.reduce((n, g) => n + (g.drills?.length ?? 0), 0);

  const L = layerGroups.length;

  // --- Degenerate: nothing to layer on -------------------------------------
  if (L === 0) {
    const layers: UnitLayer[] =
      theory.length > 0 ? [{ index: 0, theory: theory.slice(), group: null, drills: [] }] : [];
    return { layers, finalRound, finalDrills, test: content.test, totalDrills };
  }

  // --- 2. Anchor theory boxes to the first group that names their concept ---
  // `owner[i]` = the layer index theory box i belongs to, or null while
  // unassigned. Groups outer / theory inner keeps "in theory order" true
  // within each group's take.
  const owner: Array<number | null> = theory.map(() => null);
  layerGroups.forEach((group, li) => {
    const ids = new Set(group.concept_ids ?? []);
    theory.forEach((box, ti) => {
      if (owner[ti] === null && ids.has(box.concept_id)) owner[ti] = li;
    });
  });

  // --- 3. Orphans ----------------------------------------------------------
  const anchors: number[][] = layerGroups.map(() => []);
  owner.forEach((li, ti) => {
    if (li !== null) anchors[li].push(ti);
  });
  const anchoredIdx = owner.map((li, ti) => (li === null ? -1 : ti)).filter((ti) => ti >= 0);
  const hasAnchors = anchoredIdx.length > 0;
  const maxAnchor = hasAnchors ? Math.max(...anchoredIdx) : -1;

  theory.forEach((_, ti) => {
    if (owner[ti] !== null) return;

    if (!hasAnchors) {
      // No anchors at all — spread by position (see the header comment).
      owner[ti] = Math.min(L - 1, Math.floor((ti * L) / Math.max(theory.length, 1)));
      return;
    }
    if (ti > maxAnchor) {
      owner[ti] = L - 1; // trailing → append to last
      return;
    }
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let li = 0; li < L; li++) {
      for (const a of anchors[li]) {
        const d = Math.abs(a - ti);
        // Strict `<` while walking layers ascending = ties go to the earlier
        // layer.
        if (d < bestDist) {
          bestDist = d;
          best = li;
        }
      }
    }
    owner[ti] = best;
  });

  // --- 4. Assemble, theory in original order inside each layer -------------
  const perLayerTheory: TheoryBox[][] = layerGroups.map(() => []);
  theory.forEach((box, ti) => {
    perLayerTheory[owner[ti] as number].push(box);
  });

  const layers: UnitLayer[] = layerGroups.map((group, li) => ({
    index: li,
    theory: perLayerTheory[li],
    group,
    drills: group.drills ?? [],
  }));

  return { layers, finalRound, finalDrills, test: content.test, totalDrills };
}
