/**
 * The `answer_type: "tiles"` interaction (LEARN_PLAN.md "Tile drills (schema
 * v1.1 addition)") — Duolingo-style tap exercises. Two modes:
 *
 *  - `select`: a wrap-grid of tappable chips; the learner toggles any subset.
 *    All-and-only the tiles marked `correct: true` is a pass — partial
 *    credit is not (`answers.checkTilesSelect`).
 *  - `build`: an answer row on top (tapped tiles, in order — tap one there
 *    to return it to the bank) and a tile bank below (untapped tiles,
 *    including distractors). The id sequence must match `answer.sequence`
 *    exactly (`answers.checkTilesBuild`).
 *
 * Purely presentational + local tap-handling — DrillCard.tsx owns the actual
 * check/hint/solution/grade flow and passes down `checked`/`disabled`, so
 * this component only renders tiles and reports selection changes upward.
 * `selection` doubles as both modes' state shape: an unordered id set for
 * `select`, an ordered id sequence for `build`.
 */

import type { Drill, Tile, TileMode } from "../types";
import { Markdown } from "../Markdown";

export function TileDrill({
  tiles,
  mode,
  answerSequence,
  selection,
  onSelectionChange,
  checked,
  disabled,
}: {
  tiles: Tile[];
  mode: TileMode;
  /** build mode only — used to render per-slot feedback once `checked`. */
  answerSequence?: string[];
  selection: string[];
  onSelectionChange: (next: string[]) => void;
  checked: boolean;
  disabled?: boolean;
}) {
  if (!tiles || tiles.length === 0) {
    // Robust to malformed/future content — no tiles means nothing to render,
    // not a crash.
    return <p className="text-[12px] text-[#6E6E78]/60">No tiles on this drill.</p>;
  }

  if (mode === "build") {
    return (
      <BuildTiles
        tiles={tiles}
        answerSequence={answerSequence ?? []}
        sequence={selection}
        onSequenceChange={onSelectionChange}
        checked={checked}
        disabled={disabled}
      />
    );
  }

  return (
    <SelectTiles
      tiles={tiles}
      selected={selection}
      onSelectedChange={onSelectionChange}
      checked={checked}
      disabled={disabled}
    />
  );
}

const CHIP_BASE =
  "min-h-[44px] rounded-xl border px-3.5 py-2.5 text-left text-[14px] transition-colors";

