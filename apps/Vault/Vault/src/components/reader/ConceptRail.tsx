// The Cornell concept rail: a thin column immediately left of the page, with
// one entry per concept block, standing at that block's own height. Spec §4.
//
// It scrolls WITH the pages rather than sitting still, because the whole idea
// is that a concept's name is beside the concept. A sticky rail would have to
// re-derive its positions on every scroll frame; this one is laid out once, in
// CSS, from ratios — each page's box is exactly as tall as the page renders,
// and an entry sits at `bbox.top / page.height` down it. Nothing measures
// anything, so nothing can be one frame behind.

import { memo } from "react";
import { blockConcept } from "./readerOutline";
import type { ConceptFilter, ReaderView } from "./readerTypes";
import { PAGE_GAP, PAGE_PAD, pageBoxHeight } from "./readerTypes";
import type { ConceptKind } from "./conceptDetect";

interface Props extends ReaderView {
  columnWidth: number;
  filter: ConceptFilter;
  onFilterChange: (next: ConceptFilter) => void;
}

const FILTER_LABELS: Array<[ConceptKind, string]> = [
  ["definition", "Def"],
  ["theorem", "Setn"],
  ["example", "Eks"],
  ["proof", "Bevis"],
];

export const ConceptRail = memo(function ConceptRail({
  pages, currentPage, visibleBlocks, onNavigate, columnWidth, filter, onFilterChange,
}: Props) {
  const seen = new Set(visibleBlocks);

  return (
    <div className="reader-rail" style={{ paddingTop: PAGE_PAD, paddingBottom: PAGE_PAD }}>
      <div className="reader-rail-filter" role="group" aria-label="Begrepsfilter">
        {FILTER_LABELS.map(([kind, short]) => (
          <button
            key={kind}
            type="button"
            className={`rail-chip${filter[kind] ? " is-on" : ""}`}
            aria-pressed={filter[kind]}
            onClick={() => onFilterChange({ ...filter, [kind]: !filter[kind] })}
          >
            {short}
          </button>
        ))}
      </div>

      {pages.map((page, index) => (
        <div
          key={page.pdfPage}
          className={`rail-page${index === currentPage ? " is-current" : ""}`}
          style={{
            height: pageBoxHeight(page, columnWidth),
            marginBottom: index === pages.length - 1 ? 0 : PAGE_GAP,
          }}
        >
          {page.blocks.map((block) => {
            if (block.type !== "concept") return null;
            const concept = blockConcept(block);
            if (!concept || !filter[concept.kind]) return null;
            return (
              <button
                key={block.id}
                type="button"
                className={`rail-entry${seen.has(block.id) ? " is-visible" : ""}`}
                data-kind={concept.kind}
                // The entry's TOP is pinned to the block's top, not centred on
                // it: a Cornell cue answers "what starts here", and a centred
                // label on a half-page theorem points at the middle of a proof.
                style={{ top: `${(block.bbox[1] / page.height) * 100}%` }}
                onClick={() => onNavigate(index, block.id)}
                title={`${block.label ?? ""}${block.name ? ` — ${block.name}` : ""} · s. ${page.printedPage}`}
              >
                <span className="rail-entry-tick" aria-hidden="true" />
                <span className="rail-entry-text">{concept.title}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});
