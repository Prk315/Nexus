// Collapsible headings: click the arrow in a heading's gutter and everything
// under it folds away until the next heading of the same or higher rank.
//
// **This is deliberately not a container.** The obvious implementation — wrap
// the section in a `toggleBlock` — would be a structural change to the
// document, and it would be wrong three times over:
//
//   1. It moves content. The collapsed flag itself IS persisted and does reach
//      the other devices — deliberately, exactly as the toggle's `open`
//      attribute already does, because a fold that forgets itself on reload is
//      not worth having. What a container would additionally do is relocate
//      every block of the section one level deeper in the tree, so a fold and
//      an unfold are structural edits. Get one wrong and you have lost the
//      section, not merely its fold state; and `vault_content` keeps no
//      history. One boolean is a far cheaper thing to be wrong about.
//   2. It changes what the outline sees. `buildOutline` walks siblings; burying
//      headings one level deeper per fold would reshuffle the outline every
//      time somebody collapsed something.
//   3. It needs a new NODE type, and an unknown node type blanks the whole note
//      on a client that hasn't updated (see lib/noteSchemaGuard.ts). An
//      attribute on `heading` is ignored by such a client instead — the section
//      simply renders expanded. Same trade as the per-note width, for the same
//      reason.
//
// So the document stays flat and the fold is decorations: a class on each
// hidden sibling, plus a widget for the arrow. Nothing about the stored JSON
// changes except one boolean on the heading.

import Heading from "@tiptap/extension-heading";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

export const headingFoldKey = new PluginKey("vaultHeadingFold");

export interface HeadingSection {
  /** Position of the heading itself. */
  pos: number;
  node: PMNode;
  level: number;
  collapsed: boolean;
  /** Positions of the sibling blocks this heading owns, in document order. */
  owned: { pos: number; node: PMNode }[];
}

/**
 * Every heading in the document, with the siblings it owns.
 *
 * "Owns" means: the blocks that follow it, within the SAME parent, up to the
 * next heading of the same or higher rank. Scoping to the parent is what makes
 * this work inside a callout or a column — a heading in column 1 folds column
 * 1's content and cannot reach across the row. It falls out of the recursion
 * for free rather than needing a special case.
 */
export function scanHeadingSections(doc: PMNode): HeadingSection[] {
  const out: HeadingSection[] = [];

  const visit = (parent: PMNode, base: number) => {
    const kids: { node: PMNode; pos: number }[] = [];
    parent.forEach((child, offset) => kids.push({ node: child, pos: base + offset }));

    for (let i = 0; i < kids.length; i++) {
      const { node, pos } = kids[i];
      if (node.type.name !== "heading") continue;
      const level = node.attrs.level ?? 1;
      const owned: { pos: number; node: PMNode }[] = [];
      for (let j = i + 1; j < kids.length; j++) {
        const k = kids[j];
        if (k.node.type.name === "heading" && (k.node.attrs.level ?? 1) <= level) break;
        owned.push(k);
      }
      out.push({ pos, node, level, collapsed: node.attrs.collapsed === true, owned });
    }
  };

  visit(doc, 0);
  doc.descendants((node, pos) => {
    // Every node that holds blocks is a scope of its own. Textblocks are
    // skipped because their children are inline; there are no headings there.
    if (node.isBlock && !node.isTextblock && node.childCount) visit(node, pos + 1);
  });

  return out;
}

/** Positions of collapsed headings whose folded region contains `pos`. */
export function foldsCovering(doc: PMNode, pos: number): number[] {
  const hit: number[] = [];
  for (const s of scanHeadingSections(doc)) {
    if (!s.collapsed) continue;
    for (const o of s.owned) {
      if (pos >= o.pos && pos <= o.pos + o.node.nodeSize) {
        hit.push(s.pos);
        break;
      }
    }
  }
  return hit;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];

  for (const s of scanHeadingSections(doc)) {
    const foldable = s.owned.length > 0;

    // The arrow. Only rendered where there is something to fold — an arrow on
    // every heading, most of them inert, teaches people it does nothing.
    if (foldable) {
      decos.push(
        Decoration.widget(
          s.pos + 1,
          (view, getPos) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "heading-fold" + (s.collapsed ? " is-collapsed" : "");
            btn.setAttribute("contenteditable", "false");
            btn.setAttribute("aria-expanded", s.collapsed ? "false" : "true");
            btn.setAttribute(
              "aria-label",
              s.collapsed ? "Expand section" : "Collapse section"
            );
            btn.title = s.collapsed ? "Expand section" : "Collapse section";
            btn.textContent = "▾";
            btn.addEventListener("mousedown", (e) => {
              // Without this the click places a caret first and the heading
              // scrolls under the pointer. The button is not a text position.
              e.preventDefault();
              e.stopPropagation();
              const at = getPos();
              // getPos() is the widget's own position — one inside the heading.
              const headingPos = typeof at === "number" ? at - 1 : s.pos;
              toggleHeadingFoldAt(view, headingPos);
            });
            return btn;
          },
          {
            side: -1,
            // The key is what tells ProseMirror the widget must be redrawn.
            // Without the collapsed flag in it, flipping the attribute reuses
            // the cached DOM and the arrow never turns around.
            key: `fold-${s.pos}-${s.collapsed}`,
            stopEvent: () => true,
            ignoreSelection: true,
          }
        )
      );
      decos.push(
        Decoration.node(s.pos, s.pos + s.node.nodeSize, {
          class: s.collapsed ? "has-fold is-collapsed" : "has-fold",
        })
      );
    }

    if (!s.collapsed) continue;
    for (const o of s.owned) {
      decos.push(Decoration.node(o.pos, o.pos + o.node.nodeSize, { class: "is-folded" }));
    }
  }

  return DecorationSet.create(doc, decos);
}

