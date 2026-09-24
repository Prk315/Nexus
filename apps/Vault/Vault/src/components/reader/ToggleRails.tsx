// The two thin grey lines that are, for now, the reader's entire chrome.
// Spec §6: a line across the top, and a line beside the columns. The header bar
// comes later, so nothing here grows into one — the top rail holds the data
// layer toggle and nothing else.
//
// The column rail moved off the window's left edge to sit BETWEEN the outline
// and the concept rail. On the edge it was a control bar bounding the reader;
// between the columns it is the seam the two columns fold along, and the
// segment that is "on" reads as that column's own edge. It is one component
// rendered in two places rather than two components, because a segment's state
// and the top rail's state are the same state.

import { memo } from "react";
import type { ReaderToggles } from "./readerTypes";

interface Props {
  toggles: ReaderToggles;
  onToggle: (key: keyof ReaderToggles) => void;
  /** Which of the two lines to draw. They live in different parts of the tree. */
  slot: "top" | "column";
  /** Top slot only: which page is in view, and how many there are. */
  currentPage?: number;
  pageCount?: number;
  printedPage?: number;
  title?: string;
}

export const ToggleRails = memo(function ToggleRails({
  toggles, onToggle, slot, currentPage = 0, pageCount = 0, printedPage, title,
}: Props) {
  if (slot === "top") {
    return (
      <div className="reader-toprail">
        <span className="toprail-title">{title}</span>
        <span className="toprail-where">
          {printedPage != null ? `s. ${printedPage}` : ""}
          <span className="toprail-of"> · {currentPage + 1}/{pageCount}</span>
        </span>
        <button
          type="button"
          className={`toprail-seg${toggles.dataLayer ? " is-on" : ""}`}
          aria-pressed={toggles.dataLayer}
          onClick={() => onToggle("dataLayer")}
          // The key is scoped to the reader's focused container, so saying so
          // here is the only place a reader finds out it exists.
          title="Vis datalaget over siden (d)"
        >
          data<kbd>d</kbd>
        </button>
      </div>
    );
  }

  // One segment, not two. The outline and the concept rail became one column,
  // and the outline is raised by hover and focus rather than by a switch — so
  // there is exactly one thing left to turn on and off here.
  return (
    <div className="reader-colrail">
      <button
        type="button"
        className={`colrail-seg${toggles.column ? " is-on" : ""}`}
        aria-pressed={toggles.column}
        onClick={() => onToggle("column")}
        title="Begreper og innhold"
      />
    </div>
  );
});
