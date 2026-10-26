// Markdown <-> TipTap JSON, in both directions, for the subset of the Vault
// note schema this CLI is allowed to write.
//
// READING (`toMarkdown`) is best effort and must never lose content: the
// supported blocks render as Markdown; anything else renders as a fenced block
// tagged ```vault:<type> holding the node's JSON, so a reader can see exactly
// what is there. A few read-only extras that have an obvious textual form are
// also rendered (blockquote, horizontalRule, taskList) because a note full of
// JSON dumps for `- [ ]` items would be useless.
//
// WRITING (`fromMarkdown`) is strict about what it EMITS: only the node and
// mark types in content.ts WRITABLE_*. A Markdown construct with no
// representation is either flattened (blockquote) or kept as literal text, and
// every such case is reported in `warnings`. A ```vault:<type> fence is
// REFUSED rather than re-inflated: re-emitting an arbitrary type read from
// text is precisely how a typo blanks a note.

import { fromMarkdown as mdastFromMarkdown } from "mdast-util-from-markdown";
import type * as Md from "mdast";
import { UserError } from "../errors.ts";
import type { JsonNode } from "./content.ts";

// ── JSON → Markdown ──────────────────────────────────────────────────────────

/** Deepest heading the Vault note schema registers (FoldableHeading levels [1..4]). */
export const MAX_HEADING_LEVEL = 4;

type Mark = { type: string; attrs?: Record<string, unknown> };

function markList(n: JsonNode): Mark[] {
  return (n.marks ?? []).map((m) => (typeof m === "string" ? { type: m } : m)).filter((m) => m && typeof m.type === "string");
}

/**
 * Escapes text so it reads back as the same characters. Kept minimal so prose
 * stays readable: intraword underscores (snake_case) are left alone because
 * CommonMark already treats them literally.
 */
