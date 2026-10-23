// The pages themselves: the image the PDF draws, and the data layer over it.
//
// Spec §3: the page image is the visual truth. Every block the extractor found
// is present underneath it, and stays invisible until someone asks for it with
// `d` or the top rail. Nothing here is ever the primary reading surface — if
// the data layer and the image disagree, the image is right.
//
// The page carries no frame: no border, no shadow, no card. It sits on the same
// background as the outline and the rail so the three read as one page rather
// than as three panels — and the book's own margin is cropped away (see
// `pageView`) so the text starts where the rail ends.

import { memo } from "react";
import type { ReaderBlock, ReaderPage, ReaderView } from "./readerTypes";
import { PAGE_GAP, PAGE_PAD, blockFrac, pageBoxHeight, pageView } from "./readerTypes";

interface Props extends ReaderView {
  columnWidth: number;
  dataLayer: boolean;
  /** Block to flash after a rail or outline click. */
  highlightBlock: string | null;
  onCopyLatex: (block: ReaderBlock) => void;
  /** True when the JSON says its LaTeX was transcribed rather than parsed. */
  latexIsTranscribed: boolean;
}

/** Percent-of-VISIBLE-box position for a block, so the overlay follows the crop. */
function boxStyle(page: ReaderPage, block: ReaderBlock) {
  const f = blockFrac(page, block.bbox);
  return {
    left: `${f.left * 100}%`,
    top: `${f.top * 100}%`,
    width: `${f.width * 100}%`,
    height: `${f.height * 100}%`,
  };
}

export const ReaderPages = memo(function ReaderPages({
  pages, currentPage, columnWidth, dataLayer, highlightBlock,
  onCopyLatex, latexIsTranscribed,
}: Props) {
  return (
    <div
      className="reader-pages"
      style={{ width: columnWidth, paddingTop: PAGE_PAD, paddingBottom: PAGE_PAD }}
    >
      {pages.map((page, index) => {
        const height = pageBoxHeight(page, columnWidth);
        const view = pageView(page);
        // The crop is a window onto the whole PNG: scale the image so the
        // window is exactly the column width, then offset it by the window's
        // own origin. No second image, no re-render, and the bboxes below are
        // still in full-sheet coordinates.
        const scale = columnWidth / view.w;
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
              style={{
                width: page.width * scale,
                height: page.height * scale,
                marginLeft: -view.x * scale,
                marginTop: -view.y * scale,
              }}
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
                    style={boxStyle(page, block)}
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
                        style={{ fontSize: block.fontSize ? block.fontSize * scale : undefined }}
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
              return block ? <div className="rb-flash" style={boxStyle(page, block)} /> : null;
            })()}
          </figure>
        );
      })}
    </div>
  );
});
