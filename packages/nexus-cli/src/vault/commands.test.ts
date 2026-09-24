// Phase 3: the note write path against a MOCKED VaultApi. Covers the three
// refusals (shared note, legacy HTML, conflict) and what actually lands in
// vault_content for set and append.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type { VaultApi } from "./api.ts";
import { htmlToBlocks, registerVaultCommands, writeNote, type VaultSession } from "./commands.ts";
import { envelope, type JsonNode } from "./content.ts";
import { UserError } from "../errors.ts";

const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const doc = (...content: JsonNode[]): JsonNode => ({ type: "doc", content });
const para = (text: string): JsonNode => ({ type: "paragraph", content: [{ type: "text", text }] });

interface Store {
  node: { id: string; name: string; kind: { type: string }; team_id: string | null; user_id: string } | null;
  content: { data: string; updated_at: string | null; updated_by: string | null } | null;
  /** What `contentUpdatedAt` returns on the re-check; defaults to the stored value. */
  recheck?: string | null;
}

function mockApi(store: Store): VaultApi {
  return {
    loadGraph: vi.fn(async () => ({ nodes: {}, children: {}, parents: {} })),
    getNode: vi.fn(async (id: string) => (store.node && store.node.id === id ? store.node : null)),
    readContent: vi.fn(async () => store.content),
    contentUpdatedAt: vi.fn(async () => (store.recheck !== undefined ? store.recheck : store.content?.updated_at ?? null)),
    writeContent: vi.fn(async (_id: string, data: string) => {
      store.content = { data, updated_at: "2026-09-24T12:00:00+00:00", updated_by: "u" };
      return { updated_at: "2026-09-24T12:00:00+00:00" };
    }),
    createNode: vi.fn(async () => {}),
    addEdge: vi.fn(async () => {}),
    deleteNode: vi.fn(async () => {}),
  };
}

function session(store: Store): VaultSession {
  return { api: mockApi(store), who: { profileName: "dev", email: "dev@example.com", userId: "uid-dev" } };
}

const noteNode = (team_id: string | null = null) => ({ id: NOTE_ID, name: "Week 1", kind: { type: "Note" }, team_id, user_id: "uid-dev" });

let out: string[];
let err: string[];
beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => { out.push(String(s)); return true; }) as any);
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { err.push(String(s)); return true; }) as any);
});
afterEach(() => vi.restoreAllMocks());

