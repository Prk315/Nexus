/**
 * Theory step (`Player.tsx` §3.3): intro, the unit's lens thesis, then one
 * card per `theory[]` box with per-lens translation fold-outs.
 *
 * Renders its own `<main>` + `<footer>` — `Player.tsx` swaps this whole
 * fragment in for the current step rather than owning a single shared dock,
 * since the dock content differs too much between steps to share a shell.
 *
 * v2 (2026-08-07): soft-white "paper" theme — DESIGN.md §7.
 */

import { useState } from "react";
import type { Lens, TheoryBox, UnitContent } from "../types";
import { Markdown } from "../Markdown";
import { LENS } from "./tokens";

function LensChip({ lens, on }: { lens: Lens; on?: boolean }) {
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

function TheoryCard({ box }: { box: TheoryBox }) {
  const [openLens, setOpenLens] = useState<Lens | null>(null);
  const translationKeys = (Object.keys(box.translations ?? {}) as Lens[]).filter(
    (l) => box.translations?.[l]
  );

  return (
    <div className="relative overflow-hidden rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78]/70">
          {KIND_LABEL[box.kind]}
        </span>
        {box.perspective && <LensChip lens={box.perspective} />}
      </div>
      <h3 className="mt-1 text-[15px] font-semibold leading-snug text-[#1A1A24]/90">{box.title}</h3>
      <Markdown className="prose-learn mt-2 text-[15px] leading-relaxed text-[#1A1A24]/75">
        {box.statement_md}
      </Markdown>

      {translationKeys.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
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
              <div className={`mt-2 rounded-r-lg py-2 pl-3 pr-2 ${LENS[l].edge} ${LENS[l].tint}`}>
                <Markdown className="text-[13px] leading-relaxed text-[#1A1A24]/75">
                  {box.translations?.[l] ?? ""}
                </Markdown>
              </div>
            </div>
          </div>
        );
      })}

      {box.connect_md && (
        <p className="mt-2 text-[12px] italic leading-relaxed text-[#6E6E78]/80">
          <span className="mr-1 not-italic text-[#6E6E78]/50">↳</span>
          {box.connect_md}
        </p>
      )}
    </div>
  );
}

export function TheoryStep({
  content,
  onContinue,
}: {
  content: UnitContent;
  onContinue: () => void;
}) {
  const perspectives = Array.from(
    new Set(content.theory.map((t) => t.perspective).filter((l): l is Lens => l !== null))
  );

  return (
    <>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-40">
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-xl border border-black/[0.06] bg-white p-3 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
            <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-indigo-500 to-fuchsia-600" />
            <Markdown className="text-[15px] leading-relaxed text-[#1A1A24]/75">{content.intro_md}</Markdown>
          </div>

          <div className="rounded-xl bg-black/[0.02] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[#1A1A24]/85">The three perspectives</h3>
              <div className="flex gap-1">
                {(["row", "matrix", "column"] as Lens[]).map((l) => (
                  <LensChip key={l} lens={l} />
                ))}
              </div>
            </div>
            <Markdown className="mt-2 text-[13px] leading-relaxed text-[#1A1A24]/70">
              {content.lens_note_md}
            </Markdown>
          </div>

          {content.theory.map((box) => (
            <TheoryCard key={box.concept_id + box.title} box={box} />
          ))}
        </div>
      </main>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex flex-col gap-2">
          <p className="text-center text-[10px] text-[#6E6E78]/60">
            {content.theory.length} boxes · {perspectives.length} perspectives
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.985]"
          >
            Practice →
          </button>
        </div>
      </footer>
    </>
  );
}