/**
 * Flip one heading's fold state.
 *
 * Exported because the toolbar action and the arrow both need it, and because
 * the selection rescue below is the part that is easy to forget: hiding the
 * block the caret is in with `display: none` does not move the caret. Typing
 * then edits text nobody can see, which is the trap the toggle node view
 * documents too.
 */
export function toggleHeadingFoldAt(view: EditorView, headingPos: number, to?: boolean) {
  const { state } = view;
  const node = state.doc.nodeAt(headingPos);
  if (!node || node.type.name !== "heading") return false;

  const next = to ?? !(node.attrs.collapsed === true);
  const tr = state.tr.setNodeAttribute(headingPos, "collapsed", next);

  if (next) {
    const section = scanHeadingSections(state.doc).find((s) => s.pos === headingPos);
    const head = state.selection.head;
    const inside = section?.owned.some((o) => head > o.pos && head < o.pos + o.node.nodeSize);
    if (inside) {
      // End of the heading's own text: the nearest visible place that still
      // reads as "where I was".
      const at = Math.min(headingPos + node.nodeSize - 1, tr.doc.content.size);
      tr.setSelection(Selection.near(tr.doc.resolve(at), -1));
    }
  }

  // Folding is a view state. Cmd-Z must not undo it — the same rule the
  // toggle's `open` attribute follows, for the same reason: an undo stack
  // full of "I collapsed a section" makes undo useless for real edits.
  tr.setMeta("addToHistory", false);
  tr.setMeta(headingFoldKey, true);
  view.dispatch(tr);
  return true;
}

/**
 * The heading the caret is "in" for folding purposes: the heading itself if
 * the selection is inside one, otherwise the heading that OWNS the block the
 * selection is in. Without the second case, Cmd-Alt-. would do nothing for the
 * far commoner situation of standing in a paragraph under a heading.
 */
export function headingForSelection(doc: PMNode, pos: number): number | null {
  const sections = scanHeadingSections(doc);
  for (const s of sections) {
    if (pos > s.pos && pos < s.pos + s.node.nodeSize) return s.pos;
  }
  // Innermost wins — a heading inside a column should beat the doc-level
  // heading whose region happens to span the whole row.
  let best: HeadingSection | null = null;
  for (const s of sections) {
    for (const o of s.owned) {
      if (pos >= o.pos && pos <= o.pos + o.node.nodeSize) {
        if (!best || s.pos > best.pos) best = s;
        break;
      }
    }
  }
  return best ? best.pos : null;
}

export function toggleFoldAtSelection(view: EditorView): boolean {
  const at = headingForSelection(view.state.doc, view.state.selection.head);
  if (at == null) return false;
  return toggleHeadingFoldAt(view, at);
}

/** Fold or unfold every foldable heading at once. */
export function setAllHeadingFolds(view: EditorView, collapsed: boolean): boolean {
  const sections = scanHeadingSections(view.state.doc).filter(
    (s) => s.owned.length > 0 && s.collapsed !== collapsed
  );
  if (!sections.length) return false;
  const tr = view.state.tr;
  for (const s of sections) tr.setNodeAttribute(s.pos, "collapsed", collapsed);
  if (collapsed) {
    // Any of those regions could hold the caret. Rather than work out which,
    // park it at the top — the alternative is typing into a hidden block.
    tr.setSelection(Selection.atStart(tr.doc));
  }
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
  return true;
}

export const FoldableHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: {
        default: false,
        // Not `keepOnSplit` — pressing Enter at the end of a collapsed heading
        // should not produce a second collapsed heading.
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute("data-collapsed") === "true",
        renderHTML: (attrs) => (attrs.collapsed ? { "data-collapsed": "true" } : {}),
      },
      // A distinct display style — bigger, its own typeface — for a document's
      // own title, layered on top of whatever level (1-4) the heading already
      // is rather than a fifth level: it needs no outline/fold changes, and an
      // older client that doesn't know the attribute just renders a plain
      // heading of that level instead of blanking the note.
      title: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute("data-title") === "true",
        renderHTML: (attrs) => (attrs.title ? { "data-title": "true" } : {}),
      },
    };
  },

  addKeyboardShortcuts() {
    const toggle = () => toggleFoldAtSelection(this.editor.view);
    return {
      ...this.parent?.(),
      // Matches the fold bindings in every code editor people already use.
      "Mod-Alt-.": toggle,
      "Mod-Alt-,": toggle,
    };
  },

  addProseMirrorPlugins() {
    const parent = this.parent?.() ?? [];
    return [
      ...parent,
      new Plugin({
        key: headingFoldKey,
        state: {
          init: (_c, state) => buildDecorations(state.doc),
          apply(tr, value, _old, newState) {
            // Selection-only transactions are the common case (every arrow
            // key), and rescanning the document for each of them would put a
            // full descendants() walk on the keypress path.
            if (!tr.docChanged) return value.map(tr.mapping, tr.doc);
            return buildDecorations(newState.doc);
          },
        },
        props: {
          decorations(state) {
            return headingFoldKey.getState(state);
          },
        },
      }),
    ];
  },
});
