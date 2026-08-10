/**
 * Markdown + KaTeX renderer for authored Learn content (Danish, `$…$` /
 * `$$…$$` math, course notation from `dispositioner.md`). Wraps
 * `react-markdown` with `remark-math` + `rehype-katex` (+ `remark-gfm` for
 * tables in `solution_md`). KaTeX's stylesheet is imported once here so every
 * consumer gets it for free.
 *
 * Invariant #5 from LEARN_PLAN.md: never place math inside code fences —
 * KaTeX auto-render (and rehype-katex) skips `pre`/`code` content by design,
 * so authored content must not rely on math rendering inside fenced blocks.
 * That's an authoring-time constraint; nothing to special-case here.
 *
 * v3 (2026-08-10): this file became the *typographic* layer, not just the
 * parser — DESIGN.md §8. Tailwind's preflight strips list markers, table
 * borders and cell padding, and `react-markdown` emits bare `<p>/<ul>/<table>`
 * with no classes, so every consumer was rendering unstyled HTML: paragraphs
 * ran together and GFM tables collapsed into fused, border-less cells. One
 * scoped stylesheet (`.learn-md`) injected once into `document.head` fixes it
 * everywhere at once.
 *
 * Why an imperative head injection rather than `<style>` in the returned JSX:
 * `Markdown` renders dozens of times per screen (every theory statement,
 * every tile, every MCQ option) and a `<style>` per instance would duplicate
 * the sheet that many times. Why *unlayered* CSS: Tailwind v4 puts preflight
 * in `@layer base`, and any unlayered rule beats a layered one regardless of
 * source order — which is exactly what's needed to undo preflight's table and
 * list resets without an `!important` per property.
 */

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const STYLE_ID = "learn-md-style";

/**
 * The prose recipe — DESIGN.md §8.2/§8.3. Every rule is scoped under
 * `.learn-md` so nothing leaks into the dark node dashboard, which shares the
 * same document.
 */
const LEARN_MD_CSS = `
.learn-md { line-height: 1.7; }
.learn-md > :first-child { margin-top: 0; }
.learn-md > :last-child { margin-bottom: 0; }

.learn-md p { margin: 0.85em 0; }
.learn-md strong, .learn-md b { font-weight: 600; color: #1A1A24; }
.learn-md em { font-style: italic; }
.learn-md a { color: #4f46e5; text-decoration: underline; text-underline-offset: 2px; }

.learn-md ul, .learn-md ol { margin: 0.85em 0; padding-left: 1.4em; }
.learn-md ul { list-style: disc; }
.learn-md ol { list-style: decimal; }
.learn-md li { margin: 0.35em 0; padding-left: 0.15em; }
.learn-md li::marker { color: #6E6E78; }
.learn-md li > ul, .learn-md li > ol { margin: 0.35em 0; }

.learn-md h1, .learn-md h2, .learn-md h3, .learn-md h4,
.learn-md h5, .learn-md h6 {
  color: #1A1A24; font-weight: 600; line-height: 1.3; margin: 1.5em 0 0.5em;
}
.learn-md h1 { font-size: 1.32em; }
.learn-md h2 { font-size: 1.18em; }
.learn-md h3 { font-size: 1.06em; }
.learn-md h4, .learn-md h5, .learn-md h6 { font-size: 1em; }

.learn-md hr { border: 0; border-top: 1px solid rgba(0,0,0,0.09); margin: 1.75em 0; }
.learn-md blockquote {
  margin: 1em 0; padding: 0.1em 0 0.1em 0.95em;
  border-left: 2px solid rgba(0,0,0,0.12); color: #6E6E78;
}

.learn-md code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em; background: rgba(0,0,0,0.045);
  padding: 0.12em 0.36em; border-radius: 4px;
}
.learn-md pre {
  margin: 1em 0; overflow-x: auto; background: rgba(0,0,0,0.035);
  border-radius: 10px; padding: 0.85em 1em;
}
.learn-md pre code { background: none; padding: 0; font-size: 0.86em; }

/* Tables — remark-gfm emits a bare <table>; the wrapper div comes from the
   \`components\` override below so the scroller exists at every width. */
.learn-md-table { margin: 1.25em 0; overflow-x: auto; overscroll-behavior-x: contain; }
.learn-md-table > table {
  width: 100%; border-collapse: collapse; text-align: left;
  font-size: 0.94em; line-height: 1.55;
}
.learn-md-table th {
  padding: 0.45rem 0.75rem; vertical-align: bottom; white-space: nowrap;
  font-size: 0.76em; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: #6E6E78;
  border-bottom: 1px solid rgba(0,0,0,0.16);
}
.learn-md-table td {
  padding: 0.55rem 0.75rem; vertical-align: top;
  border-top: 1px solid rgba(0,0,0,0.07);
}
.learn-md-table tbody tr:first-child td { border-top: 0; }
.learn-md-table td:first-child { font-weight: 600; color: #1A1A24; }
.learn-md-table th:first-child, .learn-md-table td:first-child { padding-left: 0; }
.learn-md-table th:last-child, .learn-md-table td:last-child { padding-right: 0; }
.learn-md-table td p { margin: 0.25em 0; }
.learn-md-table .katex { white-space: nowrap; }

/* Display math: left-aligned, not centred. Centred content wider than an
   \`overflow-x: auto\` box puts its own left edge at negative scroll — i.e.
   permanently unreachable in LTR. Left alignment makes the scroll gesture
   actually recover the whole expression. */
.learn-md .katex-display {
  margin: 1.15em 0; padding: 0.15em 0.1em;
  overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain;
  text-align: left;
}
.learn-md .katex-display > .katex { text-align: left; }

/* Lead paragraph — the unit intro's opening sentence carries the "why you are
   here", so it gets one size step and full-strength ink (DESIGN.md §8.4). */
.learn-md-lead > p:first-child { font-size: 1.06em; color: #1A1A24; }

/* Inline call sites (MCQ options, tiles) must not gain block rhythm. */
.learn-md.inline > p { display: inline; margin: 0; }

@media (min-width: 768px) {
  .learn-md .katex-display { margin: 1.4em 0; }
  .learn-md .katex-display > .katex { font-size: 1.18em; }
  .learn-md-table { margin: 1.5em 0; }
}
`;

function ensureLearnMarkdownStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = LEARN_MD_CSS;
  document.head.appendChild(el);
}

ensureLearnMarkdownStyle();

const COMPONENTS: Components = {
  // `node` is react-markdown's hast node — it must be stripped before the
  // rest is spread onto a real DOM element, or React warns about an unknown
  // attribute on every table.
  table: ({ node: _node, ...props }) => (
    <div className="learn-md-table">
      <table {...props} />
    </div>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `learn-md ${className}` : "learn-md"}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
