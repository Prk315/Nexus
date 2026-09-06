// Bounding what a cell is allowed to leave behind in the document.
//
// ─── Why a cap is not optional here ──────────────────────────────────────────
// Cell outputs persist as a node attribute, which means they live in the note,
// which means three separate budgets apply at once:
//
//  1. `saveContent` REFUSES a note over 2 MB (lib/api.ts). One note holds many
//     cells, plus its actual text, plus any sketches — which carry their own
//     400 kB cap for exactly this reason.
//  2. On a SHARED note the outputs flow through the Yjs CRDT, whose state grows
//     monotonically and has no safe compaction (see CLAUDE.md). A megabyte of
//     base64 pasted into a co-edited document is a megabyte that never leaves.
//  3. `matplotlib.pyplot.show()` produces a base64 PNG. A single unremarkable
//     plot is 50–150 kB; a loop that plots per iteration is unbounded. The
//     failure is not theoretical and it is silent until a note stops saving.
//
// So outputs are capped per cell, and the cap is enforced HERE — pure, ordered
// and tested — rather than in a React component where it would be easy to skip
// on one of the two rendering surfaces.

import type { OutputChunk } from "./types";

/**
 * Per-cell output budget, in characters of serialized content.
 *
 * 256 kB leaves room for several cells plus prose inside one note's 2 MB, and
 * comfortably holds a plot or a large query result. It is deliberately well
 * under the sketch cap's sibling budget rather than tuned to the limit: a cell
 * that needs more than this wants a Canvas node, the same way a drawing that
 * wants a page does.
 */
export const CELL_OUTPUT_MAX_CHARS = 256_000;

/** A single text/error chunk longer than this is truncated in the middle. */
const TEXT_CHUNK_MAX = 20_000;

/** How much of a truncated text chunk to keep at each end. */
const TEXT_HEAD = 12_000;
const TEXT_TAIL = 4_000;

export function outputsSize(chunks: OutputChunk[]): number {
  let total = 0;
  for (const c of chunks) total += c.content.length;
  return total;
}

/**
 * Truncate one text-ish chunk from the MIDDLE, keeping both ends.
 *
 * Head and tail rather than head alone because the two things anyone actually
 * wants from a long output are what it started with and how it ended — a
 * traceback's final line is the whole message, and lopping the tail would hide
 * it behind ten thousand lines of loop output.
 */
function truncateText(content: string): string {
  if (content.length <= TEXT_CHUNK_MAX) return content;
  const omitted = content.length - TEXT_HEAD - TEXT_TAIL;
  return (
    content.slice(0, TEXT_HEAD) +
    `\n\n… ${omitted.toLocaleString()} characters omitted …\n\n` +
    content.slice(content.length - TEXT_TAIL)
  );
}

/**
 * Fit a cell's outputs inside the budget.
 *
 * Chunks are kept in order and whole where possible. Text is truncated in
 * place; an image or table that will not fit is DROPPED and replaced by a note
 * saying so, because a half-written base64 string is not a smaller picture —
 * it is a broken one, and it would render as a silently missing image rather
 * than an explanation.
 *
 * Never throws, and always returns something renderable: a cell that produced
 * too much output must still show its error text.
 */
export function capOutputs(chunks: OutputChunk[]): OutputChunk[] {
  if (outputsSize(chunks) <= CELL_OUTPUT_MAX_CHARS) {
    // Still normalise oversized single chunks even when the total fits, so one
    // 200 kB traceback doesn't crowd out everything after it.
    return chunks.map((c) =>
      c.type === "text" || c.type === "error" ? { ...c, content: truncateText(c.content) } : c
    );
  }

  const out: OutputChunk[] = [];
  let used = 0;
  let dropped = 0;

  for (const chunk of chunks) {
    const remaining = CELL_OUTPUT_MAX_CHARS - used;
    if (remaining <= 0) {
      dropped++;
      continue;
    }

    if (chunk.type === "text" || chunk.type === "error") {
      const text = truncateText(chunk.content);
      const fitted = text.length <= remaining ? text : text.slice(0, remaining);
      out.push({ ...chunk, content: fitted });
      used += fitted.length;
    } else if (chunk.content.length <= remaining) {
      out.push(chunk);
      used += chunk.content.length;
    } else {
      // Binary-ish and too big: drop whole rather than corrupt.
      dropped++;
    }
  }

  if (dropped > 0) {
    out.push({
      type: "text",
      content:
        `\n[${dropped} output${dropped === 1 ? "" : "s"} dropped — this cell exceeded the ` +
        `${Math.round(CELL_OUTPUT_MAX_CHARS / 1000)} kB limit for results stored in a note. ` +
        `Write large results to a file or a Canvas node instead.]`,
    });
  }

  return out;
}