function SelectTiles({
  tiles,
  selected,
  onSelectedChange,
  checked,
  disabled,
}: {
  tiles: Tile[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  checked: boolean;
  disabled?: boolean;
}) {
  const selectedSet = new Set(selected);

  function toggle(id: string) {
    if (disabled) return;
    onSelectedChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div>
      <p className="mb-2 text-[10px] uppercase tracking-wide text-[#6E6E78]/70">Tap all correct tiles</p>
      <div className="flex flex-wrap gap-2">
        {tiles.map((tile) => {
          const isSelected = selectedSet.has(tile.id);
          const isCorrect = tile.correct === true;
          let stateClass = "border-black/10 bg-white text-[#1A1A24]/80 active:bg-black/[0.04]";
          if (!checked && isSelected) {
            stateClass = "border-black/25 bg-black/[0.04] text-[#1A1A24]/90";
          } else if (checked) {
            if (isSelected && isCorrect) stateClass = "border-emerald-500/40 bg-emerald-50 text-[#1A1A24]/90";
            else if (isSelected && !isCorrect) stateClass = "border-red-500/40 bg-red-50 text-[#1A1A24]/90";
            else if (!isSelected && isCorrect) stateClass = "border-emerald-500/40 bg-white text-[#1A1A24]/70";
            else stateClass = "border-black/[0.06] bg-transparent text-[#6E6E78]/55";
          }
          return (
            <button
              key={tile.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(tile.id)}
              className={`${CHIP_BASE} ${stateClass}`}
            >
              <Markdown className="inline">{tile.md}</Markdown>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BuildTiles({
  tiles,
  answerSequence,
  sequence,
  onSequenceChange,
  checked,
  disabled,
}: {
  tiles: Tile[];
  answerSequence: string[];
  sequence: string[];
  onSequenceChange: (next: string[]) => void;
  checked: boolean;
  disabled?: boolean;
}) {
  const tileById = new Map(tiles.map((t) => [t.id, t]));
  const usedIds = new Set(sequence);
  const bank = tiles.filter((t) => !usedIds.has(t.id));

  // First index where `sequence` diverges from `answerSequence` — the "first
  // wrong position" the spec calls for. -1 means every tapped tile so far is
  // correctly placed (the sequence may still be incomplete).
  const firstWrong = checked ? firstMismatchIndex(sequence, answerSequence) : -1;

  function addToSequence(id: string) {
    if (disabled) return;
    onSequenceChange([...sequence, id]);
  }

  function removeFromSequence(index: number) {
    if (disabled) return;
    onSequenceChange(sequence.filter((_, i) => i !== index));
  }

  function slotClass(index: number): string {
    if (!checked) return "border-black/25 bg-black/[0.04] text-[#1A1A24]/90";
    if (firstWrong === -1 || index < firstWrong) return "border-emerald-500/40 bg-emerald-50 text-[#1A1A24]/90";
    if (index === firstWrong) return "border-red-500/40 bg-red-50 text-[#1A1A24]/90";
    return "border-black/[0.06] bg-transparent text-[#6E6E78]/55";
  }

  // A correct-so-far but too-short sequence has its "first wrong position"
  // one slot past the end — nothing tapped there yet, so render an empty
  // placeholder to point at the missing tile.
  const missingSlot = checked && firstWrong === sequence.length && firstWrong < answerSequence.length;

  return (
    <div>
      <p className="mb-2 text-[10px] uppercase tracking-wide text-[#6E6E78]/70">Tap tiles in order</p>

      <div className="flex min-h-[52px] flex-wrap items-center gap-2 rounded-xl border border-dashed border-black/[0.15] bg-black/[0.02] p-2">
        {sequence.length === 0 && (
          <span className="px-1 text-[12px] text-[#6E6E78]/60">Tap tiles below, in order…</span>
        )}
        {sequence.map((id, i) => {
          const tile = tileById.get(id);
          return (
            <button
              key={`${id}-${i}`}
              type="button"
              disabled={disabled}
              onClick={() => removeFromSequence(i)}
              className={`${CHIP_BASE} ${slotClass(i)}`}
            >
              <Markdown className="inline">{tile?.md ?? "?"}</Markdown>
            </button>
          );
        })}
        {missingSlot && (
          <span className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl border border-dashed border-red-400/50 bg-red-50 text-[16px] text-red-500/70">
            ?
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {bank.map((tile) => (
          <button
            key={tile.id}
            type="button"
            disabled={disabled}
            onClick={() => addToSequence(tile.id)}
            className={`${CHIP_BASE} border-black/10 bg-white text-[#1A1A24]/80 active:bg-black/[0.04]`}
          >
            <Markdown className="inline">{tile.md}</Markdown>
          </button>
        ))}
      </div>
    </div>
  );
}

function firstMismatchIndex(sequence: string[], target: string[]): number {
  const len = Math.max(sequence.length, target.length);
  for (let i = 0; i < len; i++) {
    if (sequence[i] !== target[i]) return i;
  }
  return -1;
}

// --- Dev fixture (schema v1.1 sanity check) ---------------------------------
// No tile drills exist in `lr_unit_content` yet (2026-08-07) — these two
// drills exist only to typecheck the shape against `Drill`/`Tile` and to
// eyeball rendering. Not imported or used by any app path.

export const DEV_TILE_DRILL_FIXTURES: Drill[] = [
  {
    id: "la_2_u1-p4-d1",
    prompt_md:
      "Tap på alle udtryk der er lig $\\det A$ for $A = \\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$",
    lens: "matrix",
    answer_type: "tiles",
    mode: "select",
    tiles: [
      { id: "t1", md: "$-2$", correct: true },
      { id: "t2", md: "$ad - bc$", correct: true },
      { id: "t3", md: "$2$", correct: false },
      { id: "t4", md: "$a d + b c$", correct: false },
      { id: "t5", md: "$1 \\cdot 4 - 2 \\cdot 3$", correct: true },
    ],
    hints: ["Udregn $ad - bc$ for $a=1, b=2, c=3, d=4$.", "$1\\cdot4 - 2\\cdot3 = 4 - 6 = -2$."],
    solution_md: "$\\det A = ad - bc = 1\\cdot4 - 2\\cdot3 = -2$.",
    difficulty: 1,
  },
  {
    id: "la_2_u1-p4-d2",
    prompt_md: "Byg Gauss-elimination-rækkefølgen for at nå frem til rækkeechelonform.",
    lens: "row",
    answer_type: "tiles",
    mode: "build",
    tiles: [
      { id: "t1", md: "$R_2 \\to R_2 - 3R_1$" },
      { id: "t2", md: "$R_1 \\leftrightarrow R_2$" },
      { id: "t3", md: "$R_3 \\to R_3 + R_1$" },
      { id: "t4", md: "$R_2 \\to \\tfrac{1}{2}R_2$" },
    ],
    answer: { sequence: ["t1", "t3", "t4"] },
    hints: ["Start med at eliminere første søjle under pivoten.", "Rækkefølgen er $R_2$, så $R_3$, så normalisér $R_2$."],
    solution_md: "Eliminér ind i $R_2$, så $R_3$, og normalisér til sidst med $R_2 \\to \\tfrac12 R_2$.",
    difficulty: 2,
  },
];
