// Factory for the structural block family.
//
// Callout, container, toggle and columns are four features but one shape: a
// block that holds other blocks, is isolating, needs the same three keyboard
// rescues, and serializes as a div carrying `data-type`. Writing them as four
// independent Node.create() calls would mean four copies of the keymap and
// four chances to get `isolating`/`defining` subtly different.

import { Node, mergeAttributes, type Attribute } from "@tiptap/core";
import { readSpacing, spacingPx } from "../../lib/blockSize";

/** Inline style for a container's spacing, or nothing when it is unset. */
function spacingStyle(attrs: Record<string, any>): string | undefined {
  const parts: string[] = [];
  if (attrs.pad != null) parts.push(`padding-block:${spacingPx(attrs.pad)}px`);
  if (attrs.gap != null) parts.push(`margin-block:${spacingPx(attrs.gap)}px`);
  return parts.length ? parts.join(";") : undefined;
}
import {
  backspaceAtContainerStart,
  enterAtContainerEnd,
  escapeContainer,
} from "./containerCommands";

export interface ContainerNodeSpec {
  name: string;
  /** ProseMirror content expression, e.g. "block+". */
  content: string;
  /** `data-type` in the serialized HTML, and the parse hook. */
  dataType: string;
  tag?: string;
  group?: string;
  attrs?: Record<string, Attribute>;
  /** Extra classes derived from attributes. */
  className?: (attrs: Record<string, any>) => string | undefined;
  /** Extra HTML attributes derived from node attributes. */
  extraHTML?: (attrs: Record<string, any>) => Record<string, any>;
  /**
   * Node-specific keys, merged BEFORE the shared ones so they get first
   * refusal. Each must return false when it doesn't apply, or the generic
   * unwrap/escape behaviour below becomes unreachable.
   */
  keyboard?: (ctx: { editor: any; name: string }) => Record<string, () => boolean>;
  /** A React node view, for the rare container that needs one. */
  nodeView?: () => any;
}

export function createContainerNode(spec: ContainerNodeSpec) {
  const tag = spec.tag ?? "div";

  return Node.create({
    name: spec.name,
    group: spec.group ?? "block",
    content: spec.content,

    // Above StarterKit's default 100, and this is not cosmetic. Tiptap sorts
    // extensions by priority descending and collects their keymap plugins in
    // that order, so at the default StarterKit's baseKeymap sees Backspace
    // first, `joinBackward` returns true, and the handlers below never run —
    // the container silently merges into the preceding paragraph instead of
    // unwrapping. Verified: with priority 100 the callout's text was absorbed
    // into the paragraph above it.
    priority: 1000,

    // The single most important flag on this family. It stops Backspace at the
    // start joining the container into whatever precedes it, and stops a
    // selection from crossing half in — which is what would otherwise let
    // applyCategory() file a vault_records row spanning two unrelated blocks.
    isolating: true,

    // So pasting a paragraph into an empty container replaces the paragraph
    // rather than replacing the container.
    defining: true,

    addAttributes() {
      // `shareId` is on EVERY member of the family, not on a new node type, and
      // that is the load-bearing decision behind shared blocks.
      //
      // ⚠️ ProseMirror drops an attribute it does not know and BLANKS a document
      // whose node type it does not know. As an attribute, a note containing a
      // shared block opens correctly on a Mac or iPad build that predates the
      // feature — the block is simply not synced there, because its content is
      // also stored in the note. As a `sharedBlock` node type it would have
      // wiped the note. That is the whole difference between shipping this
      // today and having to deploy every client first.
      return {
        /**
         * Inner and outer spacing, as a STEP on a short scale — see
         * lib/blockSize. Attributes, so an older build drops them and renders
         * the block at its stylesheet default rather than blanking anything.
         *
         * ⚠️ `null`, not `0`. Zero is a deliberate "no spacing at all", which a
         * user can choose; null is "never set", which follows the stylesheet.
         * Collapsing the two would make opening a note rewrite every container
         * that had never been adjusted.
         */
        pad: {
          default: null as number | null,
          parseHTML: (el: HTMLElement) => readSpacing(el.getAttribute("data-pad")),
          renderHTML: (attrs: Record<string, any>) =>
            attrs.pad == null ? {} : { "data-pad": String(attrs.pad) },
        },
        gap: {
          default: null as number | null,
          parseHTML: (el: HTMLElement) => readSpacing(el.getAttribute("data-gap")),
          renderHTML: (attrs: Record<string, any>) =>
            attrs.gap == null ? {} : { "data-gap": String(attrs.gap) },
        },
        shareId: {
          default: null as string | null,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-share") || null,
          renderHTML: (attrs: Record<string, any>) =>
            attrs.shareId ? { "data-share": attrs.shareId } : {},
        },
        ...(spec.attrs ?? {}),
      };
    },

    parseHTML() {
      // Priority above the default 50 so a generic rule for a sibling
      // container type can't shadow this more specific one.
      return [{ tag: `${tag}[data-type="${spec.dataType}"]`, priority: 60 }];
    },

    renderHTML({ HTMLAttributes, node }) {
      return [
        tag,
        mergeAttributes(HTMLAttributes, spec.extraHTML?.(node.attrs) ?? {}, {
          "data-type": spec.dataType,
          class: [spec.className?.(node.attrs), node.attrs.shareId ? "is-shared" : null]
            .filter(Boolean)
            .join(" ") || undefined,
          // Resolved here rather than in CSS: the step scale lives in one
          // module, and a stylesheet cannot read it.
          style: spacingStyle(node.attrs),
        }),
        0,
      ];
    },

    addKeyboardShortcuts() {
      const names = [this.name];
      const editor = this.editor;

      // These commands build their own transaction from `state.tr`, so they
      // dispatch to the view directly rather than going through Tiptap's
      // `command()`, which hands you a `tr` it expects you to mutate.
      const run =
        (cmd: (p: { state: any; dispatch: any }) => boolean) =>
        () =>
          cmd({
            state: editor.state,
            dispatch: (tr: any) => editor.view.dispatch(tr),
          });

      const shared: Record<string, () => boolean> = {
        // Each returns false when the caret isn't in this container, so the
        // rest of the keymap (lists, tables, StarterKit) still gets its turn.
        Backspace: run(backspaceAtContainerStart(names)),
        Enter: run(enterAtContainerEnd(names)),
        "Mod-Enter": run(escapeContainer(names)),
      };

      const own = spec.keyboard?.({ editor, name: this.name }) ?? {};

      // Node-specific handler first, shared one as the fallback — so a toggle
      // can claim Enter-inside-the-summary while still inheriting
      // Enter-on-an-empty-trailing-paragraph.
      const merged: Record<string, () => boolean> = { ...shared };
      for (const [key, handler] of Object.entries(own)) {
        const fallback = shared[key];
        merged[key] = fallback ? () => handler() || fallback() : handler;
      }
      return merged;
    },

    ...(spec.nodeView ? { addNodeView: () => spec.nodeView!() } : {}),
  });
}