describe("writeNote", () => {
  it("set writes an enveloped doc and stamps nothing but node_id/data", async () => {
    const store: Store = { node: noteNode(), content: { data: JSON.stringify(doc(para("old"))), updated_at: "2026-09-24T10:00:00+00:00", updated_by: null } };
    const s = session(store);
    const r = await writeNote(s, NOTE_ID, "# Title\n\nbody\n", "set", false);
    expect(s.api.writeContent).toHaveBeenCalledTimes(1);
    const [, data] = (s.api.writeContent as any).mock.calls[0];
    expect(JSON.parse(data)).toEqual({
      __vault: 1,
      doc: doc({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }, para("body")),
    });
    expect(r).toMatchObject({ id: NOTE_ID, name: "Week 1", blocks: 2, warnings: [] });
  });

  it("append keeps the existing blocks (including types the CLI does not write) and adds the new ones", async () => {
    const callout: JsonNode = { type: "calloutBlock", attrs: { variant: "warn" }, content: [para("careful")] };
    const store: Store = { node: noteNode(), content: { data: envelope(doc(para("old"), callout)), updated_at: "2026-09-24T10:00:00+00:00", updated_by: null } };
    const s = session(store);
    await writeNote(s, NOTE_ID, "new\n", "append", false);
    const [, data] = (s.api.writeContent as any).mock.calls[0];
    expect(JSON.parse(data).doc).toEqual(doc(para("old"), callout, para("new")));
  });

  it("append to an empty note does not keep the placeholder paragraph", async () => {
    const store: Store = { node: noteNode(), content: { data: JSON.stringify(doc({ type: "paragraph" })), updated_at: "2026-09-24T10:00:00+00:00", updated_by: null } };
    const s = session(store);
    await writeNote(s, NOTE_ID, "new\n", "append", false);
    const [, data] = (s.api.writeContent as any).mock.calls[0];
    expect(JSON.parse(data).doc).toEqual(doc(para("new")));
  });

  it("writes a note that has no content row yet", async () => {
    const store: Store = { node: noteNode(), content: null };
    const s = session(store);
    await writeNote(s, NOTE_ID, "first\n", "set", false);
    expect(s.api.writeContent).toHaveBeenCalled();
  });

  it("refuses a shared note (team_id set)", async () => {
    const s = session({ node: noteNode("team-1"), content: null });
    await expect(writeNote(s, NOTE_ID, "x", "set", true)).rejects.toThrow(/shared \(team_id team-1\)/);
    expect(s.api.writeContent).not.toHaveBeenCalled();
  });

  it("refuses a missing node and a folder", async () => {
    await expect(writeNote(session({ node: null, content: null }), NOTE_ID, "x", "set", false)).rejects.toThrow(/not found/);
    const folder = { id: FOLDER_ID, name: "UNI", kind: { type: "Folder" }, team_id: null, user_id: "uid-dev" };
    await expect(writeNote(session({ node: folder, content: null }), FOLDER_ID, "x", "set", false)).rejects.toThrow(/is a folder/);
  });

  it("refuses legacy HTML without --force and replaces it with --force", async () => {
    const store: Store = { node: noteNode(), content: { data: "<p>legacy <b>bold</b></p><p>two</p>", updated_at: "2026-09-24T10:00:00+00:00", updated_by: null } };
    let s = session(store);
    await expect(writeNote(s, NOTE_ID, "x", "set", false)).rejects.toThrow(/legacy HTML.*--force/);
    expect(s.api.writeContent).not.toHaveBeenCalled();

    s = session(store);
    const r = await writeNote(s, NOTE_ID, "x\n", "set", true);
    expect(r.warnings.some((w) => w.includes("legacy HTML"))).toBe(true);
    const [, data] = (s.api.writeContent as any).mock.calls[0];
    expect(JSON.parse(data).doc).toEqual(doc(para("x")));
  });

  it("append --force on HTML flattens the HTML to paragraphs first", async () => {
    const store: Store = { node: noteNode(), content: { data: "<p>legacy <b>bold</b></p><p>two &amp; three</p>", updated_at: "2026-09-24T10:00:00+00:00", updated_by: null } };
    const s = session(store);
    await writeNote(s, NOTE_ID, "new\n", "append", true);
    const [, data] = (s.api.writeContent as any).mock.calls[0];
    expect(JSON.parse(data).doc).toEqual(doc(para("legacy bold"), para("two & three"), para("new")));
  });

  it("aborts when updated_at moved between the read and the write", async () => {
    const store: Store = {
      node: noteNode(),
      content: { data: JSON.stringify(doc(para("old"))), updated_at: "2026-09-24T10:00:00+00:00", updated_by: null },
      recheck: "2026-09-24T10:00:05+00:00",
    };
    const s = session(store);
    await expect(writeNote(s, NOTE_ID, "x", "set", false)).rejects.toThrow(/changed while preparing the write/);
    expect(s.api.writeContent).not.toHaveBeenCalled();
  });

  it("treats the same instant spelled two ways as unchanged", async () => {
    const store: Store = {
      node: noteNode(),
      content: { data: JSON.stringify(doc(para("old"))), updated_at: "2026-09-24T10:00:00.000Z", updated_by: null },
      recheck: "2026-09-24T10:00:00+00:00",
    };
    const s = session(store);
    await writeNote(s, NOTE_ID, "x", "set", false);
    expect(s.api.writeContent).toHaveBeenCalled();
  });

  it("refuses to write a vault:<type> fence back", async () => {
    const s = session({ node: noteNode(), content: null });
    await expect(writeNote(s, NOTE_ID, "```vault:calloutBlock\n{}\n```\n", "set", false)).rejects.toThrow(UserError);
    expect(s.api.writeContent).not.toHaveBeenCalled();
  });
});

describe("htmlToBlocks", () => {
  it("splits on block tags, strips the rest, decodes entities", () => {
    expect(htmlToBlocks("<h1>T</h1><p>a<br>b</p><ul><li>x &lt; y</li></ul>")).toEqual([para("T"), para("a"), para("b"), para("x < y")]);
  });
});

