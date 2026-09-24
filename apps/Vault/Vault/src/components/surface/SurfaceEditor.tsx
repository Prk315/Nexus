// The Surface editor: one pan-and-zoom grid of bricks, one focused level.
//
// This component owns three things and nothing else:
//   - reading the node's content into a Surface (or seeding it from a fixture)
//   - the keyboard, scoped to ONE container with tabIndex — never window
//   - handing edits back to EditorPane's `onChange`, which is what puts them
//     through api.saveContent's queue
//
// The rules themselves are in focus.ts and lod.ts, as pure functions. Nothing
// in this file decides where focus goes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultGraph } from "../../types";
import { GridView } from "./GridView";
import {
  effectiveZoom,
  initialState,
  keyToAction,
  reduce,
  viewFor,
  type Action,
  type SurfaceState,
} from "./focus";
import { detailFor } from "./lod";
import {
  DEMO_FIXTURE,
  gridAt,
  gridLevel,
  MAX_GRID_DEPTH,
  parseSurfaceContent,
  serializeSurface,
  validateSurface,
  type Surface,
} from "./model";
import "./surface.css";

export interface SurfaceEditorProps {
  nodeId: string;
  name: string;
  /** The node's stored content: "" , a pointer, or a serialized Surface. */
  content: string;
  /** EditorPane's setContent — its debounced autosave carries it to the queue. */
  onChange: (content: string) => void;
  graph?: VaultGraph;
}

let idCounter = 0;
function newBrickId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Don't take a key from something that is genuinely collecting text. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

export function SurfaceEditor({ nodeId, name, content, onChange, graph }: SurfaceEditorProps) {
  const [state, setState] = useState<SurfaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SurfaceState | null>(null);
  // The last text WE handed to onChange. Content coming back equal to it is our
  // own echo, not a new document, and reloading on it would throw away the
  // focus (and the view) on every single edit.
  const emittedRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function install(doc: Surface, from: string | null) {
    const next = initialState(doc);
    stateRef.current = next;
    setState(next);
    setSource(from);
    setError(null);
  }

  useEffect(() => {
    if (content && content === emittedRef.current) return;
    const parsed = parseSurfaceContent(content);

    if (parsed.kind === "surface") {
      install(parsed.surface, null);
      return;
    }
    if (parsed.kind === "invalid") {
      // Report, never repair. A Surface node whose content we cannot read is
      // not an empty surface — rendering one and then autosaving it is exactly
      // how lib/noteSchemaGuard.ts describes a document being eaten.
      stateRef.current = null;
      setState(null);
      setError(parsed.reason);
      return;
    }

    // Empty row or a pointer: seed from a fixture in /public. Nothing is
    // written back — opening a node must not be an edit — so the node's row
    // stays empty until the first real change persists the whole surface.
    const src = parsed.kind === "pointer" ? parsed.source : DEMO_FIXTURE;
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((json) => {
        if (!alive) return;
        const err = validateSurface(json);
        if (err) {
          setError(`fixture ${src}: ${err}`);
          return;
        }
        install(json as Surface, src);
      })
      .catch((e) => alive && setError(`could not load ${src}: ${e.message}`));
    return () => {
      alive = false;
    };
  }, [nodeId, content]);

  const dispatch = useCallback((action: Action) => {
    const prev = stateRef.current;
    if (!prev) return;
    const next = reduce(prev, action);
    if (next === prev) return;
    stateRef.current = next;
    setState(next);
    // Only a DOCUMENT change is a save. Panning, zooming and moving focus are
    // view state: persisting them would rewrite the row on every wheel event.
    if (next.doc !== prev.doc) {
      const text = serializeSurface(next.doc);
      emittedRef.current = text;
      onChangeRef.current(text);
    }
  }, []);

  // Keep the keys coming to the surface while it is in surface mode — but only
  // when focus is already somewhere inside this pane. Focusing unconditionally
  // would yank it out of the sidebar or another pane every time this one
  // re-rendered.
  const mode = state?.focus.mode;
  useEffect(() => {
    if (mode !== "surface") return;
    const host = hostRef.current;
    if (!host) return;
    const active = document.activeElement;
    if (active && active !== document.body && !host.contains(active)) return;
    host.focus({ preventScroll: true });
  }, [mode, state?.focus.gridPath.length, state?.focus.selection]);

  function onKeyDown(e: React.KeyboardEvent) {
    const s = stateRef.current;
    if (!s) return;
    // A note being edited inside a leaf keeps every key it might want. Escape
    // is the one exception, because it is the documented way back out and a
    // surface you cannot leave is worse than one that swallows a keystroke.
    if (isTextEntry(e.target) && e.key !== "Escape") return;
    const action = keyToAction(e, s.focus.mode, newBrickId);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(action);
  }

  if (error) {
    return (
      <div className="surface-host surface-host-error">
        <h3>This surface could not be read</h3>
        <p className="surface-error-reason">{error}</p>
        <p className="surface-error-help">
          Nothing has been changed and nothing will be saved over it. The stored content is{" "}
          {content.length} characters. A Surface node's content is{" "}
          <code>{'{"v":1,"root":{…}}'}</code>, or the pointer{" "}
          <code>{`{"v":1,"source":"${DEMO_FIXTURE}"}`}</code>, or empty.
        </p>
      </div>
    );
  }

  if (!state) {
    return <div className="surface-host surface-host-loading">Loading surface…</div>;
  }

  const { focus, doc } = state;
  const focusedGrid = gridAt(doc.root, focus.gridPath);
  const level = gridLevel(focus.gridPath);
  const zoom = viewFor(focus, focus.gridPath).zoom;
  const selected =
    focus.selection !== null ? focusedGrid?.children[focus.selection] ?? null : null;

  return (
    <div
      ref={hostRef}
      className="surface-host"
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="application"
      aria-label={`Surface ${name}`}
    >
      <div className="surface-stage">
        <GridView grid={doc.root} path={[]} focus={focus} dispatch={dispatch} graph={graph} />
      </div>

      <div className="surface-statusbar">
        <span className={`surface-mode is-${focus.mode}`}>
          {focus.mode === "surface" ? "SURFACE" : "COMPONENT"}
        </span>
        <span className="surface-stat">
          level {level}/{MAX_GRID_DEPTH}
          {focusedGrid ? ` · ${focusedGrid.id} · ${focusedGrid.viewport}` : ""}
        </span>
        <span className="surface-stat">{Math.round(zoom * 100)}%</span>
        <span className="surface-stat">
          lod {detailFor(effectiveZoom(focus, focus.gridPath))}
        </span>
        <span className="surface-stat">
          {selected ? `▸ ${selected.id}` : "nothing selected"}
        </span>
        {source && <span className="surface-stat surface-stat-fixture">fixture {source}</span>}
        {focus.notice && <span className="surface-notice">{focus.notice}</span>}
        <span className="surface-hint">
          {focus.mode === "surface"
            ? "arrows select · ⏎ enter · esc out · ⌘⇧arrows move · ⌘⌥⇧arrows resize · n brick · g container · 0 reset · wheel pans, ⌘wheel zooms"
            : "esc returns to the surface"}
        </span>
      </div>
    </div>
  );
}

export default SurfaceEditor;
