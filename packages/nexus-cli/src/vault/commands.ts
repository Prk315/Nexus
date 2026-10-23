// `nexus vault ...` — Vault folders and notes.
//
// Reads render the graph and note content; writes are limited to folders,
// note nodes, and note BODIES, with three refusals that exist to protect data
// other clients hold:
//   - a node with team_id set is shared and may be CRDT co-edited; overwriting
//     vault_content there loses edits the projection has not caught up with
//   - legacy HTML content is only replaced with --force (the app would parse
//     it as HTML; we cannot round-trip it, so the user opts in)
//   - updated_at is read before converting and re-checked right before the
//     upsert, so a save from the app in between aborts this write (exit 1)

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { UserError } from "../errors.ts";
import { fmtDate, header, printJson, table } from "../output.ts";
import type { VaultApi } from "./api.ts";
import { auditWritable, envelope, parseNoteContent, type JsonNode } from "./content.ts";
import { flattenTree, isFolder, kindName, renderTree, resolveNode, roots, searchNodes, tree, type TreeRow } from "./graph.ts";
import { fromMarkdown, toMarkdown } from "./markdown.ts";

export interface Who {
  profileName: string;
  email: string;
  userId: string;
}

export interface VaultSession {
  api: VaultApi;
  who: Who;
}

export interface VaultDeps {
  open(profileName: string | undefined): Promise<VaultSession>;
  /** Injectable for tests; defaults to stdin. */
  readStdin?(): Promise<string>;
}

type Opts = { profile?: string; json?: boolean };

const write = (s: string) => process.stdout.write(s + "\n");
const warn = (s: string) => process.stderr.write(s + "\n");

/** The app's own cap (lib/api.ts MAX_CONTENT_BYTES); a bigger save once wedged the database. */
const MAX_CONTENT_CHARS = 2_000_000;

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true; // no row before, no row now
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(id: string): string {
  if (!UUID_RE.test(id)) throw new UserError(`"${id}" is not a node id (uuid); use \`nexus vault search\` to find one`);
  return id;
}

/** Legacy HTML → paragraphs of plain text, for --force on an HTML note. Formatting is lost and said so. */
export function htmlToBlocks(html: string): JsonNode[] {
  const decode = (s: string) =>
    s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return html
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/pre)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => decode(l).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }));
}

async function loadMarkdownSource(o: { md?: string; stdin?: boolean }, deps: VaultDeps): Promise<string> {
  if (o.md && o.stdin) throw new UserError("pass either --md <file> or --stdin, not both");
  if (o.md) {
    try {
      return fs.readFileSync(o.md, "utf8");
    } catch (e: any) {
      throw new UserError(`cannot read ${o.md}: ${e?.message ?? e}`);
    }
  }
  if (o.stdin) return (deps.readStdin ?? readAllStdin)();
  throw new UserError("pass --md <file> or --stdin");
}

/**
 * The shared write path for `note set` and `note append`. Returns what was
 * written so the command can report it.
 */
