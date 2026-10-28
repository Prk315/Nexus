// The renderer registry.
//
// A LeafNode names a renderer by string and the registry turns it into a
// component. That indirection is the whole point of the grammar: the surface
// JSON knows nothing about React, a leaf whose renderer this build has never
// heard of still renders (as a card, saying so) instead of throwing, and adding
// a brick type is one entry here rather than a branch in the layout code.
//
// ⚠️ Nothing in here modifies an existing viewer. `note` embeds NoteEditor the
// way CanvasEditor already does (`variant="embedded"`), and the rest are honest
// placeholders until their viewers are wired up.

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "../../lib/api";
import { lazyWithReload } from "../../lib/lazyLoad";
import type { VaultGraph } from "../../types";
import { describeSize, type Detail } from "./lod";
import type { LeafNode } from "./model";

// Same lazy treatment EditorPane gives it: TipTap has no business loading
// because a surface exists, only because a note brick is actually on screen at
// full detail.
const NoteEditor = lazyWithReload(() =>
  import("../NoteEditor").then((m) => ({ default: m.NoteEditor }))
);

export interface RendererProps {
  leaf: LeafNode;
  detail: Detail;
  /** Component mode is on THIS leaf — it has the keys. */
  active: boolean;
  graph?: VaultGraph;
}

export interface Renderer {
  /** Shown on the placeholder card and in the brick's title bar. */
  label: string;
  render(props: RendererProps): ReactNode;
}

function leafState(leaf: LeafNode): Record<string, any> {
  return leaf.state && typeof leaf.state === "object" ? (leaf.state as any) : {};
}

/**
 * What to call this brick, in falling order of how much it means to a human:
 * the name saved on the leaf, the referenced node's name, the reference itself,
 * the leaf id.
 *
 * The saved name comes first deliberately — it is what the placeholder card
 * renders when the graph is not loaded and when the leaf is too small to draw
 * for real, which is exactly when the card has to be readable.
 */
export function leafName(leaf: LeafNode, graph?: VaultGraph): string {
  const state = leafState(leaf);
  if (typeof state.name === "string" && state.name) return state.name;
  if (leaf.nodeRef && graph?.nodes[leaf.nodeRef]) return graph.nodes[leaf.nodeRef].name;
  if (leaf.nodeRef) return leaf.nodeRef;
  return leaf.id;
}

/**
 * Rule 3's card: name, renderer, size — built from the leaf's SAVED state and
 * never from a live viewer, so drawing it costs nothing and works for a brick
 * whose node has not been read.
 */
export function PlaceholderCard({
  leaf,
  graph,
  note,
}: {
  leaf: LeafNode;
  graph?: VaultGraph;
  note?: string;
}) {
  return (
    <div className="surface-card">
      <div className="surface-card-name">{leafName(leaf, graph)}</div>
      <div className="surface-card-meta">
        {leaf.renderer} · {describeSize(leaf.pos)}
      </div>
      {note && <div className="surface-card-note">{note}</div>}
    </div>
  );
}

/**
 * A note brick bound to a real vault node.
 *
 * Reads through `api.readContent` and writes through `api.saveContent` — the
 * save queue, single-flight per node. Never Supabase directly: a surface can
 * hold several note bricks and two of them on one node, and unserialized
 * upserts to the same node_id are precisely what the queue exists to prevent
 * (see lib/saveQueue.ts).
 *
 * The 600ms debounce is this component's own, because the pane's autosave is
 * watching the SURFACE's content, not the note's.
 */
