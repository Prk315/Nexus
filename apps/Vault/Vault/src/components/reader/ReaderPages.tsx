// The pages themselves: the image the PDF draws, and the data layer over it.
//
// Spec §3: the page image is the visual truth. Every block the extractor found
// is present underneath it, and stays invisible until someone asks for it with
// `d` or the top rail. Nothing here is ever the primary reading surface — if
// the data layer and the image disagree, the image is right.

import { memo } from "react";
import type { ReaderBlock, ReaderView } from "./readerTypes";
import { PAGE_GAP, PAGE_PAD, pageBoxHeight } from "./readerTypes";

interface Props extends ReaderView {
  columnWidth: number;
  dataLayer: boolean;
  /** Block to flash after a rail or outline click. */
  highlightBlock: string | null;
  onCopyLatex: (block: ReaderBlock) => void;
  /** True when the JSON says its LaTeX was transcribed rather than parsed. */
  latexIsTranscribed: boolean;
}

/** Percent-of-page box for a block, so the overlay scales with the image. */
function boxStyle(block: ReaderBlock, w: number, h: number) {
  const [x0, y0, x1, y1] = block.bbox;
  return {
    left: `${(x0 / w) * 100}%`,
    top: `${(y0 / h) * 100}%`,
    width: `${((x1 - x0) / w) * 100}%`,
    height: `${((y1 - y0) / h) * 100}%`,
  };
}

export const ReaderPages = memo(function ReaderPages({
  pages, currentPage, onNavigate, columnWidth, dataLayer, highlightBlock,
  onCopyLatex, latexIsTranscribed,
}: Props) {
  return (
    <div
      className="reader-pages"
      style={{ width: columnWidth, paddingTop: PAGE_PAD, paddingBottom: PAGE_PAD }}
    >
      {pages.map((page, index) => {
        const height = pageBoxHeight(page, columnWidth);
        return (
          <figure
            key={page.pdfPage}
            className={`reader-page${index === currentPage ? " is-current" : ""}`}
            style={{ height, marginBottom: index === pages.length - 1 ? 0 : PAGE_GAP }}
            aria-label={`Side ${page.printedPage}`}
          >
            <img
              className="reader-page-img"
              src={page.image}
              alt={`Kalkulus side ${page.printedPage}`}
              width={page.width}
              height={page.height}
              // The pages below the fold are 200 kB each and there are ten of
              // them; the first two carry the opening of the reading order.
              loading={index < 2 ? "eager" : "lazy"}
              decoding="async"
              draggable={false}
            />

            {dataLayer && (
              <div className="reader-data" aria-label="Datalag">
                {page.blocks.map((block) => (
                  <div
                    key={block.id}
                    className="rb"
                    data-type={block.type}
                    style={boxStyle(block, page.width, page.height)}
                  >
                    <span className="rb-type">
                      {block.label ?? (block.type === "heading" ? `h${block.level ?? 2}` : block.type)}
                    </span>
                    {block.text && (
                      <div
                        className="rb-text"
                        // Set at the block's OWN glyph size so the selectable
                        // copy lands roughly on the printed words rather than
                        // at some CSS default two sizes off.
                        style={{
                          fontSize: block.fontSize
                            ? (block.fontSize / page.width) * columnWidth
                            : undefined,
                        }}
                      >
                        {block.text}
                      </div>
                    )}
                    {block.latex && (
                      <button
                        type="button"
                        className="rb-copy"
                        onClick={() => onCopyLatex(block)}
                        title={
                          latexIsTranscribed
                            ? `Kopier LaTeX (transkribert fra glyfer — les den over)\n\n${block.latex}`
                            : block.latex
                        }
                      >
                        LaTeX{latexIsTranscribed ? " *" : ""}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Lives outside the data layer: a rail click must show you where it
                went whether or not the data layer happens to be open. */}
            {highlightBlock && (() => {
              const block = page.blocks.find((b) => b.id === highlightBlock);
              return block ? (
                <div className="rb-flash" style={boxStyle(block, page.width, page.height)} />
              ) : null;
            })()}

            <figcaption className="reader-page-folio">
              <button type="button" onClick={() => onNavigate(index)} title={page.note ?? ""}>
                s. {page.printedPage}
              </button>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
});
