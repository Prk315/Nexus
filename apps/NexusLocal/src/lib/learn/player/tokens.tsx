/**
 * Design tokens for `Player.tsx` and its `player/` helpers.
 *
 * v2 (2026-08-07): re-derived for the soft-white "paper" theme — see
 * `../DESIGN.md` §7. The whole Learn surface (path, review, player) now
 * lives on `#F6F5F1` paper with white cards; only the node dashboard in
 * `App.tsx` stays on the original `#0a0a0f` dark theme. Every class string
 * here is still complete — Tailwind v4's JIT scanner only picks up literal
 * substrings that appear somewhere in source text, so nothing is assembled
 * via `text-${lens}-700`-style interpolation (DESIGN.md §1.1).
 *
 * Scoped to `Player.tsx` only. `PathPanel.tsx` / `ReviewPanel.tsx` define
 * their own inline light-theme classes — this file is not a shared export
 * surface outside `player/`.
 */

import type { Lens } from "../types";

// --- Desktop reading layout (DESIGN.md §8) ----------------------------------
//
// The overlay is phone-first and stays byte-identical below `md`. Everything
// here is the desktop enhancement: one centred reading column so prose never
// runs to a 2000px measure, and a narrower action column so the dock doesn't
// stretch a primary button across the whole window.
//
// Complete literal strings, per DESIGN.md §1.1 — nothing interpolated.

/** ~72ch at the 15–16px body size. Wraps `<main>` content and the header. */
export const READING_COL = "mx-auto w-full max-w-[46rem]";

/** Scroll shell for a step's `<main>`. Call sites append their own `pb-*`. */
export const MAIN_SHELL =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 md:px-8 md:pt-8";

/** The dock scrim. Full-bleed by design — only its *contents* are columnar. */
export const DOCK_SHELL =
  "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8";

/** Action stack inside the dock: full width on phone, 26rem centred on desktop. */
export const DOCK_STACK =
  "pointer-events-auto mx-auto flex w-full max-w-[46rem] flex-col gap-2 md:max-w-[26rem]";

/** White card stock + desktop padding step. */
export const CARD =
  "rounded-xl border border-black/[0.06] bg-white shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:rounded-2xl";

/** Interactive answer surfaces (inputs, MCQ options, tiles) stay hand-sized. */
export const ANSWER_COL = "md:max-w-[34rem]";

export const LENS: Record<
  Lens,
  {
    label: string;
    long: string;
    chip: string;
    chipOn: string;
    dot: string;
    edge: string;
    tint: string;
  }
> = {
  row: {
    label: "Række",
    long: "Rækkebilledet",
    chip: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-600/25",
    chipOn: "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-600/40",
    dot: "bg-cyan-500",
    edge: "border-l-2 border-cyan-500/60",
    tint: "bg-cyan-50",
  },
  matrix: {
    label: "Matrix",
    long: "Matrixformen",
    chip: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/25",
    chipOn: "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-600/40",
    dot: "bg-indigo-500",
    edge: "border-l-2 border-indigo-500/60",
    tint: "bg-indigo-50",
  },
  column: {
    label: "Søjle",
    long: "Søjlebilledet",
    chip: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-600/25",
    chipOn: "bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-600/40",
    dot: "bg-fuchsia-500",
    edge: "border-l-2 border-fuchsia-500/60",
    tint: "bg-fuchsia-50",
  },
};

export const FEEDBACK = {
  correct: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/25",
  wrong: "bg-red-50 text-red-700 ring-1 ring-red-500/25",
  draft: "bg-amber-50 text-amber-700 ring-1 ring-amber-500/30",
  // Unparseable input (answers.ts `inputParses`) is a format event, not a
  // wrong-answer event — it must never render as `wrong` (red) or reuse
  // `draft` (amber is already reserved for the DRAFT badge; the §1.2/§7.4
  // "never means anything but this" rule means status hues don't double up).
  // Quiet ink-on-recessed-surface instead, matching the muted ladder in
  // §7.2/§7.1 rather than introducing a fourth reserved status hue.
  format: "bg-black/[0.03] text-[#1A1A24]/70 ring-1 ring-black/10",
} as const;

// The six ordered lens pairs a `translate` drill's gradient top-edge can run
// between (DESIGN.md §1.1's "translate framing"). Written out in full rather
// than composed from `LENS[from]...` / `LENS[to]...` — belt-and-suspenders
// against the interpolation trap, and easier to eyeball for correctness.
// Plain single-lens top edge for non-translate drills (every drill card gets
// a 2px top bar per DESIGN.md §3.5's anatomy diagram; `translate` drills use
// `TRANSLATE_BAR` instead when a source lens was detected). Solid -500
// shades at full opacity — the softer -400/60% mix from the dark theme reads
// as barely-there on white.
export const SOLID_BAR: Record<Lens, string> = {
  row: "bg-cyan-500",
  matrix: "bg-indigo-500",
  column: "bg-fuchsia-500",
};