export async function writeNote(
  s: VaultSession,
  id: string,
  markdown: string,
  mode: "set" | "append",
  force: boolean,
): Promise<{ id: string; name: string; updated_at: string; warnings: string[]; blocks: number }> {
  const node = await s.api.getNode(id);
  if (!node) throw new UserError(`node ${id} not found`);
  if (node.team_id != null) {
    throw new UserError(`refusing to write note ${id} "${node.name}": it is shared (team_id ${node.team_id}) and may be co-edited; edit it in Vault`);
  }
  if (node.kind?.type === "Folder") throw new UserError(`node ${id} "${node.name}" is a folder, not a note`);

  const before = await s.api.readContent(id);
  const shape = parseNoteContent(before?.data);
  const warnings: string[] = [];

  if (shape.kind === "html") {
    if (!force) {
      throw new UserError(`refusing to overwrite note ${id} "${node.name}": its content is legacy HTML, which cannot be round-tripped; re-run with --force to replace it`);
    }
    warnings.push("existing content was legacy HTML; it has been replaced (set) or flattened to plain paragraphs (append)");
  }

  const converted = fromMarkdown(markdown);
  warnings.push(...converted.warnings);

  let doc: JsonNode;
  if (mode === "set") {
    doc = converted.doc;
  } else {
    const existing: JsonNode[] =
      shape.kind === "json" ? (shape.doc.content ?? []) : shape.kind === "html" ? htmlToBlocks(shape.html) : [];
    // Drop the placeholder empty paragraph an empty note carries, so an append
    // to an empty note does not start with a blank line.
    const base = existing.length === 1 && existing[0].type === "paragraph" && !existing[0].content ? [] : existing;
    doc = { type: "doc", content: [...base, ...(converted.doc.content ?? [])] };
  }

  // Belt and braces: fromMarkdown only emits writable types, and an existing
  // doc we append to may hold anything the app wrote — that is allowed, since
  // those types came from the app and go back to it unchanged. Only the NEW
  // blocks are audited.
  const audit = auditWritable(converted.doc);
  if (audit.nodes.length || audit.marks.length) {
    throw new Error(`internal: converter emitted unwritable types ${[...audit.nodes, ...audit.marks].join(", ")}`);
  }

  const payload = envelope(doc);
  if (payload.length > MAX_CONTENT_CHARS) {
    throw new UserError(`note would be ${(payload.length / 1_000_000).toFixed(2)} MB; the cap is ${MAX_CONTENT_CHARS / 1_000_000} MB`);
  }

  // Conflict check: the row must not have moved since we read it.
  const nowStamp = await s.api.contentUpdatedAt(id);
  if (!sameInstant(before?.updated_at ?? null, nowStamp)) {
    throw new UserError(`note ${id} changed while preparing the write (updated_at ${before?.updated_at ?? "none"} → ${nowStamp ?? "none"}); re-read and retry`);
  }

  const { updated_at } = await s.api.writeContent(id, payload);
  return { id, name: node.name, updated_at, warnings, blocks: converted.doc.content?.length ?? 0 };
}

