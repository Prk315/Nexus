// A component brick: the registry's output, plus its attributes grid.
//
// LeafView owns exactly two decisions and delegates everything else:
//   - level of detail (card vs the real renderer), from the effective zoom
//   - whether the click that landed on it means "select" or "go in"
//
// The second is the one rule the spec leaves to the implementation. A single
// click on the brick's BODY enters component mode, which is what "entering a
// leaf (click or Enter) moves inward" asks for; a click on its title bar
// selects it and stays in surface mode, which is what makes a brick moveable
// with a mouse in the loop at all. Both are visible: the bar is the handle.

import { type ReactNode } from "react";
import type { VaultGraph } from "../../types";
import type { Detail } from "./lod";
import { GAP, isLeaf, type GridNode, type LeafNode } from "./model";
import { PlaceholderCard, leafName, rendererFor } from "./renderers";

/**
 * Attributes: sub-components bound to a component (an outline beside a reader).
 *
 * Rendered, but not focus targets in this prototype — a path is a list of child
 * indices, and an attributes grid hangs off a leaf rather than sitting in its
 * parent's children, so addressing one would make every path element a tagged
 * union. The grammar carries them; the focus rules in the spec are written
 * about grid levels, and this is where that line falls.
 */
function AttributeStrip({ grid, graph }: { grid: GridNode; graph?: VaultGraph }) {
  return (
    <div className="surface-attrs" style={{ gap: GAP / 2 }}>
      {grid.children.map((attr) => (
        <div key={attr.id} className="surface-attr">
          <span className="surface-attr-name">
            {isLeaf(attr) ? leafName(attr, graph) : attr.id}
          </span>
          <span className="surface-attr-kind">
            {isLeaf(attr) ? attr.renderer : "container"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LeafView({
  leaf,
  detail,
  active,
  graph,
  onEnter,
}: {
  leaf: LeafNode;
  detail: Detail;
  /** Component mode is on this leaf. */
  active: boolean;
  graph?: VaultGraph;
  /** Ask the controller to move focus into this component. */
  onEnter: () => void;
}): ReactNode {
  // Rule 3: below the threshold a leaf is a card built from saved state. The
  // real renderer is not merely hidden — it is not mounted, so a pdf worker or
  // a TipTap instance does not exist for a brick nobody can read.
  const body =
    detail === "card" ? (
      <PlaceholderCard leaf={leaf} graph={graph} />
    ) : (
      rendererFor(leaf.renderer).render({ leaf, detail, active, graph })
    );

  return (
    <div
      className={`surface-leaf${active ? " is-active" : ""}`}
      // A click in the body goes IN. Once inside, clicks belong to the
      // component — re-dispatching on every click would fight the caret.
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!active) onEnter();
      }}
    >
      <div className="surface-leaf-body">{body}</div>
      {detail === "full" && leaf.attributes && leaf.attributes.children.length > 0 && (
        <AttributeStrip grid={leaf.attributes} graph={graph} />
      )}
    </div>
  );
}
