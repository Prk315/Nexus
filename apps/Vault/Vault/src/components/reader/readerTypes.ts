// The reader document: ten pages of a book, each as the image the PDF draws
// plus the blocks that image is made of.
//
// Produced by scripts/reader-proto/extract.py + annotate.ts; see the header of
// extract.py for how a block gets its type. Coordinates are IMAGE PIXELS at the
// render scale (2x), so every position in this file is a ratio away from a CSS
// length: `left: bbox[0] / page.width * 100%`. Nothing here is measured at
// runtime, which is what lets the concept rail line up with the page without
// either component knowing the other's size.

import type { ConceptKind } from "./conceptDetect";

export type ReaderBlockType =
  | "paragraph"
  | "heading"
  | "math"
  | "figure"
  | "exercise"
  | "concept";

export interface ReaderBlock {
  id: string;
  type: ReaderBlockType;
  /** [x0, y0, x1, y1] in image pixels. */
  bbox: [number, number, number, number];
  text: string;
  html: string;
  /** Maths only, and a transcription rather than a source — see `latexIsTranscribed`. */
  latex?: string;
  /** Headings only: 1 chapter, 2 section, 3 subsection. */
  level?: number;
  /** The bold run that opens the block, before stage 2 parses it. */
  heading?: string;
  /** Filled by annotate.ts from `heading`: "Definisjon 3.3.1", "1.4.2", "Bevis". */
  label?: string;
  /** Filled by annotate.ts: "Binomialformelen", or absent for a bare label. */
  name?: string;
  /** Filled by annotate.ts. Present exactly on the blocks the concept rail lists. */
  concept?: ConceptKind;
  /** Median glyph size in image pixels — the data layer renders text at it. */
  fontSize?: number;
}

export interface ReaderPage {
  /** Position in this prototype's reading order. */
  n: number;
  /**
   * [x0, y0, x1, y1] of the sheet actually shown, in image pixels.
   *
   * Kalkulus's inner margin is about a quarter of the sheet, which next to a
   * concept rail is a gutter between a cue and the thing it names. The crop is
   * applied at RENDER — the PNG is whole and every bbox is still in full-sheet
   * coordinates, so re-cropping is a number in extract.py rather than ten
   * re-rendered images, and a bbox can never be stale with respect to it.
   */
  crop?: [number, number, number, number];
  /** 1-based page in the source PDF. */
  pdfPage: number;
  /** The number the book itself prints on the page. */
  printedPage: number;
  /** Why this page is one of the ten. */
  note?: string;
  image: string;
  width: number;
  height: number;
  blocks: ReaderBlock[];
}

export interface ReaderDoc {
  v: 1;
  title: string;
  author?: string;
  source: {
    pdf: string;
    pdfPages?: number;
    extractor: string;
    renderScale: number;
    /** Always true here: a PDF has no LaTeX in it, only positioned glyphs. */
    latexIsTranscribed?: boolean;
    generatedAt?: string;
  };
  pages: ReaderPage[];
}

/**
 * The whole contract between the four reader components.
 *
 * Spec §7: they talk to each other through this and the toggle state, and
 * through nothing else — no context, no refs handed sideways, no shared mutable
 * object. The point is not purity for its own sake: in the later surface model
 * each of these becomes a component with attributes, and an attribute is
 * exactly a prop that can be serialised. Anything that could not survive being
 * written down as an attribute does not belong in here.
 */
export interface ReaderView {
  pages: ReaderPage[];
  /** Index into `pages` of the page currently filling most of the viewport. */
  currentPage: number;
  /** Ids of the blocks intersecting the viewport, in document order. */
  visibleBlocks: string[];
  onNavigate: (pageIndex: number, blockId?: string) => void;
}

/** What the rails switch on and off. */
export interface ReaderToggles {
  outline: boolean;
  conceptRail: boolean;
  dataLayer: boolean;
}

/** Gap between pages, in px. Shared by the pages column and the concept rail. */
export const PAGE_GAP = 28;
/** Padding above the first page and below the last, in px. */
export const PAGE_PAD = 28;

/** The visible box of a page, in image pixels. The whole sheet when uncropped. */
export function pageView(page: ReaderPage): { x: number; y: number; w: number; h: number } {
  const c = page.crop;
  if (!c) return { x: 0, y: 0, w: page.width, h: page.height };
  return { x: c[0], y: c[1], w: c[2] - c[0], h: c[3] - c[1] };
}

/**
 * Where a block sits inside the VISIBLE box, as fractions of it.
 *
 * Every position in the reader goes through here: the data layer's outlines,
 * the concept rail's entries, the navigation target and the scroll reader's
 * idea of what is on screen. One function means a change to the crop moves all
 * five together — when this was four separate `bbox[1] / page.height`
 * expressions, cropping would have silently desynchronised the rail from the
 * page it labels, which is the one thing this layout cannot survive.
 */
export function blockFrac(page: ReaderPage, bbox: readonly number[]) {
  const v = pageView(page);
  return {
    left: (bbox[0] - v.x) / v.w,
    top: (bbox[1] - v.y) / v.h,
    width: (bbox[2] - bbox[0]) / v.w,
    height: (bbox[3] - bbox[1]) / v.h,
  };
}

/**
 * How tall a page renders at a given column width.
 *
 * The one piece of geometry every column agrees on. The concept rail lines its
 * entries up with the page purely by ratio — no measuring, no ref handed from
 * one component to another, no layout effect that has to run before the rail is
 * right. ReaderEditor uses the same function to work out which page the scroll
 * position is on, so the rail and the scroll maths cannot disagree.
 */
export function pageBoxHeight(page: ReaderPage, columnWidth: number): number {
  const v = pageView(page);
  return (columnWidth * v.h) / v.w;
}

/** Scroll offset of a page's top within the scroll container, in px. */
export function pageTop(pages: ReaderPage[], index: number, columnWidth: number): number {
  let top = PAGE_PAD;
  for (let i = 0; i < index && i < pages.length; i++) {
    top += pageBoxHeight(pages[i], columnWidth) + PAGE_GAP;
  }
  return top;
}
