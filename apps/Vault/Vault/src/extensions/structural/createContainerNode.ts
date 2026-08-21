// Factory for the structural block family.
//
// Callout, container, toggle and columns are four features but one shape: a
// block that holds other blocks, is isolating, needs the same three keyboard
// rescues, and serializes as a div carrying `data-type`. Writing them as four
// independent Node.create() calls would mean four copies of the keymap and
// four chances to get `isolating`/`defining` subtly different.

import { Node, mergeAttributes, type Attribute } from "@tiptap/core";
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
      return spec.attrs ?? {};
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
          class: spec.className?.(node.attrs),
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

      return {
        // Each returns false when the caret isn't in this container, so the
        // rest of the keymap (lists, tables, StarterKit) still gets its turn.
        Backspace: run(backspaceAtContainerStart(names)),
        Enter: run(enterAtContainerEnd(names)),
        "Mod-Enter": run(escapeContainer(names)),
      };
    },
  });
}