describe("vault commands", () => {
  function program(store: Store, stdin = "") {
    const p = new Command().exitOverride().option("-p, --profile <name>").option("--json");
    const s = session(store);
    registerVaultCommands(p, { open: async () => s, readStdin: async () => stdin });
    return { p, s };
  }

  it("note set --stdin writes and reports", async () => {
    const { p, s } = program({ node: noteNode(), content: null }, "hello\n");
    await p.parseAsync(["vault", "note", "set", NOTE_ID, "--stdin", "--json"], { from: "user" });
    expect(s.api.writeContent).toHaveBeenCalled();
    expect(JSON.parse(out.join(""))).toMatchObject({ profile: "dev", id: NOTE_ID, blocks: 1 });
  });

  it("note set needs --md or --stdin, not both", async () => {
    const { p } = program({ node: noteNode(), content: null });
    await expect(p.parseAsync(["vault", "note", "set", NOTE_ID], { from: "user" })).rejects.toThrow(/--md <file> or --stdin/);
    await expect(p.parseAsync(["vault", "note", "set", NOTE_ID, "--md", "a.md", "--stdin"], { from: "user" })).rejects.toThrow(/not both/);
  });

  it("note show prints Markdown on stdout and the header on stderr", async () => {
    const { p } = program({ node: noteNode(), content: { data: envelope(doc(para("hi"))), updated_at: null, updated_by: null } });
    await p.parseAsync(["vault", "note", NOTE_ID], { from: "user" });
    expect(out.join("")).toBe("hi\n");
    expect(err.join("")).toContain("[dev <dev@example.com>] Week 1");
  });

  it("note show --raw prints the stored string", async () => {
    const raw = envelope(doc(para("hi")));
    const { p } = program({ node: noteNode(), content: { data: raw, updated_at: null, updated_by: null } });
    await p.parseAsync(["vault", "note", NOTE_ID, "--raw"], { from: "user" });
    expect(out.join("")).toBe(raw + "\n");
  });

  it("mkdir creates a Folder and an edge under --parent", async () => {
    const parent = { id: FOLDER_ID, name: "UNI", kind: { type: "Folder" }, team_id: null, user_id: "uid-dev" };
    const { p, s } = program({ node: parent, content: null });
    await p.parseAsync(["vault", "mkdir", "New", "--parent", FOLDER_ID, "--tag", "math", "x", "--json"], { from: "user" });
    const [id, name, kind, tags] = (s.api.createNode as any).mock.calls[0];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect([name, kind, tags]).toEqual(["New", { type: "Folder" }, ["math", "x"]]);
    expect(s.api.addEdge).toHaveBeenCalledWith(FOLDER_ID, id);
    expect(JSON.parse(out.join("")).created).toMatchObject({ id, name: "New", kind: "Folder", parent: FOLDER_ID });
  });

  it("mknote creates a Note node", async () => {
    const { p, s } = program({ node: null, content: null });
    await p.parseAsync(["vault", "mknote", "Scratch"], { from: "user" });
    expect((s.api.createNode as any).mock.calls[0][2]).toEqual({ type: "Note" });
    expect(s.api.addEdge).not.toHaveBeenCalled();
  });

  it("rm refuses without --yes, refuses another owner's node, deletes with --yes", async () => {
    const { p, s } = program({ node: noteNode(), content: null });
    await expect(p.parseAsync(["vault", "rm", NOTE_ID], { from: "user" })).rejects.toThrow(/--yes/);
    expect(s.api.deleteNode).not.toHaveBeenCalled();

    const other = program({ node: { ...noteNode(), user_id: "someone-else" }, content: null });
    await expect(other.p.parseAsync(["vault", "rm", NOTE_ID, "--yes"], { from: "user" })).rejects.toThrow(/owned by someone-else/);

    await p.parseAsync(["vault", "rm", NOTE_ID, "--yes"], { from: "user" });
    expect(s.api.deleteNode).toHaveBeenCalledWith(NOTE_ID);
  });

  it("rejects a non-uuid id up front", async () => {
    const { p, s } = program({ node: noteNode(), content: null });
    await expect(p.parseAsync(["vault", "note", "not-an-id"], { from: "user" })).rejects.toThrow(/not a node id/);
    expect(s.api.getNode).not.toHaveBeenCalled();
  });
});
