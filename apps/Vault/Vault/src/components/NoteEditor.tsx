import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import katex from "katex";
import { createSlashCommandsExtension, type SlashMenuState } from "../extensions/SlashCommands";
import { buildBlockRegistry, actionsFor, FONT_FAMILIES, TEXT_COLORS, type BlockAction } from "../extensions/blockRegistry";
import { buildNoteExtensions, noteSchema } from "../extensions/noteExtensions";
import { auditNoteContent, parseNoteContent } from "../lib/noteSchemaGuard";
import { NoteSchemaError } from "./NoteSchemaError";
import { NoteToolbar } from "./NoteToolbar";
import { NoteOutline } from "./NoteOutline";
import { LinkDialog, type LinkDialogState } from "./LinkDialog";
import { SlashCommandsList } from "./SlashCommandsList";
import { HighlighterCatEditor } from "./HighlighterCatEditor";
import { DatabaseInsertPicker } from "./DatabaseInsertPicker";
import { MathField } from "./MathField";
import * as api from "../lib/api";
import { DEFAULT_HIGHLIGHTERS, findAncestorOfKind, getDescendants } from "../nodeUtils";
import type { VaultGraph, HighlighterCategory, VaultRecord } from "../types";
// Types only — see collab/types.ts. A VALUE import from collab/ here would drag
// yjs and both Tiptap collaboration packages into the eager note bundle.
import type { CollabSession } from "../collab/types";
import { useSharedBlocks } from "../lib/useSharedBlocks";
import { KATEX_OPTS } from "../lib/katexShared";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";

interface MathEditState { kind: "inline" | "block"; pos: number; latex: string }

