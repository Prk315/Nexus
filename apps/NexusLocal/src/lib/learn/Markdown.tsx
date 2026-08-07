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
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
