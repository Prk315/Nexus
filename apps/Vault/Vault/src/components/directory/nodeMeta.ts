import { NodeKind } from "../../types";
import { kindColor, nodeIcon } from "../../nodeUtils";

// ⚠️ `kindColor` and `nodeIcon` switch exhaustively over the NodeKind union and
// have no default arm, so a kind this build has never heard of — `Reader`, being
// added on another branch against the same one database — comes back
// `undefined`. That is not a type error here (the value claims to be a NodeKind)
// and it is not a crash either: it surfaces as a node with no glyph and an
// invalid canvas fillStyle, i.e. a node that silently looks broken.
//
// `nodeUtils.ts` belongs to the reader branch, so this branch adds nothing to
// it. Everything the directory draws goes through these two wrappers instead,
// and an unknown kind renders as a plain generic node.

/** Neutral glyph for a kind this build does not know. */
export const GENERIC_ICON = "◇";
/** Neutral hex for the same — canvas and SVG need a value, not a token. */
export const GENERIC_COLOR = "#8e8e93";

export function safeIcon(kind: NodeKind | undefined | null): string {
  if (!kind) return GENERIC_ICON;
  return nodeIcon(kind) ?? GENERIC_ICON;
}

/**
 * The glyph for a kind named by string — what the create menu has before any
 * node exists. Goes through the same fallback, so a kind the menu offers but
 * this build cannot draw still gets an icon rather than a blank.
 */
export function iconForKindName(name: string): string {
  return safeIcon({ type: name } as NodeKind);
}

export function safeColor(kind: NodeKind | undefined | null): string {
  if (!kind) return GENERIC_COLOR;
  return kindColor(kind) ?? GENERIC_COLOR;
}

/** What to call a kind in a tooltip. Unknown kinds still have a `type` string. */
export function kindLabel(kind: NodeKind | undefined | null): string {
  return (kind as { type?: string } | null | undefined)?.type ?? "Node";
}

export function isFolder(kind: NodeKind | undefined | null): boolean {
  return kindLabel(kind) === "Folder";
}