// Small centered dialog for editing an inline/block math node's LaTeX with a
// live KaTeX preview. Mirrors ConfirmDialog's visual language (see App.css
// .math-edit-*) but isn't a destructive confirmation, so it gets its own
// button styling rather than reusing .confirm-btn-danger for Save.
function MathEditPopover({
  state, onChange, onSave, onDelete, onCancel,
}: {
  state: MathEditState;
  onChange: (latex: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Local to the popover — the LaTeX string itself stays the single source
  // of truth (lifted into `mathEdit.latex`), so switching tabs never has
  // anything to reconcile.
  const [mode, setMode] = useState<"visual" | "latex">("visual");

  useEffect(() => { if (mode === "latex") textareaRef.current?.focus(); }, [mode]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    if (!state.latex.trim()) { el.innerHTML = ""; el.classList.remove("math-edit-preview-error"); return; }
    try {
      katex.render(state.latex, el, { ...KATEX_OPTS, displayMode: state.kind === "block" });
      el.classList.remove("math-edit-preview-error");
    } catch (e: any) {
      el.textContent = e?.message ?? "Invalid LaTeX";
      el.classList.add("math-edit-preview-error");
    }
    // `mode` is a dep because the preview div only exists on the LaTeX tab —
    // switching tabs must render the existing latex, not wait for an edit.
  }, [state.latex, state.kind, mode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    }
    // Capture phase, same reasoning as ConfirmDialog: don't let a global
    // Escape binding close whatever is rendered behind this dialog too.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="math-edit-backdrop" onPointerDown={onCancel}>
      <div
        className="math-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={state.kind === "block" ? "Edit math block" : "Edit inline math"}
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="math-edit-title">{state.kind === "block" ? "Math block" : "Inline math"}</div>
        <div className="math-edit-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "visual"}
            className={`math-edit-mode-tab${mode === "visual" ? " active" : ""}`}
            onClick={() => setMode("visual")}
          >Visual</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "latex"}
            className={`math-edit-mode-tab${mode === "latex" ? " active" : ""}`}
            onClick={() => setMode("latex")}
          >LaTeX</button>
        </div>
        {mode === "visual" ? (
          <MathField
            value={state.latex}
            onChange={onChange}
            autoFocus
            className="math-edit-mathfield"
          />
        ) : (
          <>
            <textarea
              ref={textareaRef}
              className="math-edit-input"
              value={state.latex}
              onChange={e => onChange(e.target.value)}
              spellCheck={false}
              rows={state.kind === "block" ? 4 : 2}
            />
            <div ref={previewRef} className="math-edit-preview" />
          </>
        )}
        <div className="math-edit-actions">
          <button className="math-edit-btn math-edit-btn-delete" onClick={onDelete} type="button">
            Delete
          </button>
          <div className="math-edit-actions-right">
            <button className="math-edit-btn math-edit-btn-cancel" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="math-edit-btn math-edit-btn-save" onClick={onSave} type="button">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The face or colour a bubble button previews.
 *
 * Looked up by ACTION ID rather than passed through the registry: an action is
 * a `{icon, run}` pair with no notion of appearance, and giving it one so that
 * four buttons can style themselves would put presentation in a module the
 * slash menu and the toolbar also read.
 */
function fontPreview(actionId: string): string | undefined {
  return FONT_FAMILIES.find((f) => `font:${f.id}` === actionId)?.value ?? undefined;
}

function colorPreview(actionId: string): string | undefined {
  return TEXT_COLORS.find((c) => `color:${c.id}` === actionId)?.value ?? undefined;
}

interface Props {
  content: string;
  /**
   * `meta.remote` marks a change that arrived from a co-editor rather than this
   * keyboard. The optional second argument keeps every other caller
   * (CanvasEditor, WorkbookEditor, BookshelfEditor, ParsedViewer) unchanged.
   */
  onChange: (content: string, meta?: { remote?: boolean }) => void;
  nodeId?: string;
  graph?: VaultGraph;
  /**
   * A live co-editing session, or null/undefined for the ordinary save path.
   *
   * Computed by EditorPane and passed in explicitly — NoteEditor deliberately
   * does NOT look at `graph` for `team_id` and decide for itself. That is what
   * makes the WorkbookEditor case structurally safe rather than a runtime
   * check: WorkbookEditor renders NoteEditors with no nodeId and no graph, so
   * it passes no session, so it takes today's exact code path. There is no
   * `if (!nodeId)` guard here for anyone to forget.
   */
  collab?: CollabSession | null;
  /**
   * Filled with a handle for pushing a document INTO this editor — restoring an
   * old version, and nothing else so far.
   *
   * A ref rather than a `restoreContent` prop because a prop would go through
   * the `content` path, and the `content` path is exactly what must not carry a
   * restore under collaboration (see the effect that installs this). Null
   * whenever no editor is mounted, which includes the schema-guard case — the
   * caller must have a route that does not need the editor, because "the stored
   * content will not parse" is precisely when someone reaches for history.
   */
  docRef?: React.MutableRefObject<NoteDocHandle | null>;
  /**
   * "embedded" drops the outline. WorkbookEditor renders one NoteEditor per
   * linked note, and N stacked outlines in a column of cards is noise, not
   * navigation.
   */
  variant?: "full" | "embedded";
}

export interface NoteDocHandle {
  /** Replace the whole document. Returns false if no live editor took it. */
  replaceDocument(json: unknown): boolean;
}

const OUTLINE_OPEN_KEY = "nexus.note.outlineOpen";

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Push a stored document's doc-level attributes onto a live editor.
 *
 * `setContent` replaces the content RANGE, not the doc node, so every doc
 * attribute survives it untouched — loading a `wide` note into an editor
 * showing `full` silently keeps `full`. Harmless on the mount path (`useEditor`
 * builds the doc from the JSON, attributes and all) and wrong everywhere else.
 *
 * Driven off the JSON's own attrs rather than a hard-coded list: `width` was
 * handled by name in three places, and a second doc attribute would have been
 * stale in all three without a single line changing.
 */
function applyDocAttrs(editor: Editor, json: unknown): void {
  const attrs = json && typeof json === "object" ? (json as any).attrs : undefined;
  if (!attrs || typeof attrs !== "object") return;
  let tr = editor.state.tr;
  let touched = false;
  for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
    if (v === undefined || editor.state.doc.attrs?.[k] === v) continue;
    tr = tr.setDocAttribute(k, v);
    touched = true;
  }
  // One transaction, and invisible to undo: an appearance change is not an edit.
  if (touched) editor.view.dispatch(tr.setMeta("addToHistory", false));
}

function parseContent(raw: string) {
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Auditing wrapper. Its only job is to decide whether mounting an editor on
 * this content is safe, and to render something inert when it isn't.
 *
 * The split exists so hooks stay unconditional: NoteEditorInner owns every
 * hook and simply isn't rendered when the audit fails. Mounting a "read-only"
 * editor instead would be a much weaker guarantee — an editor that exists can
 * emit, and one emit is all it takes (see lib/noteSchemaGuard.ts).
 */
/**
 * BubbleMenu's props MUST be referentially stable, and this is not a style
 * preference — an inline `options={{ placement: "top" }}` is an infinite render
 * loop.
 *
 * @tiptap/react's BubbleMenu has an effect that DISPATCHES A TRANSACTION when
 * any of its props change identity (react/dist/menus/index.js — the
 * `updateOptions` dispatch). NoteEditor's `onTransaction` calls forceUpdate so
 * the toolbar's isActive states refresh. A fresh object literal per render
 * therefore closes the circle: render → new options identity → dispatch →
 * forceUpdate → render. It ran at ~130 transactions a second and filled the
 * console with React's "Maximum update depth exceeded", while every keystroke
 * competed with it for the main thread.
 *
 * Declared at module scope rather than memoized with useMemo so there is no
 * dependency array to get wrong later.
 */
const BUBBLE_OPTIONS = { placement: "top" } as const;

const bubbleShouldShow = ({ editor: ed, state }: { editor: Editor; state: EditorState }) =>
  !state.selection.empty &&
  // A NodeSelection is a whole block picked up by the drag handle, not a run
  // of text. Bold/italic/link mean nothing for one, and worse: it pops the
  // menu open the moment a drag starts and covers the very drop target you're
  // aiming at.
  !(state.selection as any).node &&
  // A selection inside a code block or a math node has nothing here worth
  // applying, and the menu would just cover the content.
  !ed.isActive("codeBlock") &&
  !ed.isActive("blockMath");

export function NoteEditor(props: Props) {
  const audit = useMemo(
    () => auditNoteContent(parseNoteContent(props.content), noteSchema()),
    [props.content]
  );

  if (!audit.ok) {
    return (
      <NoteSchemaError audit={audit} content={props.content} onRecover={props.onChange} />
    );
  }
  // Remount on a transition between blocked and editable so the editor never
  // inherits state built from content it was never allowed to see.
  return <NoteEditorInner {...props} />;
}

function NoteEditorInner({ content, onChange, nodeId, graph, variant = "full", collab, docRef }: Props) {
  const isCollab = !!collab;
  // Read inside effects/callbacks that must not re-run when the session
  // identity changes. `collab` is stable for the life of a mount (EditorPane
  // keys the editor on it), but a ref keeps the [content] effect's dependency
  // list unchanged, which matters given how much that effect's comment warns
  // about its own timing.
  const collabRef = useRef<CollabSession | null | undefined>(collab);
  collabRef.current = collab;
  const [, forceUpdate] = useState(0);
  // Set when Tiptap itself rejects the content (structurally invalid but with
  // known types — the case the pre-flight audit deliberately doesn't cover).
  // While set, nothing may leave this component.
  const [hardBlocked, setHardBlocked] = useState(false);
  const hardBlockedRef = useRef(false);
  hardBlockedRef.current = hardBlocked;
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [mathEdit, setMathEdit] = useState<MathEditState | null>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persisted, and defaulted from the viewport ONCE rather than tracked with a
  // resize listener — a panel that opens and closes itself as the window is
  // dragged is worse than one that stays where it was put.
  const [showOutline, setShowOutline] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(OUTLINE_OPEN_KEY);
    if (stored !== null) return stored === "1";
    return window.matchMedia("(min-width: 1100px)").matches;
  });

  useEffect(() => {
    window.localStorage.setItem(OUTLINE_OPEN_KEY, showOutline ? "1" : "0");
  }, [showOutline]);

  // Highlighter categories (this note's own set) + database insert picker.
  const [highlighters, setHighlighters] = useState<HighlighterCategory[]>([]);
  const [editingCats, setEditingCats] = useState(false);
  const [picker, setPicker] = useState<{ records: VaultRecord[]; dbName: string } | null>(null);
  const [pickerMsg, setPickerMsg] = useState<string | null>(null);

  const setMenuRef = useRef(setSlashMenu);
  setMenuRef.current = setSlashMenu;

  const keyHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  // The registry is rebuilt whenever its inputs change (highlighters loading,
  // a Database ancestor appearing), but the slash extension must be created
  // exactly once — a new instance would rebuild the whole ProseMirror plugin
  // stack. The ref is the seam between the two lifetimes.
  const registryRef = useRef<BlockAction[]>([]);

  const slashExtRef = useRef(
    createSlashCommandsExtension(
      () => registryRef.current,
      (s) => setMenuRef.current(s),
      () => keyHandlerRef.current
    )
  );

  // ⌘K. Bound here rather than in the Link extension because the handler opens
  // React state, and this extension is created once so the keymap is stable.
  const linkShortcutRef = useRef<((editor: any) => void) | null>(null);
  const linkKeyExtRef = useRef(
    Extension.create({
      name: "noteLinkShortcut",
      addKeyboardShortcuts() {
        return {
          "Mod-k": () => {
            linkShortcutRef.current?.(this.editor);
            return true;
          },
        };
      },
    })
  );

  // Tracks the last JSON string emitted via onChange so we can skip a
  // setContent call when the content prop is just echoing back our own edit.
  //
  // Seeded with the INITIAL content, not "". Seeded empty, the effect below
  // fires once on mount and replaces the document with the identical content
  // `useEditor` had already loaded — a full ReplaceStep, recorded in the undo
  // history. The damage isn't the wasted work: undoing a whole-document
  // replacement restores the entire previous doc, so the first Cmd-Z after
  // opening a note wipes out any attribute-only change made since, including
  // the `addToHistory: false` toggle collapses that are specifically meant to
  // be invisible to undo.
  const lastEmittedRef = useRef<string>(content);

  const editor = useEditor({
    // One shared list, also used to derive the schema the wrapper audits
    // against — see extensions/noteExtensions.ts. Do not inline extensions
    // here; a second copy of the list makes the guard validate against a
    // schema this editor doesn't actually have.
    extensions: buildNoteExtensions({
      onMathClick: (kind, node, pos) => setMathEdit({ kind, pos, latex: node.attrs.latex }),
      extra: [slashExtRef.current, linkKeyExtRef.current],
      // Empty for a private note. Supplying it also disables StarterKit's
      // undoRedo — one fused decision, see noteExtensions.ts.
      collab: collab?.extensions,
    }),
    // Under collaboration the document comes from the Y.Doc, which ySync
    // installs on first render. Passing initial content as well is at best
    // wasted work and at worst a second copy of the note.
    content: isCollab ? null : parseContent(content),
    // Catches content whose types all exist but whose *nesting* is invalid —
    // the residue the pre-flight audit deliberately doesn't check. Tiptap
    // recovers by substituting an empty doc, so the only safe response is to
    // stop emitting; onUpdate below is the thing that would overwrite.
    enableContentCheck: true,
    onContentError: ({ error, disableCollaboration }) => {
      console.error("[vault] note content failed validation; edits are disabled", error);
      // Under collaboration this fires from Collaboration's own
      // filterInvalidContent plugin, which hands us the kill switch. Calling it
      // stops ySync writing the substitute document back into the shared Y.Doc,
      // where it would reach the other person too.
      disableCollaboration?.();
      setHardBlocked(true);
    },
    onUpdate: ({ editor, transaction }) => {
      // The single most important line in this file. When the document Tiptap
      // holds is not the document that was stored, letting one keystroke
      // through means EditorPane's 400ms autosave writes the substitute over
      // the original, and vault_content keeps no history.
      if (hardBlockedRef.current) return;
      // editor.getJSON() reads the live ProseMirror document, attributes and
      // all. Never project from the Y.Doc instead: ySync rebuilds the root as
      // `topNodeType.create(null, …)`, so a projection taken from there loses
      // the per-note `width` permanently.
      const json = JSON.stringify(editor.getJSON());
      lastEmittedRef.current = json;
      // Remote changes still flow through onChange — EditorPane's `content`
      // state and globalContentCache must track the live document so a second
      // pane, the outline and PDF export all stay correct. The flag stops the
      // WRITE, not the state update: only the client whose keyboard produced a
      // change persists the projection for it.
      onChange(json, { remote: collabRef.current?.isRemoteTransaction(transaction) ?? false });
    },
    onTransaction: () => forceUpdate((n) => n + 1),
  });

  // Shared containers, kept in step with their own `share:{id}` rows.
  //
  // Off under collaboration: on a co-edited note the Y.Doc is already the
  // authority for the whole document, and a second mechanism replacing ranges
  // inside it would be two writers on one buffer with no ordering between them.
  // A shared block inside a co-edited note therefore syncs through the CRDT for
  // that note's participants and does not publish to its share row — narrower
  // than ideal, and far better than the two fighting.
  useSharedBlocks(editor, !isCollab);

  useEffect(() => {
    // `!editor` is NOT a sufficient guard, and this is the bug that white-screened
    // the live app on `main`. A DESTROYED editor is still a perfectly truthy
    // object — Tiptap's teardown only nulls its internals — so `editor.commands`
    // hits `get commands() { return this.commandManager.commands }` with a null
    // commandManager and throws "Cannot read properties of null (reading
    // 'commands')". This effect depends on [content] alone, so it can fire while
    // holding an editor that was torn down between the async content load and
    // the commit; on main, with no error boundary above, that took the whole app
    // down. Intermittent, because it's a race with the readContent await.
    if (!editor || editor.isDestroyed) return;
    // Under collaboration the CRDT is the merge authority and this effect must
    // not run at all. `setContent` on a Yjs-backed document is a full
    // ReplaceStep against the shared fragment: it deletes everything the other
    // person has written and re-inserts our copy as brand-new CRDT operations.
    // With both people typing that is a mutual annihilation loop, not a
    // refresh. Remote changes arrive through ySync instead, which is the whole
    // point of the exercise.
    if (collabRef.current) return;
    // Content came from this editor's own keystroke — no need to setContent.
    if (content === lastEmittedRef.current) return;
    lastEmittedRef.current = content;
    try {
      // setContent forwards enableContentCheck to createDocument and does NOT
      // catch, so with the flag on this can throw synchronously inside an
      // effect. The wrapper's audit makes that near-unreachable for unknown
      // types; this covers the invalid-nesting case it doesn't check.
      const parsed = parseContent(content);
      editor.commands.setContent(parsed, { emitUpdate: false });

      // setContent replaces the content RANGE, not the doc node, so doc-level
      // attributes survive it untouched — asking it to load a doc with
      // width:"wide" into an editor currently showing width:"full" silently
      // keeps "full". Harmless on the mount path (useEditor builds the doc
      // from the JSON, attributes and all), but this effect also runs when the
      // same open note changes underneath us — another device, another pane —
      // and without this the width would quietly stay stale.
      // Every doc-level attribute, not just width — see DOC_ATTRS. An
      // enumerated list here is how `textSize` would have gone stale on the
      // "same note changed underneath us" path while width did not.
      applyDocAttrs(editor, parsed);
    } catch (e) {
      console.error("[vault] refusing to load note content into the editor", e);
      setHardBlocked(true);
    }
  }, [content]);

  // Restore the per-note width under collaboration.
  //
  // Yjs syncs the document's CONTENT — a Y.XmlFragment — and ySync rebuilds the
  // root node as `schema.topNodeType.create(null, …)`. `create(null, …)` means
  // EVERY doc-level attribute is dropped, so NoteDocument's `width` and
  // `textSize` snap back to their defaults the instant a note goes
  // collaborative. That alone would be a
  // visual annoyance; what makes it destructive is the projection write that
  // follows, which would persist the default and lose a wide note's layout for
  // good.
  //
  // So re-apply it from the seed JSON, captured before the Y.Doc was built.
  // `addToHistory: false` for the same reason the width dispatch above uses it:
  // an attribute-only change must stay invisible to undo.
  //
  // Note this restores but does not SYNC — changing the width still only
  // affects your own view. Sharing it needs a Y.Map on the same doc; that is a
  // separate, self-contained change.
  useEffect(() => {
    if (!collab || !editor || editor.isDestroyed) return;
    const want = collab.seedDocAttrs;
    const keys = Object.keys(want);
    if (keys.length === 0) return;
    let cancelled = false;
    // After ySync's first render, not before — it replaces the doc.
    const id = setTimeout(() => {
      if (cancelled || editor.isDestroyed) return;
      try {
        // One transaction for all of them: two dispatches would be two undo
        // steps to skip past, and they describe a single "restore what Yjs
        // dropped" event rather than two decisions.
        let tr = editor.state.tr;
        let touched = false;
        for (const k of keys) {
          if (editor.state.doc.attrs?.[k] === want[k]) continue;
          tr = tr.setDocAttribute(k, want[k]);
          touched = true;
        }
        if (touched) editor.view.dispatch(tr.setMeta("addToHistory", false));
      } catch {
        // editor.view throws before the view exists (v3 getter). Nothing to do:
        // these are cosmetic and the next mount will retry.
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [collab, editor]);

  // ── Restoring an old version ───────────────────────────────────────────────
  // The one sanctioned way to push a document INTO this editor from outside.
  //
  // It exists because the [content] effect above cannot do it: under
  // collaboration that effect returns early, deliberately and correctly, since
  // a prop-driven setContent on a shared document is a mutual-annihilation loop
  // with the other person's typing. But a restore is not the prop echoing back —
  // it is a deliberate, user-initiated edit, and under a CRDT it MUST go through
  // the editor so ySync turns it into operations the other person receives.
  // Writing the restored JSON straight to vault_content instead would be
  // invisible to the Y.Doc and the next projection flush would undo it.
  //
  // The same call is right for a private note, where it simply behaves like a
  // very large paste: onUpdate fires and EditorPane's autosave persists it.
  useEffect(() => {
    if (!docRef) return;
    docRef.current = {
      replaceDocument(json: unknown): boolean {
        // Same guard as everywhere else in this file, and for the same reason:
        // a destroyed editor is truthy, and this handle is held by a component
        // that outlives the editor.
        if (!editor || editor.isDestroyed) return false;
        try {
          // emitUpdate: true — unlike the [content] effect, which suppresses it
          // because that content already came FROM the server. This one has to
          // emit or nothing would ever save it.
          editor.commands.setContent(json as never, { emitUpdate: true });
          // setContent replaces the content RANGE, not the doc node, so the
          // restored version's width would otherwise be silently ignored — the
          // same trap the [content] effect documents.
          applyDocAttrs(editor, json);
          return true;
        } catch (e) {
          console.error("[vault] could not apply the restored version to the editor", e);
          return false;
        }
      },
    };
    return () => {
      docRef.current = null;
    };
  }, [editor, docRef]);

  // Load this note's highlighter categories; seed defaults on first use.
  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;
    (async () => {
      let sets = await api.readHighlighters(nodeId);
      if (sets.length === 0) {
        sets = DEFAULT_HIGHLIGHTERS;
        await api.saveHighlighters(nodeId, sets);
      }
      if (!cancelled) setHighlighters(sets);
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  function persistHighlighters(next: HighlighterCategory[]) {
    setHighlighters(next);
    if (nodeId) api.saveHighlighters(nodeId, next);
  }

  // Apply a highlighter to the current selection and record it into the database.
  function applyCategory(cat: HighlighterCategory) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    editor.chain().focus().setHighlight({ color: cat.color, category: cat.name } as any).run();
    if (from === to) return; // nothing selected → only sets the mark for typing
    const text = editor.state.doc.textBetween(from, to, " ").replace(/\s+/g, " ").trim();
    if (text && nodeId) {
      api.insertRecord({
        source_node_id: nodeId,
        category: cat.name,
        color: cat.color,
        text,
        location: "",
      }).catch(() => { /* non-fatal: the visual highlight is already applied */ });
    }
  }

  // Open the ancestor Database node's records for insertion at the cursor.
  async function openDatabasePicker() {
    if (!nodeId || !graph) { setPickerMsg("This note is not inside a database."); return; }
    const dbId = findAncestorOfKind(graph, nodeId, "Database");
    if (!dbId) { setPickerMsg("No database node found above this note."); return; }
    const sources = getDescendants(graph, dbId);
    const records = await api.readRecordsForSources(sources);
    setPicker({ records, dbName: graph.nodes[dbId]?.name ?? "Database" });
  }

  function insertRecords(recs: VaultRecord[]) {
    if (editor && recs.length) {
      const html =
        "<ul>" +
        recs.map(r => `<li><strong>${escapeHtml(r.category)}:</strong> ${escapeHtml(r.text)}</li>`).join("") +
        "</ul>";
      editor.chain().focus().insertContent(html).run();
    }
    setPicker(null);
  }

  // ── Links ─────────────────────────────────────────────────────────────────

  function openLinkDialog(ed: any) {
    const { from, to, empty } = ed.state.selection;
    const existing = ed.getAttributes("link")?.href ?? "";
    // With the cursor merely inside a link (nothing selected), operate on the
    // whole mark rather than a zero-width point — otherwise Save would apply
    // the href to an empty range and appear to do nothing.
    if (empty && existing) ed.chain().focus().extendMarkRange("link").run();
    const sel = ed.state.selection;
    const selectedText = empty && !existing ? "" : ed.state.doc.textBetween(sel.from, sel.to, " ");
    setLinkDialog({ href: existing, label: selectedText, editing: !!existing });
    void from; void to;
  }
  linkShortcutRef.current = openLinkDialog;

  function saveLink(href: string, label: string) {
    if (!editor) return;
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive("link")) {
      // Nothing to wrap — insert the text (or the URL) already linked.
      const text = label.trim() || href;
      editor.chain().focus()
        .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
        // Leave the caret *outside* the mark, or the next character typed
        // silently joins the link.
        .unsetMark("link")
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkDialog(null);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkDialog(null);
  }

  // ── Images ────────────────────────────────────────────────────────────────

  // A hidden <input type=file>, because there is no way to open a file picker
  // without one. Paste and drag-drop are handled inside the extension; all
  // three routes go through the same Storage upload.
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickImage() {
    fileInputRef.current?.click();
  }

  async function onImageChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    // Reset first: choosing the SAME file twice fires no change event otherwise.
    e.target.value = "";
    if (!editor || files.length === 0) return;
    for (const file of files) {
      try {
        const url = await api.uploadCanvasImage(file);
        // Same reason as the content effect: the note may have been closed
        // while the upload was in flight, and a destroyed editor is truthy.
        if (editor.isDestroyed) return;
        editor.chain().focus().setImage({ src: url }).run();
      } catch (err) {
        console.error("[vault] image upload failed; nothing was inserted", err);
        setPickerMsg("Could not upload that image.");
      }
    }
  }

  // ── Registry ──────────────────────────────────────────────────────────────

  const registry = useMemo(
    () =>
      buildBlockRegistry({
        onInlineMath: insertInlineMathAtCursor,
        onBlockMath: insertBlockMathAtCursor,
        onEditLink: openLinkDialog,
        // Omitted entirely when there's no note context, so the action simply
        // doesn't exist rather than existing and failing.
        onDatabaseInsert: nodeId
          ? (ed, ctx) => {
              if (ctx?.range) ed.chain().focus().deleteRange(ctx.range).run();
              openDatabasePicker();
            }
          : undefined,
        highlighters: nodeId ? highlighters : [],
        onApplyHighlighter: applyCategory,
        onEditHighlighters: nodeId ? () => setEditingCats((v) => !v) : undefined,
        onPickImage: pickImage,
      }),
    // editor identity is what makes the closures above valid; the rest are the
    // genuine inputs to the list's shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, nodeId, highlighters, graph]
  );
  registryRef.current = registry;

  const swatches = useMemo(() => {
    const out: Record<string, string> = {};
    for (const cat of highlighters) out[`highlight:${cat.name}`] = cat.color;
    return out;
  }, [highlighters]);

  // The extension's update/delete commands require doc.nodeAt(pos) to be
  // EXACTLY the math node — anything else silently returns false, which is
  // how a stale position turns Save into a no-op with no error anywhere.
  // Positions captured before an insert are guesses (a block insert in
  // particular does not land the node at selection.from), so never trust a
  // stored pos: re-resolve against the live document, falling back to the
  // nearest node of the right type if the exact position no longer holds it.
  function resolveMathPos(kind: "inline" | "block", pos: number): number | null {
    if (!editor) return null;
    const typeName = kind === "inline" ? "inlineMath" : "blockMath";
    const doc = editor.state.doc;
    if (pos >= 0 && pos <= doc.content.size && doc.nodeAt(pos)?.type.name === typeName) return pos;

    // The fallback used to be "nearest node of this type anywhere in the doc",
    // measured by absolute position distance. That was already a guess, and
    // columns make it actively wrong: positions in a two-column row interleave
    // in a way unrelated to visual proximity, so a math node in column 1 can be
    // numerically closer than the one you just clicked in column 2 — and Save
    // would silently rewrite the wrong equation.
    //
    // Restricting the search to the caret's own ancestor keeps a stale position
    // from escaping into a sibling column, a callout, or a table cell.
    let scopeFrom = 0;
    let scopeTo = doc.content.size;
    if (pos >= 0 && pos <= doc.content.size) {
      const $pos = doc.resolve(Math.min(pos, doc.content.size));
      for (let d = $pos.depth; d > 0; d--) {
        const name = $pos.node(d).type.name;
        if (name === "column" || name === "calloutBlock" || name === "containerBlock" ||
            name === "toggleContent" || name === "tableCell" || name === "tableHeader") {
          scopeFrom = $pos.before(d);
          scopeTo = $pos.after(d);
          break;
        }
      }
    }

    let found: number | null = null;
    let best = Infinity;
    doc.nodesBetween(scopeFrom, scopeTo, (n, p) => {
      if (n.type.name === typeName) {
        const d = Math.abs(p - pos);
        if (d < best) { best = d; found = p; }
      }
      return true;
    });
    return found;
  }

  // Insert a placeholder math node at the cursor, then immediately open the
  // popover on it so the user types the real expression right away.
  //
  // The position comes from the insert's own step map, not from
  // selection.from: a *block* insert does not leave the selection on the node
  // it created, so reading the selection afterwards was a guess that only
  // happened to work in a flat document.
  function insertMathAtCursor(kind: "inline" | "block") {
    if (!editor) return;
    const before = editor.state.doc;
    const chain = editor.chain().focus();
    (kind === "inline"
      ? chain.insertInlineMath({ latex: "x" })
      : chain.insertBlockMath({ latex: "x" })
    ).run();

    const typeName = kind === "inline" ? "inlineMath" : "blockMath";
    const doc = editor.state.doc;
    if (doc === before) return; // the insert was refused

    // The newly created node is the one nearest the caret that wasn't there a
    // moment ago; scanning from the selection outward finds it without relying
    // on where the command chose to leave the cursor.
    const from = editor.state.selection.from;
    let pos: number | null = null;
    let best = Infinity;
    doc.descendants((n, p) => {
      if (n.type.name === typeName) {
        const d = Math.abs(p - from);
        if (d < best) { best = d; pos = p; }
      }
      return true;
    });
    if (pos !== null) setMathEdit({ kind, pos, latex: "x" });
  }

  function insertInlineMathAtCursor() { insertMathAtCursor("inline"); }
  function insertBlockMathAtCursor() { insertMathAtCursor("block"); }

  function saveMathEdit() {
    if (!editor || !mathEdit) return;
    const pos = resolveMathPos(mathEdit.kind, mathEdit.pos);
    if (pos !== null) {
      if (mathEdit.kind === "inline") {
        editor.chain().focus().updateInlineMath({ latex: mathEdit.latex, pos }).run();
      } else {
        editor.chain().focus().updateBlockMath({ latex: mathEdit.latex, pos }).run();
      }
    }
    setMathEdit(null);
  }

  function deleteMathEdit() {
    if (!editor || !mathEdit) return;
    const pos = resolveMathPos(mathEdit.kind, mathEdit.pos);
    if (pos !== null) {
      if (mathEdit.kind === "inline") {
        editor.chain().focus().deleteInlineMath({ pos }).run();
      } else {
        editor.chain().focus().deleteBlockMath({ pos }).run();
      }
    }
    setMathEdit(null);
  }

  if (!editor) return null;

  return (
    <div ref={wrapperRef} className="tiptap-wrapper">
      {hardBlocked && (
        // Not merely cosmetic: onUpdate is gated on the same flag, so while
        // this is showing nothing typed here reaches the server. Say so
        // plainly rather than let the user believe their edits are saving.
        <div className="note-blocked-banner" role="alert">
          <strong>Edits are not being saved.</strong> Vault couldn't load this note's stored content
          safely, so it has been left untouched on the server. Reload after updating Vault.
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={onImageChosen}
      />
      <NoteToolbar
        editor={editor}
        registry={registry}
        swatches={swatches}
        trailing={
          variant === "full" ? (
            <span className="tt-group tt-group-end">
              <span className="tt-sep" />
              <button
                className={`tt-btn${showOutline ? " active" : ""}`}
                type="button"
                onClick={() => setShowOutline((v) => !v)}
                title={showOutline ? "Hide outline" : "Show outline"}
                aria-label="Toggle outline"
                aria-pressed={showOutline}
              >
                ◧
              </button>
            </span>
          ) : null
        }
      />
      {editingCats && (
        <HighlighterCatEditor
          cats={highlighters}
          onChange={persistHighlighters}
          onClose={() => setEditingCats(false)}
        />
      )}
      {picker && (
        <DatabaseInsertPicker
          records={picker.records}
          dbName={picker.dbName}
          onInsert={insertRecords}
          onClose={() => setPicker(null)}
        />
      )}
      {pickerMsg && (
        <div className="db-picker-toast" onClick={() => setPickerMsg(null)}>
          {pickerMsg}
        </div>
      )}
      {/* Formatting where the text is. This is the iPad answer above all —
          .tt-btn is a 13px, 4×8px-padded target, which is fine with a mouse
          and miserable with a thumb at the top of the screen. */}
      <BubbleMenu editor={editor} options={BUBBLE_OPTIONS} shouldShow={bubbleShouldShow}>
        <div className="tt-bubble">
          {actionsFor(registry, "bubble").map((a, i, all) => (
            <Fragment key={a.id}>
              {/* A hairline wherever the group changes. The bubble renders every
                  bubble action flat, and with fonts and colours in it that is a
                  long undifferentiated row — the separator is what makes it
                  scannable without adding a single tap. */}
              {i > 0 && all[i - 1].group !== a.group ? <span className="tt-bubble-sep" /> : null}
            <button
              type="button"
              className={`tt-btn${a.isActive?.(editor) ? " active" : ""}${swatches[a.id] ? " tt-hl-btn" : ""}`}
              // The colour swatch IS the label, so the face/colour is also the
              // preview — a button that shows what it does rather than naming it.
              style={a.group === "font" ? { fontFamily: fontPreview(a.id) } : a.group === "color" ? { color: colorPreview(a.id) } : undefined}
              title={a.shortcut ? `${a.title} (${a.shortcut})` : a.title}
              aria-label={a.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => a.run(editor)}
            >
              {swatches[a.id] && <span className="tt-hl-swatch" style={{ background: swatches[a.id] }} />}
              {a.short ?? a.icon}
            </button>
            </Fragment>
          ))}
        </div>
      </BubbleMenu>

      {/* Outline on the LEFT, in the flow, resizable — not a hover-revealed
          overlay on the right. The old panel appeared only when the mouse
          neared the right edge, which on iPad meant it could not be opened at
          all. Its visibility is a persisted preference now. */}
      <div className="tiptap-body">
        {showOutline && variant === "full" && (
          <NoteOutline
            editor={editor}
            scrollRef={scrollRef}
            onClose={() => setShowOutline(false)}
          />
        )}
        {/* The scroller is this wrapper, not EditorContent itself — the
            scroll-spy needs a stable ref to it and EditorContent's own ref
            contract isn't something to depend on. `.tiptap-editor .ProseMirror`
            still matches, since it was always a descendant selector. */}
        <div className="tiptap-editor" ref={scrollRef}>
          <EditorContent editor={editor} />
        </div>
      </div>
      {linkDialog && (
        <LinkDialog
          state={linkDialog}
          onSave={saveLink}
          onRemove={removeLink}
          onCancel={() => setLinkDialog(null)}
        />
      )}
      {slashMenu && (
        <SlashCommandsList
          {...slashMenu}
          keyHandlerRef={keyHandlerRef}
        />
      )}
      {mathEdit && (
        <MathEditPopover
          state={mathEdit}
          onChange={(latex) => setMathEdit(m => m && { ...m, latex })}
          onSave={saveMathEdit}
          onDelete={deleteMathEdit}
          onCancel={() => setMathEdit(null)}
        />
      )}
    </div>
  );
}
