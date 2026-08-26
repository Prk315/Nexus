import { describe, it, expect } from "vitest";
import { Extension, getSchema } from "@tiptap/core";
import { buildNoteExtensions, noteSchema } from "./noteExtensions";

// Stand-ins for Collaboration and CollaborationCaret. Both real extensions
// contribute only ProseMirror plugins, commands and keymaps — no nodes, no
// marks — so a plugin-only fake is a faithful model for the one property that
// matters here, and it keeps the yjs stack out of the test.
const FakeCollab = Extension.create({
  name: "fakeCollaboration",
  addProseMirrorPlugins: () => [],
});
const FakeCaret = Extension.create({
  name: "fakeCollaborationCaret",
  addProseMirrorPlugins: () => [],
});

describe("buildNoteExtensions with collaboration", () => {
  // The claim the whole noteSchemaGuard design rests on once collaboration
  // exists. `noteSchema()` is built with NO options and is what stored content
  // gets audited against before an editor is allowed to mount; a live
  // collaborative editor runs the list WITH options. If those two schemas ever
  // diverge, the guard is validating against a schema the editor doesn't have —
  // which is precisely the failure noteExtensions.ts's header exists to
  // prevent, and it fails silently.
  it("does not change the schema", () => {
    const collabSchema = getSchema(buildNoteExtensions({ collab: [FakeCollab, FakeCaret] }));
    const plain = noteSchema();

    expect(Object.keys(collabSchema.nodes).sort()).toEqual(Object.keys(plain.nodes).sort());
    expect(Object.keys(collabSchema.marks).sort()).toEqual(Object.keys(plain.marks).sort());
    expect(collabSchema.topNodeType.name).toBe(plain.topNodeType.name);
  });

  it("keeps the doc node's own attributes, including the per-note width", () => {
    const collabSchema = getSchema(buildNoteExtensions({ collab: [FakeCollab, FakeCaret] }));
    expect(Object.keys(collabSchema.topNodeType.spec.attrs ?? {})).toContain("width");
  });

  // Collaboration ships its own Y.UndoManager and its own Mod-z keymap at
  // priority 1000. Leaving StarterKit's undoRedo registered alongside it gives
  // two undo stacks competing for one shortcut, and the local one would happily
  // undo the other person's sentence. The two are fused into a single option
  // for exactly this reason — pin that they stay fused.
  // Note undoRedo is a StarterKit OPTION, not a top-level extension — it never
  // appears in the returned list under either name, so assert the option.
  const starterKit = (exts: ReturnType<typeof buildNoteExtensions>) =>
    exts.find((e: any) => e.name === "starterKit") as any;

  it("disables StarterKit's undoRedo when collaboration is on", () => {
    expect(starterKit(buildNoteExtensions({ collab: [FakeCollab, FakeCaret] })).options.undoRedo).toBe(false);
  });

  it("leaves undoRedo at StarterKit's default for a private note", () => {
    expect(starterKit(buildNoteExtensions()).options.undoRedo).not.toBe(false);
  });

  it("appends the collaboration extensions", () => {
    const names = buildNoteExtensions({ collab: [FakeCollab, FakeCaret] }).map((e: any) => e.name);
    expect(names).toContain("fakeCollaboration");
    expect(names).toContain("fakeCollaborationCaret");
  });

  it("adds nothing at all when no session is supplied", () => {
    const withCollab = buildNoteExtensions({ collab: [FakeCollab, FakeCaret] }).length;
    const without = buildNoteExtensions().length;
    expect(withCollab).toBe(without + 2);
  });
});