export const TRANSLATE_BAR: Record<string, string> = {
  "row-matrix": "bg-gradient-to-r from-cyan-500 to-indigo-500",
  "row-column": "bg-gradient-to-r from-cyan-500 to-fuchsia-500",
  "matrix-row": "bg-gradient-to-r from-indigo-500 to-cyan-500",
  "matrix-column": "bg-gradient-to-r from-indigo-500 to-fuchsia-500",
  "column-row": "bg-gradient-to-r from-fuchsia-500 to-cyan-500",
  "column-matrix": "bg-gradient-to-r from-fuchsia-500 to-indigo-500",
};

/**
 * Best-effort detection of a `translate` drill's *source* lens from its own
 * `prompt_md`. Real authored content (sampled unit_id 17, 28) opens these
 * drills with a bolded `**Givet i <ord>linsen:**` / `**Givet i
 * <ord>billedet:**` preface naming the lens the fact is *given* in — the
 * drill's own `lens` field is always the *target* (what the answer must be
 * expressed in). Not every translate drill carries this preface (sampled
 * unit_id 2 doesn't), so this degrades to `null` — callers fall back to
 * single-lens framing rather than guessing. Not a general content parser:
 * scoped to the four words the course's own vocabulary actually uses.
 */
export function detectSourceLens(promptMd: string): Lens | null {
  const m = promptMd.match(/Givet i (række|søjle|matrix|koordinat)\w*(?:linsen|billedet|form)/i);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (word === "række") return "row";
  if (word === "søjle") return "column";
  // "matrix" and "koordinat" (coordinates are read off via the matrix) both
  // name the matrix/computational lens.
  return "matrix";
}

// --- Motion + KaTeX phone-width CSS -----------------------------------------
//
// DESIGN.md §5 asks for one injected `<style>` shared by every Learn surface
// (via `Markdown.tsx`) since `PathPanel`/`ReviewPanel` need `learn-pulse` and
// `learn-step-in` without `Player` ever mounting. `Markdown.tsx` as built
// doesn't inject that stylesheet (out of this slice's ownership — it belongs
// to the foundation agent), so `Player.tsx` carries its own complete copy:
// every keyframe used inside the overlay, plus the §1.5 KaTeX phone-width
// rules that `Markdown` output needs wherever `Player` renders it (theory
// statements, drill prompts/solutions, master-demo steps). Rendered once at
// the top of the overlay in `Player.tsx`. If `PathPanel`/`ReviewPanel` need
// `learn-pulse` outside the overlay, they must inject their own copy — this
// file cannot become a cross-agent export without editing files outside this
// slice.
//
// Colour-agnostic by design — no dark-theme colours live here, so the v2
// light-theme pass didn't need to touch it. KaTeX inherits `color` from
// whatever ink class the caller's `Markdown` wrapper sets.
export const PLAYER_STYLE = `
@keyframes learn-overlay   { from { opacity:0; transform:translateY(8px) scale(.99) } to { opacity:1; transform:none } }
@keyframes learn-step-in   { from { opacity:0; transform:translateY(6px) }            to { opacity:1; transform:none } }
@keyframes learn-chip-rise { from { opacity:0; transform:translateY(10px) scale(.9) } to { opacity:1; transform:none } }
@keyframes learn-pulse     { 0%,100% { opacity:.45 } 50% { opacity:1 } }
@keyframes learn-shake     { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
@keyframes learn-grad-disc { from { opacity:0; transform:rotate(-140deg) scale(.82) } to { opacity:1; transform:rotate(0) scale(1) } }
@keyframes learn-grad-burst{ from { opacity:0; transform:rotate(var(--a)) translateY(-14px) scaleY(.4) }
                             60%  { opacity:1 }
                             to   { opacity:0; transform:rotate(var(--a)) translateY(-64px) scaleY(1) } }

@media (prefers-reduced-motion: reduce) {
  *[class*="learn-"] { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}

/* KaTeX at phone width — DESIGN.md §1.5.
   Note: Markdown.tsx owns the *layout* of display math (margins, alignment,
   the scroller) under its higher-specificity ".learn-md .katex-display"
   selector — DESIGN.md §8.3. What stays here is the size/weight/whitespace
   trio, which applies to any KaTeX the overlay renders. */
.katex-display { overflow-x: auto; overflow-y: hidden; padding: 2px 0; margin: 0.55em 0; }
.katex { font-size: 1.03em; font-weight: 400; white-space: nowrap; }
.katex-display > .katex { font-size: 1.12em; white-space: normal; }
`;