function NoteLeaf({ nodeId, name }: { nodeId: string; name: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef<string | null>(null);
  /** An edit the debounce has not yet written. Flushed, never discarded. */
  const pending = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setContent(null);
    setError(null);
    api
      .readContent(nodeId)
      .then((text) => {
        if (!alive) return;
        loaded.current = text;
        setContent(text);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      // FLUSH the pending edit rather than dropping it. This cleanup runs far
      // more often than "the surface closed": LeafView swaps the live editor
      // for a card below the LOD threshold, and GridView unmounts culled
      // bricks — so "type, then zoom out within 600ms" used to lose the
      // keystrokes with the status still blank. Fire-and-forget is right
      // here: nothing is left mounted to show the result, and a failure
      // still lands in the console like any other brick save failure.
      if (pending.current != null) {
        const text = pending.current;
        pending.current = null;
        api.saveContent(nodeId, text).catch((e) => {
          console.error(`[surface] note brick could not flush node ${nodeId} on unmount`, e);
        });
      }
    };
  }, [nodeId]);

  function handleChange(next: string) {
    setContent(next);
    // The mount pass, not an edit: NoteEditor emits once on load and writing
    // that back would burn a round trip per brick that comes into view.
    if (next === loaded.current) return;
    if (timer.current) clearTimeout(timer.current);
    pending.current = next;
    setStatus("saving");
    timer.current = setTimeout(() => {
      pending.current = null;
      api
        .saveContent(nodeId, next)
        .then(() => {
          loaded.current = next;
          setStatus("saved");
          setTimeout(() => setStatus(""), 1200);
        })
        .catch((e) => {
          console.error(`[surface] note brick could not save node ${nodeId}`, e);
          setStatus("error");
        });
    }, 600);
  }

  if (error) {
    return <div className="surface-leaf-error">Could not read “{name}”: {error}</div>;
  }
  if (content === null) {
    return <div className="surface-leaf-loading">Loading “{name}”…</div>;
  }
  return (
    <div className="surface-note">
      {status && <div className={`surface-note-status is-${status}`}>{status}</div>}
      <Suspense fallback={<div className="surface-leaf-loading">Loading editor…</div>}>
        {/* variant="embedded" drops the outline, the same call CanvasEditor
            makes for a rich-text block. The viewer itself is untouched. */}
        <NoteEditor content={content} onChange={handleChange} nodeId={nodeId} variant="embedded" />
      </Suspense>
    </div>
  );
}

/**
 * A renderer that only ever draws the card.
 *
 * `canvas` and `reader` are these for now: the spec's prototype scope says they
 * may be placeholders that show the referenced node's name, and embedding the
 * real CanvasEditor (which owns its own pan/zoom) inside a surface that also
 * pans and zooms is a focus-routing question this outline is meant to answer
 * first, not a wiring job to do in passing.
 */
function cardOnly(label: string, note: string): Renderer {
  return {
    label,
    render: ({ leaf, graph }) => <PlaceholderCard leaf={leaf} graph={graph} note={note} />,
  };
}

export const RENDERERS: Record<string, Renderer> = {
  placeholder: {
    label: "placeholder",
    render: ({ leaf, graph }) => <PlaceholderCard leaf={leaf} graph={graph} />,
  },

  note: {
    label: "note",
    render: ({ leaf, graph }) => {
      // Unbound, or bound to something this vault does not have: a card, not a
      // blank editor. Binding a leaf to a node is out of scope for the outline
      // — the lead seeds `nodeRef` and this lights up.
      if (!leaf.nodeRef) {
        return <PlaceholderCard leaf={leaf} graph={graph} note="no nodeRef — set one to edit a real note" />;
      }
      if (graph && !graph.nodes[leaf.nodeRef]) {
        return <PlaceholderCard leaf={leaf} graph={graph} note={`node ${leaf.nodeRef} is not in this vault`} />;
      }
      return <NoteLeaf nodeId={leaf.nodeRef} name={leafName(leaf, graph)} />;
    },
  },

  canvas: cardOnly("canvas", "canvas viewer not wired up in the outline"),
  reader: cardOnly("reader", "reader viewer not wired up in the outline"),
};

/**
 * Never throws and never renders nothing.
 *
 * A leaf whose renderer this build does not know is the ordinary case across a
 * web deploy, a Tauri app and an iPad build that update independently — the
 * same argument lib/noteSchemaGuard.ts makes for note schemas. It draws a card
 * that says which renderer is missing, and the layout is unaffected.
 */
export function rendererFor(name: string): Renderer {
  return (
    RENDERERS[name] ?? {
      label: `${name}?`,
      render: ({ leaf, graph }) => (
        <PlaceholderCard leaf={leaf} graph={graph} note={`this build has no “${name}” renderer`} />
      ),
    }
  );
}
