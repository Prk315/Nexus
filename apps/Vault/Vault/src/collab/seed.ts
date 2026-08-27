// Turning a stored Tiptap JSON note into a Yjs document, exactly once.
//
// ─── The trap this module exists to avoid ────────────────────────────────────
// A CRDT converges by merging operations, and `prosemirrorJSONToYDoc` MINTS
// NEW OPERATIONS every time it runs — with a fresh clientID and fresh clocks.
// So two clients that each hydrate a Y.Doc from the same stored JSON have not
// produced "the same document twice": they have produced two independent
// documents that happen to read alike, and merging them concatenates both.
// The user sees their note duplicated end to end. @tiptap/y-tiptap says as
// much in its own docstring: "this should not be used to rehydrate a Y.Doc
// from a database once collaboration has begun as all history will be lost."
//
// The fix is an election: exactly one client's bytes become authoritative, and
// EVERY client — winner included — then hydrates from those bytes. The winner
// never edits the doc it built. `buildSeedState` therefore returns bytes and
// destroys its candidate immediately; nothing outside this file ever holds a
// Y.Doc that came from JSON. There is no `if (won)` branch for a later
// refactor to get wrong.
//
// The I/O half of the election (the upsert-ignore-duplicates and the re-read)
// lives in lib/api.ts so this module stays pure and unit-testable.

import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import type { Schema } from "@tiptap/pm/model";
import { toB64, fromB64 } from "./base64";

/**
 * The Y.XmlFragment key the document lives under.
 *
 * MUST equal `Collaboration`'s `field` default. Note that
 * `prosemirrorJSONToYDoc`'s own default is `"prosemirror"` — a DIFFERENT
 * string — so this has to be passed explicitly on both sides. Get it wrong and
 * there is no error: the editor mounts against an empty fragment and the note
 * simply appears blank.
 */
export const FRAGMENT = "default";

/**
 * Whether this client should offer itself as the seeder.
 *
 * An empty note must NOT seed. Two people opening a never-written note would
 * both insert an empty state, and the loser would then hydrate the winner's
 * empty document — which is fine here, but the rule earns its keep in the
 * asymmetric case: if one client's `readContent` failed and returned "" while
 * the other has real content, seeding from the empty side would publish an
 * empty document as authoritative and the real content would be gone. Because
 * only a client holding content ever inserts, a row that exists always came
 * from a client that had something to say.
 */
export function shouldSeed(seedJson: string): boolean {
  const trimmed = seedJson.trim();
  if (!trimmed) return false;
  try {
    const doc = JSON.parse(trimmed);
    const content = doc?.doc?.content ?? doc?.content;
    return Array.isArray(content) && content.length > 0;
  } catch {
    // Legacy HTML content, or anything unparseable. It is not empty, and
    // Tiptap can parse it, so it is worth seeding from.
    return true;
  }
}

/**
 * Build candidate seed bytes from stored note JSON, then throw the candidate
 * away. Returns base64.
 */
export function buildSeedState(parsedContent: unknown, schema: Schema): string {
  const candidate = prosemirrorJSONToYDoc(schema, parsedContent, FRAGMENT);
  try {
    return toB64(Y.encodeStateAsUpdate(candidate));
  } finally {
    // Immediately. This doc is a serialisation vehicle, never an editing
    // surface — see the header.
    candidate.destroy();
  }
}

/** Origin tag for every update this client applies on behalf of the network. */
export const PROVIDER_ORIGIN = Symbol("vault-collab-remote");

/**
 * Build the live Y.Doc from authoritative bytes. Winner and loser of the
 * election run this identically.
 */
export function hydrate(stateB64: string): Y.Doc {
  const doc = new Y.Doc();
  if (stateB64) Y.applyUpdate(doc, fromB64(stateB64), PROVIDER_ORIGIN);
  return doc;
}

/**
 * Pull the doc-level `width` attribute out of stored note JSON.
 *
 * Yjs syncs the doc's CONTENT (a Y.XmlFragment); the root node is rebuilt with
 * `schema.topNodeType.create(null, …)` — attrs dropped. So NoteDocument's
 * per-note `width` does not survive the round trip and would silently reset to
 * the default the moment a note goes collaborative, then get written back to
 * vault_content as the default, permanently losing the layout. Capturing it
 * here lets NoteEditor re-apply it after the first render.
 */
export function readSeedWidth(seedJson: string): string | undefined {
  try {
    const doc = JSON.parse(seedJson);
    const attrs = doc?.doc?.attrs ?? doc?.attrs;
    const width = attrs?.width;
    return typeof width === "string" ? width : undefined;
  } catch {
    return undefined;
  }
}
