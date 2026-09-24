// The two thin grey lines that are, for now, the reader's entire chrome.
// Spec §6: a line down the left edge and one across the top. The header bar
// comes later, so nothing here grows into one — the top rail holds the data
// layer toggle and nothing else.
//
// The left rail is two segments of one line rather than two buttons, because
// the line IS the affordance: it shows where the columns would be, and a
// segment that is currently "on" is the column's own edge.

import { memo } from "react";
import type { ReaderToggles } from "./readerTypes";

interface Props {
  toggles: ReaderToggles;
  onToggle: (key: keyof ReaderToggles) => void;
  /** Shown on the top rail: which page is in view, and how many there are. */
  currentPage: number;
  pageCount: number;
  printedPage?: number;
  title: string;
}

export const ToggleRails = memo(function ToggleRails({
  toggles, onToggle, currentPage, pageCount, printedPage, title,
}: Props) {
  return (
    <>
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

      <div className="reader-leftrail" role="group" aria-label="Kolonner">
        <button
          type="button"
          className={`leftrail-seg${toggles.outline ? " is-on" : ""}`}
          aria-pressed={toggles.outline}
          onClick={() => onToggle("outline")}
          title="Innholdsoversikt"
        >
          <span className="leftrail-seg-label">innhold</span>
        </button>
        <button
          type="button"
          className={`leftrail-seg${toggles.conceptRail ? " is-on" : ""}`}
          aria-pressed={toggles.conceptRail}
          onClick={() => onToggle("conceptRail")}
          title="Begrepsspalte"
        >
          <span className="leftrail-seg-label">begrep</span>
        </button>
      </div>
    </>
  );
});
