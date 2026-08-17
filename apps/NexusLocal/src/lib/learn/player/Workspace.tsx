/**
 * Arbejdsrum — the exercise workspace ("Kladde") from LEARN_PLAN.md's pinned
 * "Arbejdsrum — exercise workspace + math writer (2026-08-17)" section. A
 * stack of typed working lines, each live-rendered as KaTeX through the
 * lenient `mathWriter.toLatex` transform. Scratch, not answer: nothing here
 * grades, and the only thing that ever crosses into the drill is the RAW line
 * text via `onCopyToAnswer` — the learner types in the grammar `answers.ts`
 * already parses, the LaTeX exists only for the eye.
 *
 * One component, three slots — `useWorkspaceLayout()` picks exactly one:
 *   desktop (≥1024px)  → right pane beside the problem (`WS_PANE`), which on
 *                        DrillCard also carries the relocated answer block as
 *                        `footer` so the answer sits at the pane's bottom
 *   tablet (768–1023)  → inline block below the problem, min-height ~40vh
 *   phone  (<768px)    → full-height slide-up sheet behind a "Kladde" chip
 * JS breakpoints rather than three CSS-hidden copies on purpose: the pad is
 * mounted in exactly one slot, so line state can never silently fork.
 *
 * Scratch persistence is a module-level Map keyed by item id — both
 * `DrillCard` (`drill:${id}`) and `ExerciseSession` (`exgroup:${group_key}`)
 * import this same module, so one store is shared by construction. It dies
 * with the page: never written to Supabase, no localStorage — scratch is
 * private and ephemeral (the `usage_intervals` privacy posture, charter).
 *
 * The split-layout class literals (`WS_SPLIT_ROW` / `WS_SPLIT_MAIN` /
 * `WS_PANE`) are exported from HERE rather than `tokens.tsx` so this feature
 * never touches that file. All strings are complete literals — Tailwind v4's
 * JIT only scans literal substrings (DESIGN.md §1.1).
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css"; // idempotent — Markdown.tsx already imports it
import { textFallback, toLatex } from "./mathWriter";

// --- Session-scoped scratch store -------------------------------------------

const SCRATCH = new Map<string, string[]>();
const SCRATCH_CAP = 200; // FIFO-evict the oldest key past the cap

/** Lines for a key; `[""]` when absent — the pad is never empty. */
export function getScratch(itemId: string): string[] {
  const lines = SCRATCH.get(itemId);
  return lines && lines.length > 0 ? lines : [""];
}

export function setScratch(itemId: string, lines: string[]): void {
  if (!SCRATCH.has(itemId) && SCRATCH.size >= SCRATCH_CAP) {
    const oldest = SCRATCH.keys().next().value;
    if (oldest !== undefined) SCRATCH.delete(oldest);
  }
  SCRATCH.set(itemId, lines);
}

export function clearScratch(itemId: string): void {
  SCRATCH.delete(itemId);
}

/** Non-blank line count for a key, without mounting anything — feeds the
 * phone toggle's dot badge. */
export function scratchLineCount(itemId: string): number {
  return (SCRATCH.get(itemId) ?? []).filter((l) => l.trim() !== "").length;
}

// --- Layout hook -------------------------------------------------------------

export type WorkspaceLayout = "phone" | "tablet" | "desktop";

function readLayout(): WorkspaceLayout {
  if (typeof window === "undefined" || !window.matchMedia) return "phone";
  if (window.matchMedia("(min-width:1024px)").matches) return "desktop";
  if (window.matchMedia("(min-width:768px)").matches) return "tablet";
  return "phone";
}

/** `matchMedia`-driven breakpoint read — Tailwind's `md`/`lg` boundaries
 * (768/1024px), the charter's three devices. */
export function useWorkspaceLayout(): WorkspaceLayout {
  const [layout, setLayout] = useState<WorkspaceLayout>(readLayout);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const desktop = window.matchMedia("(min-width:1024px)");
    const tablet = window.matchMedia("(min-width:768px)");
    const onChange = () => setLayout(readLayout());
    desktop.addEventListener("change", onChange);
    tablet.addEventListener("change", onChange);
    return () => {
      desktop.removeEventListener("change", onChange);
      tablet.removeEventListener("change", onChange);
    };
  }, []);
  return layout;
}

