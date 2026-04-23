import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

export interface CommandItem {
  title: string;
  icon: string;
  command: (props: { editor: any; range: any }) => void;
}

export interface SlashMenuState {
  items: CommandItem[];
  command: (item: CommandItem) => void;
  rect: DOMRect;
}

const COMMANDS: CommandItem[] = [
  {
    title: "Heading 1",
    icon: "H1",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    icon: "H2",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    icon: "H3",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet List",
    icon: "•",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    icon: "1.",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Quote",
    icon: "❝",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    title: "Code Block",
    icon: "<>",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    title: "Divider",
    icon: "—",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "Math Block",
    icon: "∑",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent("$$\\text{expression}$$").run(),
  },
  {
    title: "Table",
    icon: "⊞",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

export function createSlashCommandsExtension(
  setMenu: (state: SlashMenuState | null) => void,
  getKeyHandler: () => ((event: KeyboardEvent) => boolean) | null
) {
  return Extension.create({
    name: "slashCommands",

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          items: ({ query }) =>
            COMMANDS.filter((c) =>
              c.title.toLowerCase().includes(query.toLowerCase())
            ),
          command: ({ editor, range, props }) => {
            (props as CommandItem).command({ editor, range });
          },
          render: () => ({
            onStart: (props) => {
              setMenu({
                items: props.items as CommandItem[],
                command: props.command as (item: CommandItem) => void,
                rect: props.clientRect?.() as DOMRect,
              });
            },
            onUpdate: (props) => {
              setMenu({
                items: props.items as CommandItem[],
                command: props.command as (item: CommandItem) => void,
                rect: props.clientRect?.() as DOMRect,
              });
            },
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                setMenu(null);
                return true;
              }
              return getKeyHandler()?.(event) ?? false;
            },
            onExit: () => setMenu(null),
          }),
        }),
      ];
    },
  });
}
