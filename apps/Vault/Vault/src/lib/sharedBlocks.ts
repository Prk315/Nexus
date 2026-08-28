// Containers that are the SAME container in more than one note.
//
// ── Where the content lives, and why not in either note ────────────────────
//
// A shared block's content lives in its own `vault_content` row, keyed
// `share:{id}`. Both notes hold an ordinary container node carrying that id.
//
// The obvious alternative — one note owns the content and the other holds a
// reference — was rejected because it makes the two sides unequal in a way the
// feature's whole point denies. "Editable in both places" then means the
// borrowing note writes into a document it does not have open, through a save
// queue keyed by a node id that is not its own, and deleting the owning note
// silently empties every dashboard that borrowed from it. With a row of its
// own there is no owner to lose, and the two sides are the same code path.
//
// This is the same idiom Vault already uses for PDF annotations (`{id}_annot`)
// and book margins (`{id}_margins`): content that belongs to a node but not
// inside it gets its own row.
//
// ── The subtree is stored TWICE, deliberately ──────────────────────────────
//
// The blocks also stay in the note's own document. That duplication is the
// point: a note remains self-contained, renders offline, exports whole, and
// survives the share row being unreachable. The row is an exchange medium, not
// the note's storage — so a failed share read degrades to "you see your last
// copy" rather than to a hole in the page.
//
// On load the ROW WINS, because it is the shared truth and the local copy is
// only whatever this device last saw. A missing row is seeded from the note,
// which is what makes sharing an existing block a no-op rather than a wipe.
//
// ── ⚠️ The write loop ──────────────────────────────────────────────────────
//
// Applying a remote update dispatches a transaction; a transaction schedules a
// save; the save writes back what was just received; the other side then reads
// its own write as a change. Nothing about that loop is slow enough to notice
// and nothing about it terminates. Two independent guards, because either alone
// has a hole:
//
//   1. A transaction that came from a remote apply carries REMOTE_META, and the
//      save side skips it. Cheap, and precise.
//   2. `changedShares` compares against the last SEEN payload, so a write is
//      only sent when the content genuinely differs. This is the one that also
//      covers a transaction that is not marked — a selection change, a
//      re-render, a plugin's own dispatch.

export const SHARE_PREFIX = "share:";

/** Transaction meta set by the apply path, checked by the save path. */
export const REMOTE_META = "vaultSharedRemote";

/** A share id is minted here so the format is in one place. Short, because it
 *  is stored in every copy of every note that uses the block. */
export function newShareId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function shareKey(id: string): string {
  return SHARE_PREFIX + id;
}

/** A minimal ProseMirror JSON node, as far as this module cares. */
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: unknown[];
}

/**
 * Every shared block in a document, by id.
 *
 * ⚠️ Keyed by id and not by position: the same share may legitimately appear
 * TWICE in one note (a summary at the top and the detail below it), and a
 * position-keyed map would silently drop one of them — then write the survivor
 * over the other on the next save.
 */
export function collectShares(doc: PmNode | null | undefined): Map<string, PmNode[]> {
  const out = new Map<string, PmNode[]>();
  walk(doc, (n) => {
    const id = shareIdOf(n);
    if (id && !out.has(id)) out.set(id, n.content ?? []);
  });
  return out;
}

/** The share id a node carries, or null. */
export function shareIdOf(n: PmNode): string | null {
  const v = n.attrs?.shareId;
  return typeof v === "string" && v ? v : null;
}

function walk(n: PmNode | null | undefined, fn: (n: PmNode) => void): void {
  if (!n || typeof n !== "object") return;
  fn(n);
  for (const c of n.content ?? []) walk(c, fn);
}

/**
 * Which shares differ from what was last seen.
 *
 * The second guard against the write loop, and the only one that survives an
 * unmarked transaction. Comparison is on the serialised payload rather than by
 * reference: ProseMirror rebuilds nodes on every transaction, so reference
 * equality is always false and would make every keystroke a write.
 */
export function changedShares(
  current: Map<string, PmNode[]>,
  seen: Map<string, string>,
): Array<{ id: string; payload: string }> {
  const out: Array<{ id: string; payload: string }> = [];
  for (const [id, content] of current) {
    const payload = serializeShare(content);
    if (seen.get(id) !== payload) out.push({ id, payload });
  }
  return out;
}

/** The stored form. An array of blocks, not a doc — a share is a container's
 *  CONTENTS, so wrapping it in a doc node would make it un-nestable and would
 *  bake in whichever container happened to be sharing it first. */
export function serializeShare(content: PmNode[]): string {
  return JSON.stringify(content ?? []);
}

/**
 * Parse a stored share.
 *
 * ⚠️ Returns null — never `[]` — for anything unusable. An empty array is a
 * legitimate value meaning "this shared block is empty", and returning it for a
 * failed read would replace every copy of the block with nothing and then save
 * that. Absent and empty are different, the same distinction `blocking_state`
 * makes by not being seeded.
 */
export function parseShare(raw: string | null | undefined): PmNode[] | null {
  if (raw == null || raw === "") return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    // A share whose blocks are not objects is corrupt, not empty.
    return v.every((n) => n && typeof n === "object" && typeof (n as PmNode).type === "string")
      ? (v as PmNode[])
      : null;
  } catch {
    return null;
  }
}

/**
 * A container's content is empty in ProseMirror's sense.
 *
 * `block+` cannot hold zero children, so an "empty" shared block is one empty
 * paragraph. Seeding a row from such a block would publish emptiness over
 * whatever the other note already has, so the sync treats it as nothing to
 * seed with.
 */
export function isEmptyContent(content: PmNode[] | null | undefined): boolean {
  if (!content || content.length === 0) return true;
  return content.every(
    (n) => n.type === "paragraph" && (!n.content || n.content.length === 0),
  );
}

/**
 * What to do for one share on load.
 *
 * Split out from React so the decision is testable on its own — it is four
 * cases and three of them are only reachable in situations that are awkward to
 * reproduce by clicking.
 */
export function loadDecision(
  stored: PmNode[] | null,
  local: PmNode[],
): { action: "apply"; content: PmNode[] } | { action: "seed"; content: PmNode[] } | { action: "none" } {
  // The row wins: it is the shared truth, the local copy is only what this
  // device last saw.
  if (stored !== null) {
    return serializeShare(stored) === serializeShare(local)
      ? { action: "none" }
      : { action: "apply", content: stored };
  }
  // No row yet. Sharing an existing block must be a no-op for that block, so
  // its current content becomes the row.
  if (!isEmptyContent(local)) return { action: "seed", content: local };
  // Nothing anywhere. Writing an empty row now would make the FIRST note to
  // open a freshly shared block publish its emptiness over the second one's
  // content, if the second happened to be seeded a moment later.
  return { action: "none" };
}