// --- Split-layout class literals (DESIGN.md §1.1: complete strings) ----------

/** Desktop right pane — sticky so it survives the problem scrolling past it. */
export const WS_PANE =
  "sticky top-0 w-[34rem] shrink-0 max-h-[calc(100vh-13rem)] overflow-y-auto overscroll-contain";

/** The row that replaces `READING_COL` when the desktop workspace is on. */
export const WS_SPLIT_ROW = "mx-auto flex w-full max-w-[82rem] items-start gap-8";

/** The problem column inside `WS_SPLIT_ROW`. */
export const WS_SPLIT_MAIN = "min-w-0 flex-1 lg:max-w-[46rem]";

// --- KaTeX line rendering ----------------------------------------------------

const RENDER_CACHE = new Map<string, string>(); // cap 500, cleared wholesale

/** Three independent safety nets: `toLatex` never throws → `throwOnError:
 * false` → the outer try/catch (`strict:false` suppresses unicode-in-math as
 * a fourth). Output is only ever katex's own HTML — never raw user text. */
function renderLine(src: string): string {
  const hit = RENDER_CACHE.get(src);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(toLatex(src), {
      displayMode: false,
      throwOnError: false,
      strict: false,
      output: "html",
      errorColor: "#b91c1c",
    });
  } catch {
    try {
      html = katex.renderToString(textFallback(src), { throwOnError: false, strict: false });
    } catch {
      html = "";
    }
  }
  if (RENDER_CACHE.size > 500) RENDER_CACHE.clear();
  RENDER_CACHE.set(src, html);
  return html;
}

// --- The phone "Kladde" chip -------------------------------------------------

