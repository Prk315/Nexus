import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  collectShares, changedShares, serializeShare, parseShare, loadDecision,
  shareIdOf, REMOTE_META, type PmNode,
} from "./sharedBlocks";
import { readSharedBlock, saveSharedBlock } from "./api";

// ⚠️ Deliberately in lib/, not collab/, even though it is co-editing of a sort.
// NoteEditor imports from collab/ as TYPES ONLY, to keep yjs and both Tiptap
// collaboration packages out of the eager note bundle — and this hook must be a
// value import. It shares nothing with the CRDT path: a shared block syncs on
// open and on a debounce, not character by character.

/**
 * Keep every shared container in this editor in step with its `share:{id}` row.
 *
 * The rules live in `lib/sharedBlocks.ts` and are tested there; this file is the
 * effect that runs them. What it adds is the two things that only exist at
 * runtime — the write loop, and an editor that can be torn down mid-await.
 *
 * ── ⚠️ The write loop ──────────────────────────────────────────────────────
 *
 * Applying a remote update dispatches a transaction; a transaction schedules a
 * save; the save writes back what was just received. Nothing in that loop is
 * slow enough to notice and nothing terminates it. Two independent guards:
 *
 *   1. The apply path marks its transaction with REMOTE_META and the save path
 *      skips it. Precise, and cheap.
 *   2. `seen` holds the last payload written OR read for each share, so a write
 *      only happens when the content genuinely differs. This is the guard that
 *      also covers a transaction nobody marked — a plugin's own dispatch, a
 *      selection change, a re-render.
 *
 * Guard 2 alone would be enough for correctness but not for quiet: without
 * guard 1 every remote apply still costs a comparison of every share on the
 * next transaction. Guard 1 alone is not enough at all, because it only knows
 * about transactions this code produced.
 *
 * ── Teardown ───────────────────────────────────────────────────────────────
 *
 * Every await here can outlive the editor. `editor.isDestroyed` is checked
 * after each one — a destroyed editor is still TRUTHY, and reaching
 * `editor.commands` on one hits a null commandManager, which is the crash that
 * white-screened Vault once already.
 */
export function useSharedBlocks(editor: Editor | null, enabled: boolean): void {
  /** shareId → the payload this client last read from or wrote to the row. */
  const seen = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  //
  // Runs when the document identity changes, not on every transaction: the
  // share row is authoritative at OPEN. Treating it as authoritative
  // continuously would fight the user's own typing.
  useEffect(() => {
    if (!editor || !enabled) return;
    let cancelled = false;

    void (async () => {
      const shares = collectShares(editor.getJSON() as PmNode);
      for (const [id, local] of shares) {
        let stored: PmNode[] | null = null;
        try {
          stored = parseShare(await readSharedBlock(id));
        } catch {
          // A failed read degrades to "you see your last copy", never to a
          // hole in the page — the blocks are in the note's own document too.
          continue;
        }
        if (cancelled || editor.isDestroyed) return;

        const decision = loadDecision(stored, local);
        if (decision.action === "apply") {
          seen.current.set(id, serializeShare(decision.content));
          applyShare(editor, id, decision.content);
        } else if (decision.action === "seed") {
          const payload = serializeShare(decision.content);
          seen.current.set(id, payload);
          try { await saveSharedBlock(id, payload); } catch { seen.current.delete(id); }
        } else {
          // Agreed already — record it so the first keystroke is not read as a
          // change and immediately written back.
          seen.current.set(id, serializeShare(local));
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, enabled]);

  // ── Save ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor || !enabled) return;

    const onTransaction = ({ transaction }: { transaction: any }) => {
      // Guard 1. A remote apply must not be echoed back.
      if (transaction.getMeta(REMOTE_META)) return;
      if (!transaction.docChanged) return;

      if (timer.current) clearTimeout(timer.current);
      // Debounced to match the note's own autosave cadence. A write per
      // transaction would be ~60 row updates a second, each one a queued
      // Supabase upsert — the shape of the 2026-08-15 incident.
      timer.current = setTimeout(() => {
        if (editor.isDestroyed) return;
        // Guard 2. Only what actually differs.
        const shares = collectShares(editor.getJSON() as PmNode);
        for (const { id, payload } of changedShares(shares, seen.current)) {
          seen.current.set(id, payload);
          void saveSharedBlock(id, payload).catch(() => {
            // Forget it so the next edit retries. Keeping it would mean one
            // failed write silently stops that share syncing for the session.
            seen.current.delete(id);
          });
        }
      }, 500);
    };

    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [editor, enabled]);
}

/**
 * Replace every copy of one share's content in the document.
 *
 * Every copy, because the same share may legitimately appear twice in one note.
 * Positions are collected first and applied back-to-front: replacing a range
 * shifts every position after it, so a forward pass would apply the second
 * replacement at an offset that no longer means what it did.
 */
function applyShare(editor: Editor, shareId: string, content: PmNode[]): void {
  let view;
  try {
    // ⚠️ In Tiptap v3 this getter THROWS before the view exists, which a layout
    // effect can hit during React's remount.
    view = editor.view;
  } catch {
    return;
  }
  if (!view) return;

  const { state } = view;
  const targets: Array<{ from: number; to: number }> = [];
  state.doc.descendants((node: any, pos: number) => {
    if (shareIdOf(node.toJSON() as PmNode) !== shareId) return true;
    // The container's INNER range — its content, not the container itself, so
    // the block keeps its own type, its card colour and its share id.
    targets.push({ from: pos + 1, to: pos + node.nodeSize - 1 });
    return false; // a share inside a share is not a thing; don't recurse in
  });
  if (targets.length === 0) return;

  const tr = state.tr;
  let fragment;
  try {
    fragment = state.schema.nodeFromJSON({ type: "doc", content }).content;
  } catch {
    // An unknown node type inside a share would throw here. Refusing is the
    // whole point: applying a partial parse would silently drop blocks, and
    // the next save would publish that loss to every other note.
    return;
  }

  for (let i = targets.length - 1; i >= 0; i--) {
    tr.replaceWith(targets[i].from, targets[i].to, fragment);
  }
  tr.setMeta(REMOTE_META, true);
  // addToHistory false: a remote change is not something the local user did,
  // and Cmd-Z on it would "undo" the other note's edit into this one's history.
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}
