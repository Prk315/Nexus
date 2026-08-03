// Client-side markdown → full-fidelity HTML for Parsed nodes.
// Mirrors the ingest pipeline: math is extracted BEFORE remark parses (so LaTeX
// backslashes / matrix `\\` survive and a stray `$` can't desync structure),
// then reinserted as <span/div data-type=inline|block-math data-latex="…">
// (KaTeX renders these at display time in ParsedViewer). Definition/Theorem/
// Example/Proof runs are wrapped in <div class="pv-env pv-env-<type>">.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";

const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);

const ENV_MAP: Record<string, string> = {
  Definition: "definition", Sætning: "theorem", Teorem: "theorem",
  Proposition: "proposition", Lemma: "lemma", Korollar: "corollary",
  Eksempel: "example", Bevis: "proof", Bemærkning: "remark",
  Notation: "notation", Opgave: "exercise",
};
const ENV_RE = new RegExp("^\\s*(" + Object.keys(ENV_MAP).join("|") + ")\\b");
const VOID = new Set(["img", "br", "hr"]);

// Ensure $$…$$ display math is block-level (its own paragraph) before parsing.
export function blockifyDisplayMath(md: string): string {
  return md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => `\n\n$$${inner.trim()}$$\n\n`);
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textOf(n: any): string {
  if (n.type === "text") return n.value;
  if (n.children) return n.children.map(textOf).join("");
  return "";
}

export function markdownToParsedHtml(md: string): string {
  // 1. Pull math into placeholders.
  const maths: { latex: string; block: boolean }[] = [];
  const placeheld = md.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_f, block, inline) => {
    const idx = maths.push(block !== undefined
      ? { latex: String(block).trim(), block: true }
      : { latex: String(inline).trim(), block: false }) - 1;
    return OPEN + idx + CLOSE;
  });

  // 2. Parse structure (math is now inert placeholder text).
  const tree = unified().use(remarkParse).parse(placeheld);
  const hast: any = unified().use(remarkRehype, { allowDangerousHtml: true }).runSync(tree);

  // 3. Reinsert math elements wherever a placeholder appears in a text node.
  const PH_RE = new RegExp(OPEN + "(\\d+)" + CLOSE, "g");
  const mathEl = (idx: string) => {
    const m = maths[Number(idx)];
    return {
      type: "element", tagName: m.block ? "div" : "span",
      properties: { "data-type": m.block ? "block-math" : "inline-math", "data-latex": m.latex },
      children: [],
    };
  };
  const expand = (v: string): any[] => {
    const out: any[] = []; let last = 0; let m: RegExpExecArray | null; PH_RE.lastIndex = 0;
    while ((m = PH_RE.exec(v)) !== null) {
      if (m.index > last) out.push({ type: "text", value: v.slice(last, m.index) });
      out.push(mathEl(m[1]));
      last = PH_RE.lastIndex;
    }
    if (last < v.length) out.push({ type: "text", value: v.slice(last) });
    return out.length ? out : [{ type: "text", value: v }];
  };
  const walk = (node: any) => {
    if (!node.children) return;
    const next: any[] = [];
    for (const c of node.children) {
      if (c.type === "text" && c.value.includes(OPEN)) next.push(...expand(c.value));
      else { walk(c); next.push(c); }
    }
    node.children = next;
  };
  walk(hast);

  // 4. Group theorem-like environments.
  const isHeadingLE = (n: any, lvl: number) =>
    n.type === "element" && /^h[1-6]$/.test(n.tagName) && Number(n.tagName[1]) <= lvl;
  const kids = (hast.children as any[]).filter((n) => n.type === "element");
  const grouped: any[] = [];
  let i = 0;
  while (i < kids.length) {
    const node = kids[i];
    const match = textOf(node).match(ENV_RE);
    const isStart = match && (node.tagName === "p" || /^h[1-6]$/.test(node.tagName));
    if (isStart) {
      const type = ENV_MAP[match![1]];
      const group = [node]; i++;
      while (i < kids.length) {
        if (ENV_RE.test(textOf(kids[i])) || isHeadingLE(kids[i], 3)) break;
        group.push(kids[i]); i++;
      }
      grouped.push({
        type: "element", tagName: "div",
        properties: { className: ["pv-env", "pv-env-" + type] }, children: group,
      });
    } else { grouped.push(node); i++; }
  }
  hast.children = grouped;

  // 5. Serialize (drop stray inline HTML — span anchors, sup footnotes).
  const toHtml = (node: any): string => {
    if (node.type === "text") return esc(node.value);
    if (node.type === "raw") return "";
    if (node.type === "root") return node.children.map(toHtml).join("");
    if (node.type === "element") {
      const props = Object.entries(node.properties || {}).map(([k, v]) => {
        const name = k === "className" ? "class" : k;
        const val = Array.isArray(v) ? v.join(" ") : v;
        return v === true ? ` ${name}` : ` ${name}="${esc(String(val))}"`;
      }).join("");
      const inner = (node.children || []).map(toHtml).join("");
      return VOID.has(node.tagName) ? `<${node.tagName}${props}>` : `<${node.tagName}${props}>${inner}</${node.tagName}>`;
    }
    return "";
  };
  return toHtml(hast);
}