export function WorkspaceToggle({ onClick, count }: { onClick: () => void; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative min-h-[44px] rounded-xl bg-white px-4 text-[13px] font-medium text-[#1A1A24]/80 ring-1 ring-black/10 active:bg-black/[0.04]"
    >
      Kladde
      {count > 0 && (
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600" />
      )}
    </button>
  );
}

// --- The workspace -----------------------------------------------------------

// Recessed pad surface (DESIGN.md §8.5 logic — it is not a theory card) with
// white line cards floating on it. Two complete literals, picked whole — the
// inline variant adds its own margins/min-height (charter: ~40vh on tablet).
const PAD = "rounded-2xl border border-black/[0.05] bg-black/[0.025] p-3 md:p-4";
const PAD_INLINE =
  "mt-3 min-h-[40vh] rounded-2xl border border-black/[0.05] bg-black/[0.025] p-3 md:mt-6 md:p-4";

export function Workspace({
  itemId,
  onCopyToAnswer,
  variant,
  onClose,
  footer,
}: {
  itemId: string;
  /** Omitted on surfaces with no answer input (ExerciseSession) — the
   *  per-line "→ svar" button is then not rendered at all. Receives the RAW
   *  line text, never LaTeX. */
  onCopyToAnswer?: (line: string) => void;
  /** "pane" = desktop right column · "inline" = tablet block · "sheet" =
   *  phone overlay. Callers pass `key={itemId}` so a new item mounts fresh. */
  variant: "pane" | "inline" | "sheet";
  /** sheet only */
  onClose?: () => void;
  /** pane only: the relocated answer block (DrillCard desktop) */
  footer?: ReactNode;
}) {
  const [lines, setLines] = useState<string[]>(() => getScratch(itemId));
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  // Write-through to the session store on every edit.
  useEffect(() => {
    setScratch(itemId, lines);
  }, [itemId, lines]);

  useEffect(() => {
    if (focusIdx === null) return;
    inputs.current[focusIdx]?.focus();
    setFocusIdx(null);
  }, [focusIdx]);

  function updateLine(i: number, value: string) {
    setLines((prev) => prev.map((l, j) => (j === i ? value : l)));
  }

  function insertLineAfter(i: number) {
    setLines((prev) => {
      const next = prev.slice();
      next.splice(i + 1, 0, "");
      return next;
    });
    setFocusIdx(i + 1);
  }

  /** Never empties the stack: deleting the last line resets it to `[""]`. */
  function deleteLine(i: number) {
    setLines((prev) => (prev.length <= 1 ? [""] : prev.filter((_, j) => j !== i)));
  }

  function appendLine() {
    setLines((prev) => [...prev, ""]);
    setFocusIdx(lines.length);
  }

  function clearAll() {
    setLines([""]);
    clearScratch(itemId);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      insertLineAfter(i);
    } else if (
      e.key === "Backspace" &&
      lines[i] === "" &&
      lines.length > 1 &&
      e.currentTarget.selectionStart === 0
    ) {
      e.preventDefault();
      setLines((prev) => prev.filter((_, j) => j !== i));
      setFocusIdx(Math.max(0, i - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx(Math.max(0, i - 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx(Math.min(lines.length - 1, i + 1));
    }
  }

  const allBlank = lines.every((l) => l.trim() === "");

  const clearButton = (
    <button
      type="button"
      onClick={clearAll}
      className="min-h-[32px] text-[11px] text-[#6E6E78] underline decoration-black/15 underline-offset-4 active:text-[#1A1A24]/70"
    >
      Ryd
    </button>
  );

  const pad = (
    <div className={variant === "inline" ? PAD_INLINE : PAD}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
          KLADDE
        </span>
        {/* The sheet carries Ryd in its own footer instead. */}
        {variant !== "sheet" && !allBlank && clearButton}
      </div>

      {allBlank && (
        <p className="mt-1 text-[11px] leading-relaxed text-[#6E6E78]/70">
          1/2 · x^2 · sqrt(2) · (1 2; 3 4) · lambda
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {lines.map((line, i) => (
          <div key={i} className="rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
            <div className="flex items-start gap-1.5">
              <span className="mt-2 w-4 shrink-0 text-right text-[10px] tabular-nums text-[#6E6E78]/45">
                {i + 1}
              </span>
              <input
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                value={line}
                onChange={(e) => updateLine(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                placeholder="skriv en linje… fx (1 2; 3 4)"
                className="min-h-[36px] w-full flex-1 bg-transparent font-mono text-[15px] text-[#1A1A24] outline-none placeholder:text-[#6E6E78]/45"
              />
              <button
                type="button"
                onClick={() => deleteLine(i)}
                aria-label="Slet linje"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#6E6E78]/55 active:bg-black/[0.05]"
              >
                ✕
              </button>
            </div>
            {line.trim() !== "" && (
              <div className="mt-1 flex items-center justify-between gap-2 pl-[1.375rem]">
                {/* katex output only — never raw user text (§B.4). A wide
                    pmatrix scrolls inside its line, not the pane. */}
                <div
                  className="min-w-0 overflow-x-auto overscroll-x-contain text-[#1A1A24]/85"
                  dangerouslySetInnerHTML={{ __html: renderLine(line) }}
                />
                {onCopyToAnswer && (
                  <button
                    type="button"
                    onClick={() => onCopyToAnswer(line)}
                    className="min-h-[32px] shrink-0 rounded-lg bg-white px-2 text-[11px] font-medium text-[#6E6E78] ring-1 ring-black/10 active:bg-black/[0.04]"
                  >
                    → svar
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={appendLine}
        className="mt-2 min-h-[44px] w-full rounded-xl border border-dashed border-black/[0.12] text-[12px] text-[#6E6E78] active:bg-black/[0.03]"
      >
        + linje
      </button>
    </div>
  );

  if (variant === "sheet") {
    return (
      <div className="fixed inset-0 z-[60] flex animate-[learn-overlay_.22s_ease-out] flex-col bg-[#F6F5F1]">
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.08] px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="text-[13px] font-medium text-[#1A1A24]/85">Kladde</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Luk"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{pad}</div>
        <div className="flex shrink-0 items-center gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {clearButton}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            Luk
          </button>
        </div>
      </div>
    );
  }

  if (variant === "inline") return pad;

  // pane — the caller wraps this in <aside className={WS_PANE}>.
  return (
    <div>
      {pad}
      {footer && <div className="mt-3 border-t border-black/[0.08] pt-3">{footer}</div>}
    </div>
  );
}
