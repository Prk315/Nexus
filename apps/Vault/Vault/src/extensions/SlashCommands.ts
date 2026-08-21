// The `/` menu. It owns no command list of its own any more — it renders
// whatever extensions/blockRegistry.ts declares for the "slash" surface.
//
// `getActions` is a getter, not an array, on purpose: the extension is created
// exactly once per editor (a new extension instance would rebuild the whole
// ProseMirror plugin stack), while the registry changes whenever the note's
// highlighter categories load or a Database ancestor appears. The getter lets
// one outlive the other.

import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { actionsFor, matchesQuery, type BlockAction } from "./blockRegistry";

export interface SlashMenuState {
  items: BlockAction[];
  command: (item: BlockAction) => void;
  rect: DOMRect;
}

export function createSlashCommandsExtension(
  getActions: () => BlockAction[],
  setMenu: (state: SlashMenuState | null) => void,
  getKeyHandler: () => ((event: KeyboardEvent) => boolean) | null
) {
  return Extension.create({
    name: "slashCommands",

    addProseMirrorPlugins() {
      const editor = this.editor;

      return [
        Suggestion<BlockAction>({
          editor,
          char: "/",
          items: ({ query }) =>
            actionsFor(getActions(), "slash")
              // Availability is evaluated against the live editor, so e.g.
              // "Table" disappears from the menu while the cursor is already
              // inside one instead of nesting a table in a cell.
              .filter((a) => (a.isAvailable?.(editor) ?? true) && matchesQuery(a, query)),

          command: ({ editor: ed, range, props }) => {
            (props as BlockAction).run(ed as Editor, { range: range as Range });
          },

          render: () => {
            const push = (props: any) =>
              setMenu({
                items: props.items as BlockAction[],
                command: props.command as (item: BlockAction) => void,
                rect: props.clientRect?.() as DOMRect,
              });

            return {
              onStart: push,
              onUpdate: push,
              onKeyDown: ({ event }) => {
                if (event.key === "Escape") {
                  setMenu(null);
                  return true;
                }
                return getKeyHandler()?.(event) ?? false;
              },
              onExit: () => setMenu(null),
            };
          },
        }),
      ];
    },
  });
}
