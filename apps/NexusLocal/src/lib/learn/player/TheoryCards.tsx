/**
 * The theory rendering primitives, extracted from the former `TheoryStep.tsx`
 * when the Player moved from blocked steps (all theory → all practice → test)
 * to interleaved layers (LEARN_PLAN.md "Layered unit flow", DESIGN.md §9).
 *
 * There is no longer a single "theory step": each layer renders its own slice
 * of `theory[]` with these same cards, so the card internals live here and
 * `LayerStep.tsx` composes them. Nothing about the card itself changed —
 * `UnitOpening` is verbatim the old step's header + intro + lens-note block,
 * now shown once at the top of layer 1 instead of once per unit-as-one-page.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7.
 * v3 (2026-08-10): desktop reading layout — DESIGN.md §8 (unit header, chip
 * adjacency, recessed lens-note card).
 */

import { useState } from "react";
import type { Lens, TheoryBox, UnitContent } from "../types";
import { Markdown } from "../Markdown";
import { CARD, LENS } from "./tokens";

export function LensChip({ lens, on }: { lens: Lens; on?: boolean }) {
  const t = LENS[lens];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${
        on ? t.chipOn : t.chip
      }`}
    >
      <span className={`h-1 w-1 rounded-full ${t.dot}`} />
      {t.label}
    </span>
  );
}

const KIND_LABEL: Record<TheoryBox["kind"], string> = {
  definition: "DEFINITION",
  theorem: "SÆTNING",
  remark: "BEMÆRKNING",
};

export function TheoryCard({ box }: { box: TheoryBox }) {
  const [openLens, setOpenLens] = useState<Lens | null>(null);
  const translationKeys = (Object.keys(box.translations ?? {}) as Lens[]).filter(
    (l) => box.translations?.[l]
  );

  return (
    <div className={`relative overflow-hidden ${CARD} p-3 md:p-8`}>
      {/* Kind label and lens chip are one unit: typographic + chromatic
          halves of the same "what is this box" statement (DESIGN.md §8.4).
          They used to sit at opposite card edges, which at any width wider
          than a phone left the chip orphaned. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
          {KIND_LABEL[box.kind]}
        </span>
        {box.perspective && <LensChip lens={box.perspective} />}
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-[#1A1A24]/90 md:mt-3 md:text-xl md:tracking-[-0.005em]">
        {box.title}
      </h3>
      <Markdown className="mt-2 text-[15px] leading-relaxed text-[#1A1A24]/75 md:mt-4 md:text-[16.5px]">
        {box.statement_md}
      </Markdown>

      {translationKeys.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 md:mt-5">
          {translationKeys.map((l) => {
            const open = openLens === l;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setOpenLens(open ? null : l)}
                className={`inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
                  open ? LENS[l].chipOn : LENS[l].chip
                }`}
              >
                <span className={`h-1 w-1 rounded-full ${LENS[l].dot}`} />
                Se i {LENS[l].long.toLowerCase()}
                <span
                  className={`ml-0.5 inline-block transition-transform duration-200 ${
                    open ? "rotate-90" : ""
                  }`}
                >
                  ›
                </span>
              </button>
            );
          })}
        </div>
      )}

      {translationKeys.map((l) => {
        const open = openLens === l;
        return (
          <div
            key={l}
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div
                className={`mt-2 rounded-r-lg py-2 pl-3 pr-2 md:mt-3 md:py-4 md:pl-6 md:pr-5 ${LENS[l].edge} ${LENS[l].tint}`}
              >
                <Markdown className="text-[13px] leading-relaxed text-[#1A1A24]/75 md:text-[15px]">
                  {box.translations?.[l] ?? ""}
                </Markdown>
              </div>
            </div>
          </div>
        );
      })}

      {box.connect_md && (
        <div className="mt-2 flex gap-1.5 text-[12px] italic leading-relaxed text-[#6E6E78]/80 md:mt-6 md:border-t md:border-black/[0.06] md:pt-5 md:text-[13.5px]">
          <span className="not-italic text-[#6E6E78]/50">↳</span>
          <Markdown className="flex-1 text-[12px] leading-relaxed md:text-[13.5px]">{box.connect_md}</Markdown>
        </div>
      )}
    </div>
  );
}

/**
 * The unit's opening: display title + meta row, the `intro_md` card with its
 * gradient rail, and the three-perspectives lens note. Rendered once, at the
 * top of layer 1 — it introduces the *unit*, not the layer.
 */
export function UnitOpening({ content }: { content: UnitContent }) {
  const perspectives = Array.from(
    new Set(content.theory.map((t) => t.perspective).filter((l): l is Lens => l !== null))
  );
  const drillCount = content.practice.reduce((n, g) => n + g.drills.length, 0);

  return (
    <>
      {/* The intro used to open cold with a wall of prose and no title of its
          own (the only title was the truncated chrome label in the overlay
          header). DESIGN.md §8.4. */}
      <header className="md:pb-2">
        <h1 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.015em] text-[#1A1A24] md:text-[34px]">
          {content.title || content.unit_code}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 md:mt-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
            {content.unit_code}
          </span>
          <span className="text-[10px] text-[#6E6E78]/40">·</span>
          <span className="text-[11px] text-[#6E6E78] md:text-[12px]">{content.est_minutes} min</span>
          <span className="text-[10px] text-[#6E6E78]/40">·</span>
          <span className="text-[11px] text-[#6E6E78] md:text-[12px]">
            {content.theory.length} boxes · {drillCount} drills
          </span>
          {perspectives.length > 0 && (
            <span className="ml-0.5 flex flex-wrap gap-1">
              {perspectives.map((l) => (
                <LensChip key={l} lens={l} />
              ))}
            </span>
          )}
        </div>
      </header>

      <div className={`relative overflow-hidden ${CARD} p-3 pl-4 md:p-8 md:pl-10`}>
        <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-indigo-500 to-fuchsia-600" />
        <Markdown className="learn-md-lead text-[15px] leading-relaxed text-[#1A1A24]/75 md:text-[16.5px]">
          {content.intro_md}
        </Markdown>
      </div>

      {/* The lens note is the unit's thesis, not another theory box — so it is
          recessed rather than raised, and carries a three-stop bar that *is*
          the three perspectives (DESIGN.md §8.5). */}
      <div className="relative overflow-hidden rounded-xl border border-black/[0.05] bg-black/[0.025] p-3 md:rounded-2xl md:p-8">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500" />
        <h3 className="text-[13px] font-semibold text-[#1A1A24] md:text-[18px] md:tracking-[-0.005em]">
          The three perspectives
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5 md:mt-3">
          {(["row", "matrix", "column"] as Lens[]).map((l) => (
            <LensChip key={l} lens={l} />
          ))}
        </div>
        <Markdown className="mt-2.5 text-[13px] leading-relaxed text-[#1A1A24]/75 md:mt-4 md:text-[15.5px]">
          {content.lens_note_md}
        </Markdown>
      </div>
    </>
  );
}
