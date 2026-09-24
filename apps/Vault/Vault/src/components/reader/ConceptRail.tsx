// The Cornell concept rail: a thin column immediately left of the page, with
// one entry per concept block, standing at that block's own height. Spec §4.
//
// It scrolls WITH the pages rather than sitting still, because the whole idea
// is that a concept's name is beside the concept. A sticky rail would have to
// re-derive its positions on every scroll frame; this one is laid out once, in
// CSS, from ratios — each page's box is exactly as tall as the page renders,
// and an entry sits at `blockFrac(...).top` down it. Nothing measures anything,
// so nothing can be one frame behind.
//
// Every kind is listed, always. The rail carried four filter chips for one
// round and they were the wrong shape for this surface twice over: a control
// at the top of a column whose whole job is to be scanned quietly, and a
// default that HID half the concepts on the page — a rail that silently omits
// the examples is worse than no rail, because it reads as complete. The kinds
// are still told apart, by weight and by the shape of the tick, which costs no
// space and needs no explaining.

import { memo } from "react";
import { blockConcept } from "./readerOutline";
import type { ReaderView } from "./readerTypes";
import { PAGE_GAP, PAGE_PAD, blockFrac, pageBoxHeight } from "./readerTypes";

interface Props extends ReaderView {
  columnWidth: number;
}

export const ConceptRail = memo(function ConceptRail({
  pages, currentPage, visibleBlocks, onNavigate, columnWidth,
}: Props) {
  const seen = new Set(visibleBlocks);

  return (
    <div className="reader-rail" style={{ paddingTop: PAGE_PAD, paddingBottom: PAGE_PAD }}>
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
            if (!concept) return null;
            return (
              <button
                key={block.id}
                type="button"
                className={`rail-entry${seen.has(block.id) ? " is-visible" : ""}`}
                data-kind={concept.kind}
                // The entry's TOP is pinned to the block's top, not centred on
                // it: a Cornell cue answers "what starts here", and a centred
                // label on a half-page theorem points at the middle of a proof.
                style={{ top: `${blockFrac(page, block.bbox).top * 100}%` }}
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
