// Markdown → HTML, for one purpose: seeding a rich editor from text that was
// written as markdown.
//
// ── Why not a markdown library ─────────────────────────────────────────────
//
// This runs ONCE per block, at conversion, and only has to cover the
// constructs Tiptap's note schema actually has. A full CommonMark parser would
// be a dependency, a bundle cost and a much larger surface, in exchange for
// correctly rendering constructs the target schema cannot represent anyway —
// there is no footnote node, no definition list, no table alignment.
//
// ── ⚠️ What makes an incomplete converter safe ─────────────────────────────
//
// The original markdown is KEPT (`CanvasEditor` writes it to the block's `md`
// field before converting and never overwrites it). So the worst case of a
// construct this does not understand is that it arrives as literal text in the
// editor, with the source still on the block. That is why "covers most of it"
// is an acceptable answer here and would not be if the conversion were
// destructive.
//
// Everything is escaped BEFORE any markup is emitted, so a block containing
// `<script>` becomes text rather than a tag. Tiptap's parser would drop an
// unknown tag anyway, but "would be dropped downstream" is not a reason to
// generate it.

const ESC: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/**
 * The deepest heading the note schema has.
 *
 * ⚠️ `FoldableHeading.configure({ levels: [1,2,3,4] })` — and `levels` IS a
 * schema option. Emitting `<h5>` produces a tag the parser does not recognise,
 * which is silently dropped to a paragraph: the heading becomes body text and
 * the structure is gone with no error anywhere. Clamping keeps it a heading.
 */
export const MAX_HEADING = 4;

/** Inline marks, applied to already-escaped text. */
export function inlineMd(escaped: string): string {
  return escaped
    // Code first: its content must not then be scanned for emphasis, so it is
    // replaced wholesale rather than wrapped in place.
    .replace(/`([^`\n]+)`/g, (_m, code) => `<code>${code}</code>`)
    // Links before emphasis: a URL may legitimately contain underscores.
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    // Single-char emphasis last. The content may not OPEN OR CLOSE on
    // whitespace, which is what stops `a * b * c` in prose becoming italics —
    // a `\w` guard on the closing side alone does not, because the character
    // after the closing star there is a space and so passes it.
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]*[^\s*])\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?!\s)([^_\n]*[^\s_])_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
}

/**
 * Block-level conversion.
 *
 * A hand-rolled line walker rather than a regex over the whole string: fenced
 * code has to suppress every other rule inside it, and that is not something a
 * per-line regex pass can express.
 */
export function mdToHtml(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  // What we are currently inside, so a list is closed exactly once.
  let list: "ul" | "ol" | null = null;
  let quote = false;
  let fence: string | null = null;
  let code: string[] = [];

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeQuote = () => { if (quote) { out.push("</blockquote>"); quote = false; } };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");

    // ── Fenced code ────────────────────────────────────────────────────────
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        out.push(
          `<pre><code${fence ? ` class="language-${escapeHtml(fence)}"` : ""}>` +
          `${escapeHtml(code.join("\n"))}</code></pre>`,
        );
        fence = null;
        code = [];
      } else {
        code.push(line);
      }
      continue;
    }
    const open = /^\s*```(\w*)\s*$/.exec(line);
    if (open) {
      closeList(); closeQuote();
      fence = open[1] ?? "";
      continue;
    }

    if (line.trim() === "") { closeList(); closeQuote(); continue; }

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      closeList(); closeQuote();
      out.push("<hr>");
      continue;
    }

    // ── Heading ────────────────────────────────────────────────────────────
    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList(); closeQuote();
      const level = Math.min(h[1].length, MAX_HEADING);
      out.push(`<h${level}>${inlineMd(escapeHtml(h[2].trim()))}</h${level}>`);
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────
    const q = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (q) {
      closeList();
      if (!quote) { out.push("<blockquote>"); quote = true; }
      out.push(`<p>${inlineMd(escapeHtml(q[1]))}</p>`);
      continue;
    }
    closeQuote();

    // ── Lists ──────────────────────────────────────────────────────────────
    const ul = /^\s{0,3}[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s{0,3}\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      // A task item keeps its marker as text: Tiptap's task list is not in this
      // schema, and silently dropping "[ ]" would lose the fact that it was a
      // checklist at all.
      out.push(`<li><p>${inlineMd(escapeHtml((ul ?? ol)![1]))}</p></li>`);
      continue;
    }
    closeList();

    out.push(`<p>${inlineMd(escapeHtml(line.trim()))}</p>`);
  }

  // An unterminated fence is still code — the alternative is silently
  // reinterpreting it as prose and mangling it with the inline rules.
  if (fence !== null) {
    out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  }
  closeList();
  closeQuote();

  return out.join("") || "<p></p>";
}