export function registerVaultCommands(root: Command, deps: VaultDeps): void {
  const vault = root.command("vault").description("Vault: folders and notes");

  vault.command("tree")
    .description("the folder tree (roots = nodes with no incoming edge)")
    .option("--root <idOrName>", "start at this node instead of every root")
    .option("--tags", "show tags")
    .option("--depth <n>", "levels below the root to show", "4")
    .option("--folders", "folders only")
    .action(async (o: { root?: string; tags?: boolean; depth: string; folders?: boolean }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      const depth = Number(o.depth);
      if (!Number.isInteger(depth) || depth < 0) throw new UserError(`--depth expects a non-negative integer, got "${o.depth}"`);
      const s = await deps.open(profile);
      const g = await s.api.loadGraph();
      let startIds: string[];
      if (o.root) {
        const r = resolveNode(g, o.root);
        if ("error" in r) throw new UserError(r.error);
        startIds = [r.node.id];
      } else {
        startIds = roots(g).filter((n) => !o.folders || isFolder(n)).map((n) => n.id);
      }
      const trees: TreeRow[] = startIds.map((id) => tree(g, id, depth, !!o.folders));
      if (json) return printJson({ profile: s.who.profileName, user_id: s.who.userId, depth, roots: trees });
      const total = trees.reduce((n, t) => n + flattenTree(t).length, 0);
      write(header(s.who.profileName, s.who.email, `vault tree — ${trees.length} root${trees.length === 1 ? "" : "s"}, ${total} nodes shown, depth ${depth}`));
      for (const t of trees) write(renderTree(t, !!o.tags));
    });

  vault.command("node <id>")
    .description("one node: name, kind, tags, parents, children")
    .action(async (id: string, _o, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      const s = await deps.open(profile);
      const g = await s.api.loadGraph();
      const r = resolveNode(g, id);
      if ("error" in r) throw new UserError(r.error);
      const n = r.node;
      const parents = (g.parents[n.id] ?? []).map((p) => ({ id: p, name: g.nodes[p].name }));
      const children = (g.children[n.id] ?? []).map((c) => ({ id: c, name: g.nodes[c].name, kind: kindName(g.nodes[c]) }));
      const out = { id: n.id, name: n.name, kind: n.kind, tags: n.tags, team_id: n.team_id, user_id: n.user_id, parents, children };
      if (json) return printJson({ profile: s.who.profileName, node: out });
      write(header(s.who.profileName, s.who.email, `node ${n.id}`));
      write(`name:     ${n.name}`);
      write(`kind:     ${kindName(n)}${Object.keys(n.kind).length > 1 ? " " + JSON.stringify(n.kind) : ""}`);
      write(`tags:     ${n.tags.length ? n.tags.join(", ") : "-"}`);
      write(`shared:   ${n.team_id ? `yes (team ${n.team_id})` : "no"}`);
      write(`owner:    ${n.user_id}`);
      write(`parents:  ${parents.length ? parents.map((p) => `${p.name} (${p.id})`).join(", ") : "- (root)"}`);
      write(`children: ${children.length}`);
      if (children.length) write(table([{ key: "id", label: "id" }, { key: "kind", label: "kind" }, { key: "name", label: "name", max: 60 }], children));
    });

  const note = vault.command("note").description("read and write note bodies");

  note.command("show <id>", { isDefault: true })
    .description("dump a note as Markdown (the default: `nexus vault note <id>`)")
    .option("--raw", "print the stored string exactly as-is")
    .action(async (id: string, o: { raw?: boolean }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      requireId(id);
      const s = await deps.open(profile);
      const node = await s.api.getNode(id);
      if (!node) throw new UserError(`node ${id} not found`);
      const row = await s.api.readContent(id);
      const raw = row?.data ?? "";
      if (o.raw && !json) {
        process.stdout.write(raw + (raw.endsWith("\n") ? "" : "\n"));
        return;
      }
      const shape = parseNoteContent(raw);
      const markdown = shape.kind === "json" ? toMarkdown(shape.doc) : shape.kind === "html" ? shape.html : "";
      if (json) {
        return printJson({
          profile: s.who.profileName, id, name: node.name, kind: node.kind?.type, team_id: node.team_id,
          shape: shape.kind, enveloped: shape.kind === "json" ? shape.enveloped : false,
          updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null,
          markdown, ...(o.raw ? { raw } : {}), ...(shape.kind === "json" ? { doc: shape.doc } : {}),
        });
      }
      // The header goes to stderr here so stdout is the note and nothing else —
      // `nexus vault note <id> > file.md` must give a clean file.
      warn(header(s.who.profileName, s.who.email, `${node.name} (${id}) ${shape.kind}${row?.updated_at ? `, updated ${fmtDate(row.updated_at)}` : ""}`));
      if (shape.kind === "html") warn("note: legacy HTML content, printed as stored");
      process.stdout.write(markdown);
    });

  note.command("set <id>")
    .description("replace a note's body with Markdown from --md <file> or --stdin")
    .option("--md <file>", "Markdown file to read")
    .option("--stdin", "read Markdown from stdin")
    .option("--force", "replace legacy HTML content")
    .action(async (id: string, o: { md?: string; stdin?: boolean; force?: boolean }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      requireId(id);
      const src = await loadMarkdownSource(o, deps);
      const s = await deps.open(profile);
      const r = await writeNote(s, id, src, "set", !!o.force);
      for (const w of r.warnings) warn(`warning: ${w}`);
      if (json) return printJson({ profile: s.who.profileName, ...r });
      write(header(s.who.profileName, s.who.email, `wrote ${r.blocks} blocks to "${r.name}" (${id}), updated ${fmtDate(r.updated_at)}`));
    });

  note.command("append <id>")
    .description("append Markdown blocks to a note (--md <file> or --stdin)")
    .option("--md <file>", "Markdown file to read")
    .option("--stdin", "read Markdown from stdin")
    .option("--force", "append to legacy HTML content (it is flattened to plain paragraphs first)")
    .action(async (id: string, o: { md?: string; stdin?: boolean; force?: boolean }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      requireId(id);
      const src = await loadMarkdownSource(o, deps);
      const s = await deps.open(profile);
      const r = await writeNote(s, id, src, "append", !!o.force);
      for (const w of r.warnings) warn(`warning: ${w}`);
      if (json) return printJson({ profile: s.who.profileName, ...r });
      write(header(s.who.profileName, s.who.email, `appended ${r.blocks} blocks to "${r.name}" (${id}), updated ${fmtDate(r.updated_at)}`));
    });

  vault.command("search <text>")
    .description("nodes whose name contains the text (case-insensitive)")
    .action(async (text: string, _o, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      const s = await deps.open(profile);
      const g = await s.api.loadGraph();
      const hits = searchNodes(g, text).map((n) => ({
        id: n.id, name: n.name, kind: kindName(n), tags: n.tags, team_id: n.team_id,
        parents: (g.parents[n.id] ?? []).map((p) => g.nodes[p].name),
      }));
      if (json) return printJson({ profile: s.who.profileName, query: text, count: hits.length, results: hits });
      write(header(s.who.profileName, s.who.email, `${hits.length} nodes matching "${text}"`));
      write(table([
        { key: "id", label: "id" }, { key: "kind", label: "kind" }, { key: "name", label: "name", max: 50 },
        { key: "parents", label: "in", max: 40 }, { key: "tags", label: "tags", max: 30 },
      ], hits));
    });

  const mk = (kind: "Folder" | "Note") => async (name: string, o: { parent?: string; tag?: string[] }, cmd: Command) => {
    const { profile, json } = cmd.optsWithGlobals<Opts>();
    if (!name.trim()) throw new UserError("name must not be empty");
    if (o.parent) requireId(o.parent);
    const s = await deps.open(profile);
    if (o.parent) {
      const parent = await s.api.getNode(o.parent);
      if (!parent) throw new UserError(`parent ${o.parent} not found`);
    }
    const id = randomUUID();
    const tags = (o.tag ?? []).map((t) => t.trim()).filter(Boolean);
    await s.api.createNode(id, name.trim(), { type: kind }, tags);
    if (o.parent) await s.api.addEdge(o.parent, id);
    const out = { id, name: name.trim(), kind, tags, parent: o.parent ?? null };
    if (json) return printJson({ profile: s.who.profileName, created: out });
    write(header(s.who.profileName, s.who.email, `created ${kind.toLowerCase()} "${out.name}" ${id}${o.parent ? ` under ${o.parent}` : " (root)"}`));
  };

  vault.command("mkdir <name>")
    .description("create a folder")
    .option("--parent <id>", "parent node id")
    .option("--tag <tag...>", "tags")
    .action(mk("Folder"));

  vault.command("mknote <name>")
    .description("create an empty note (then `nexus vault note set <id> --md file.md`)")
    .option("--parent <id>", "parent node id")
    .option("--tag <tag...>", "tags")
    .action(mk("Note"));

  vault.command("rm <id>")
    .description("delete a node, its edges and its content rows. Requires --yes")
    .option("--yes", "confirm the deletion")
    .action(async (id: string, o: { yes?: boolean }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      requireId(id);
      if (!o.yes) throw new UserError(`refusing to delete ${id} without --yes`);
      const s = await deps.open(profile);
      const node = await s.api.getNode(id);
      if (!node) throw new UserError(`node ${id} not found`);
      if (node.user_id !== s.who.userId) throw new UserError(`node ${id} "${node.name}" is owned by ${node.user_id}, not this profile`);
      const g = await s.api.loadGraph();
      const kids = g.children[id] ?? [];
      if (kids.length) {
        warn(`note: ${kids.length} child node${kids.length === 1 ? "" : "s"} lose this parent edge but are NOT deleted: ${kids.join(", ")}`);
      }
      await s.api.deleteNode(id);
      if (json) return printJson({ profile: s.who.profileName, deleted: id, name: node.name, kind: node.kind?.type, orphaned_children: kids });
      write(header(s.who.profileName, s.who.email, `deleted ${node.kind?.type?.toLowerCase() ?? "node"} "${node.name}" ${id}`));
    });
}