export function escapeText(s: string, atLineStart: boolean): string {
  let out = s.replace(/[\\*`[\]<]/g, (c) => "\\" + c);
  out = out.replace(/(^|[^A-Za-z0-9])_|_(?=[^A-Za-z0-9]|$)/g, (_m, pre) =>
    pre !== undefined ? `${pre}\\_` : "\\_",
  );
  if (atLineStart) {
    out = out.replace(/^(\s*)([#>=+-])/, "$1\\$2").replace(/^(\s*)(\d+)([.)])(\s)/, "$1$2\\$3$4");
  }
  return out;
}

function fenceFor(body: string, min = 3): string {
  let longest = 0;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(min, longest + 1));
}

function unknownInline(n: JsonNode): string {
  const json = JSON.stringify(n);
  const ticks = fenceFor(json, 1);
  return `${ticks}vault:${n.type ?? "?"} ${json}${ticks}`;
}

function unknownBlock(n: JsonNode): string {
  const json = JSON.stringify(n, null, 2);
  const fence = fenceFor(json);
  return `${fence}vault:${n.type ?? "?"}\n${json}\n${fence}`;
}

/** Renders inline content (the children of a paragraph/heading) to one string. */
export function inlineToMarkdown(nodes: JsonNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return "";
  const parts: string[] = [];
  let atLineStart = true;
  for (const n of nodes) {
    if (n.type === "text") {
      const marks = markList(n);
      const code = marks.find((m) => m.type === "code");
      let s: string;
      if (code) {
        const ticks = fenceFor(n.text ?? "", 1);
        const pad = /^`|`$/.test(n.text ?? "") ? " " : "";
        s = `${ticks}${pad}${n.text ?? ""}${pad}${ticks}`;
      } else {
        s = escapeText(n.text ?? "", atLineStart);
      }
      if (marks.some((m) => m.type === "italic")) s = `_${s}_`;
      if (marks.some((m) => m.type === "bold")) s = `**${s}**`;
      const link = marks.find((m) => m.type === "link");
      if (link) {
        const href = String(link.attrs?.href ?? "");
        s = `[${s}](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`;
      }
      parts.push(s);
      atLineStart = false;
    } else if (n.type === "hardBreak") {
      parts.push("\\\n");
      atLineStart = true;
    } else {
      parts.push(unknownInline(n));
      atLineStart = false;
    }
  }
  return parts.join("");
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function indent(text: string, prefix: string, firstPrefix: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? firstPrefix + line : line === "" ? "" : prefix + line))
    .join("\n");
}

function listToMarkdown(n: JsonNode, ordered: boolean, task = false): string {
  const start = Number(n.attrs?.start ?? 1) || 1;
  const items = (n.content ?? []).map((item, i) => {
    // A nested list attaches to the paragraph above it with no blank line
    // (a "tight" list); every other block inside an item is separated by one.
    let body = "";
    for (const block of item.content ?? []) {
      const sep = body === "" ? "" : LIST_TYPES.has(block.type ?? "") ? "\n" : "\n\n";
      body += sep + blockToMarkdown(block);
    }
    let marker: string;
    if (ordered) marker = `${start + i}. `;
    else if (task) marker = item.attrs?.checked ? "- [x] " : "- [ ] ";
    else marker = "- ";
    return indent(body || "", " ".repeat(marker.length), marker);
  });
  return items.join("\n");
}

export function blockToMarkdown(n: JsonNode): string {
  switch (n.type) {
    case "paragraph":
      return inlineToMarkdown(n.content);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1) || 1));
      return `${"#".repeat(level)} ${inlineToMarkdown(n.content)}`;
    }
    case "bulletList":
      return listToMarkdown(n, false);
    case "orderedList":
      return listToMarkdown(n, true);
    case "taskList":
      return listToMarkdown(n, false, true);
    case "codeBlock": {
      const body = (n.content ?? []).map((c) => c.text ?? "").join("");
      const fence = fenceFor(body);
      const lang = typeof n.attrs?.language === "string" ? n.attrs.language : "";
      return `${fence}${lang}\n${body}\n${fence}`;
    }
    case "blockquote":
      return indent(blocksToMarkdown(n.content ?? []), "> ", "> ").replace(/^$/gm, ">");
    case "horizontalRule":
      return "---";
    default:
      return unknownBlock(n);
  }
}

export function blocksToMarkdown(blocks: JsonNode[]): string {
  return blocks.map(blockToMarkdown).join("\n\n");
}

export function toMarkdown(doc: JsonNode): string {
  const md = blocksToMarkdown(doc.content ?? []);
  return md ? md + "\n" : "";
}

// ── Markdown → JSON ──────────────────────────────────────────────────────────

export interface ConvertResult {
  doc: JsonNode;
  /** Every place the Markdown had no lossless representation. */
  warnings: string[];
}

interface Ctx {
  src: string;
  warnings: string[];
}

function slice(ctx: Ctx, n: Md.Nodes): string {
  const s = n.position?.start.offset;
  const e = n.position?.end.offset;
  return s != null && e != null ? ctx.src.slice(s, e) : "";
}

function line(n: Md.Nodes): string {
  return n.position ? `line ${n.position.start.line}` : "unknown line";
}

function text(value: string, marks: Mark[]): JsonNode {
  const node: JsonNode = { type: "text", text: value };
  if (marks.length) node.marks = marks.map((m) => (m.attrs ? { type: m.type, attrs: m.attrs } : { type: m.type }));
  return node;
}

function inlineNodes(ctx: Ctx, nodes: Md.PhrasingContent[], marks: Mark[]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        if (n.value) out.push(text(n.value, marks));
        break;
      case "strong":
        out.push(...inlineNodes(ctx, n.children, [...marks, { type: "bold" }]));
        break;
      case "emphasis":
        out.push(...inlineNodes(ctx, n.children, [...marks, { type: "italic" }]));
        break;
      case "inlineCode":
        out.push(text(n.value, [...marks, { type: "code" }]));
        break;
      case "link":
        out.push(...inlineNodes(ctx, n.children, [...marks, { type: "link", attrs: { href: n.url } }]));
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "image":
        ctx.warnings.push(`${line(n)}: image kept as a link (images are not written by the CLI)`);
        out.push(text(n.alt || n.url, [...marks, { type: "link", attrs: { href: n.url } }]));
        break;
      case "html":
        ctx.warnings.push(`${line(n)}: inline HTML kept as literal text`);
        out.push(text(n.value, marks));
        break;
      default:
        ctx.warnings.push(`${line(n)}: ${n.type} kept as literal text`);
        out.push(text(slice(ctx, n), marks));
    }
  }
  return out;
}

function paragraph(content: JsonNode[]): JsonNode {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function listItemNodes(ctx: Ctx, item: Md.ListItem): JsonNode {
  if (item.checked != null) {
    ctx.warnings.push(`${line(item)}: task checkbox kept as literal "[${item.checked ? "x" : " "}]" text`);
  }
  const blocks = blockNodes(ctx, item.children);
  if (item.checked != null) {
    const box = text(`[${item.checked ? "x" : " "}] `, []);
    const first = blocks[0];
    if (first?.type === "paragraph") first.content = [box, ...(first.content ?? [])];
    else blocks.unshift(paragraph([box]));
  }
  // Tiptap's listItem content is `paragraph block*`: the first child must be a
  // paragraph, so an item that starts with a nested list or a code block gets
  // an empty one in front rather than an invalid document.
  if (blocks.length === 0 || blocks[0].type !== "paragraph") blocks.unshift(paragraph([]));
  return { type: "listItem", content: blocks };
}

function blockNodes(ctx: Ctx, nodes: Md.RootContent[]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "paragraph":
        out.push(paragraph(inlineNodes(ctx, n.children, [])));
        break;
      case "heading": {
        let level = n.depth;
        if (level > MAX_HEADING_LEVEL) {
          ctx.warnings.push(`${line(n)}: heading level ${level} clamped to ${MAX_HEADING_LEVEL} (the deepest Vault renders)`);
          level = MAX_HEADING_LEVEL;
        }
        const content = inlineNodes(ctx, n.children, []);
        out.push(content.length ? { type: "heading", attrs: { level }, content } : { type: "heading", attrs: { level } });
        break;
      }
      case "list": {
        const items = n.children.map((item) => listItemNodes(ctx, item));
        if (n.ordered) {
          const start = n.start ?? 1;
          out.push(start !== 1 ? { type: "orderedList", attrs: { start }, content: items } : { type: "orderedList", content: items });
        } else {
          out.push({ type: "bulletList", content: items });
        }
        break;
      }
      case "code": {
        if (n.lang && n.lang.startsWith("vault:")) {
          throw new UserError(
            `${line(n)}: a \`\`\`${n.lang} block cannot be written back — it is the CLI's read-only rendering of a block type it does not write; remove it or edit that note in the app`,
          );
        }
        const attrs = { language: n.lang ?? null };
        out.push(n.value ? { type: "codeBlock", attrs, content: [text(n.value, [])] } : { type: "codeBlock", attrs });
        break;
      }
      case "blockquote":
        ctx.warnings.push(`${line(n)}: blockquote flattened to plain blocks`);
        out.push(...blockNodes(ctx, n.children));
        break;
      case "thematicBreak":
        ctx.warnings.push(`${line(n)}: horizontal rule dropped`);
        break;
      case "html":
        ctx.warnings.push(`${line(n)}: HTML block kept as literal text`);
        out.push(paragraph([text(n.value, [])]));
        break;
      case "definition":
        // Link reference definitions are consumed by the parser; nothing to keep.
        break;
      default:
        ctx.warnings.push(`${line(n)}: ${n.type} kept as literal text`);
        out.push(paragraph([text(slice(ctx, n), [])]));
    }
  }
  return out;
}

export function fromMarkdown(src: string): ConvertResult {
  const normalized = src.replace(/\r\n?/g, "\n");
  const tree = mdastFromMarkdown(normalized);
  const ctx: Ctx = { src: normalized, warnings: [] };
  const content = blockNodes(ctx, tree.children);
  // An empty doc is not valid ProseMirror (doc content is `block+`), and an
  // empty note in the app is one empty paragraph.
  return { doc: { type: "doc", content: content.length ? content : [paragraph([])] }, warnings: ctx.warnings };
}
