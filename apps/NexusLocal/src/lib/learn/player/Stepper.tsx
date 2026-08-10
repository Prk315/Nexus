/**
 * The Player's progress stepper — DESIGN.md §3.2 (gradient-fill language) and
 * §9 (layered anatomy).
 *
 * Was three fixed segments (Theory · Practice · Test); the layered flow makes
 * it N: one numbered segment per layer, one distinct segment for the rapid
 * round (identified by a tap/tile glyph, not a word), and the test.
 *
 * Reading at phone width with ~6 segments is the constraint that shapes it:
 * inactive segments carry a **glyph or a number**, never a word, plus their
 * solved count in tabular numerals; only the active segment spends horizontal
 * space on a label, and it takes the extra width from its neighbours
 * (`flex-[1.7]`) rather than wrapping. Full text lives in `aria-label`/`title`
 * for anyone who needs it.
 *
 * The bar itself is unchanged from §3.2: a 3 px track that fills with the
 * indigo→fuchsia gradient. For layer and rapid-round segments the fill is that
 * step's *solved-drill ratio*, so a step you walked through without solving
 * anything honestly reads as empty. The test keeps §3.2's locked cue — a
 * dashed ring on an unfilled track — and stays non-tappable until
 * `unlock_ratio` is met.
 */

export interface StepSegment {
  kind: "layer" | "final" | "test";
  /** Shown only while this segment is active. */
  label: string;
  /** Layer number, for the compact inactive glyph. */
  number?: number;
  fillPct: number;
  reachable: boolean;
  /** Test only: the §3.2 dashed-track lock cue. */
  locked?: boolean;
  /** `[solved, total]` drills owned by this step. */
  solved?: [number, number];
}

function TileGlyph() {
  return (
    <span className="grid grid-cols-2 gap-[2px]" aria-hidden="true">
      <span className="block h-[3px] w-[3px] rounded-[1px] bg-current" />
      <span className="block h-[3px] w-[3px] rounded-[1px] bg-current" />
      <span className="block h-[3px] w-[3px] rounded-[1px] bg-current" />
      <span className="block h-[3px] w-[3px] rounded-[1px] bg-current" />
    </span>
  );
}

export function Stepper({
  segments,
  activeIdx,
  onSelect,
}: {
  segments: StepSegment[];
  activeIdx: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="mt-2 flex gap-1.5">
      {segments.map((s, i) => {
        const active = i === activeIdx;
        const tone = active
          ? "text-[#1A1A24]/85"
          : s.reachable
            ? "text-[#6E6E78]"
            : "text-[#6E6E78]/40";
        const full = s.solved ? `${s.label} — ${s.solved[0]}/${s.solved[1]} drills solved` : s.label;
        return (
          <button
            key={`${s.kind}-${i}`}
            type="button"
            disabled={!s.reachable}
            onClick={() => onSelect(i)}
            aria-current={active ? "step" : undefined}
            aria-label={full}
            title={full}
            className={`group flex min-h-[44px] min-w-0 flex-col justify-center text-left ${
              active ? "flex-[1.7]" : "flex-1"
            }`}
          >
            <span
              className={`block h-[3px] w-full overflow-hidden rounded-full ${
                s.locked
                  ? "bg-black/[0.04] ring-1 ring-dashed ring-black/10"
                  : active
                    ? "bg-black/[0.12]"
                    : "bg-black/[0.07]"
              }`}
            >
              <span
                className="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
                style={{ width: `${s.fillPct}%` }}
              />
            </span>
            <span
              className={`mt-1 flex min-w-0 items-center gap-1 whitespace-nowrap text-[10px] tracking-wide ${tone}`}
            >
              {active ? (
                <span className="truncate">{s.label}</span>
              ) : s.kind === "final" ? (
                <TileGlyph />
              ) : (
                <span className="font-medium tabular-nums">{s.kind === "test" ? "T" : s.number}</span>
              )}
              {s.solved && s.solved[1] > 0 && (
                <span className="tabular-nums text-[9px] opacity-65">
                  {s.solved[0]}/{s.solved[1]}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
