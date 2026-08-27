// Type-only contract between the collaboration runtime and the components that
// render it.
//
// This file exists so NoteEditor and EditorPane can talk about a collab session
// WITHOUT statically importing anything from `collab/collabRuntime.ts`. That
// matters more than it looks: a single value import of, say, `isChangeOrigin`
// from "@tiptap/extension-collaboration" would pull yjs, y-protocols and both
// Tiptap collaboration packages into the eager note bundle — for every user
// with no shared notes at all, and onto the iPad. Hence `isRemoteTransaction`
// is handed down as a FUNCTION on the session object rather than imported.
//
// Everything here is `import type`, which Vite erases entirely.

import type { Extensions } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

export type CollabStatus =
  /** Resolving the session: reading vault_ydoc, running the seed election. */
  | "loading"
  /** Channel joined; edits are flowing both ways. */
  | "live"
  /**
   * The document is healthy and still saving to vault_ydoc, but the realtime
   * channel is not joined. Editing continues — losing the socket must never
   * lose edits, and vault_ydoc's RLS is independent of Realtime.
   */
  | "offline"
  /** Setup failed. The caller falls back to the ordinary save path. */
  | "error";

export interface CollabSession {
  status: CollabStatus;
  /** Collaboration + CollaborationCaret, already configured. Appended to the
   *  note extension list; contributes plugins only, never nodes or marks. */
  extensions: Extensions;
  /**
   * True when this transaction came from the network rather than this user's
   * keyboard. Used to decide who writes the JSON projection, so a peer's
   * keystroke is not persisted twice.
   */
  isRemoteTransaction(tr: Transaction): boolean;
  /**
   * The note's doc-level attributes, captured BEFORE the Y.Doc was built.
   *
   * ALL of them, not just `width`: this is the only thing standing between a
   * doc-level setting and Yjs dropping it, so enumerating them means the next
   * one added is silently not rescued. Yjs syncs the doc's content, not the doc node — the root is rebuilt
   * with `topNodeType.create(null, …)`, so every doc-level attribute is
   * dropped. Without re-applying this the note silently snaps back to the
   * default width and the next projection write makes that permanent.
   */
  seedDocAttrs: Record<string, string>;
  /** Persist immediately (tab close, blur, visibility change). */
  flush(): void;
  destroy(): void;
}
