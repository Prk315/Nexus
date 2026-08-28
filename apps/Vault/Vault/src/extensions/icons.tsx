// One icon set, on one grid.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// The toolbar used 51 distinct Unicode strings across 55 actions, drawn from
// half a dozen unrelated blocks: box drawing (▥ ▤ ▭), arrows (⤒ ⇤ ⤴), emoji
// (🖼 🔗 🖊, which render in COLOUR and at a different weight to everything
// around them), mathematical alphanumerics (ᴀ 𝖠 𝗔, three different fonts), and
// short strings pretending to be glyphs (`⤒row`, `−col`, `+▥`).
//
// Two of them were outright ambiguous rather than merely inconsistent: `⌄` was
// BOTH "fold this heading" and "unfold everything", and `▭` was all four
// container styles as well as one note width.
//
// ── The rules ──────────────────────────────────────────────────────────────
//
// Every icon is a 24×24 viewBox, `currentColor`, stroke 1.75, round caps and
// joins, no fills except where a shape must read as solid. That is what makes
// them look like one set: at 14px on a toolbar, stroke weight is most of what
// the eye compares, and it is the one property a Unicode glyph gives you no
// control over.
//
// ⚠️ SIZE is a prop, never a class. These sit in a 13px toolbar button, a menu
// row and the slash list, and an icon that inherits `font-size` from three
// different places is three different sizes. Passing it makes the caller state
// what it wants.
//
// The families where several actions share one icon — card colours, text
// colours, font faces, code languages — do so deliberately: the swatch or the
// face IS the differentiator, and the label carries the rest. `iconCoverage`
// tests that no OTHER pair collides.

export type IconName =
  | "bold" | "italic" | "underline" | "strike" | "code"
  | "paragraph" | "h1" | "h2" | "h3" | "h4" | "title"
  | "bulletList" | "orderedList" | "taskList"
  | "quote" | "codeBlock" | "divider" | "toggle"
  | "note" | "info" | "warn" | "success" | "danger"
  | "container" | "swatch" | "share" | "copy" | "unshare"
  | "columns" | "columnAdd" | "columnRemove" | "unwrap"
  | "image" | "sketch" | "link" | "highlighter" | "unhighlight" | "palette" | "database"
  | "alignLeft" | "alignCenter" | "alignRight"
  | "font" | "textColor" | "textSmall" | "textNormal" | "textLarge"
  | "pageTextSmall" | "pageTextNormal" | "pageTextLarge"
  | "mathInline" | "mathBlock"
  | "table" | "rowAbove" | "rowBelow" | "rowRemove"
  | "colBefore" | "colAfter" | "colRemove"
  | "headerRow" | "headerCol" | "merge" | "repair" | "trash"
  | "language" | "widthAuto" | "widthWide" | "widthFull"
  | "listView" | "boardView" | "tableView"
  | "foldOne" | "foldAll" | "unfoldAll"
  | "undo" | "redo";

/**
 * Path data per icon. Kept as raw `d` strings rather than JSX so the whole set
 * is one screenful and a new icon is one line — the alternative is 70 tiny
 * components and no way to see the family at a glance.
 *
 * `T` marks a text label drawn instead of paths, for the ones where a letter
 * genuinely IS the clearest symbol (B, I, H1). Those still inherit the same
 * box and colour, so they sit on the grid with the rest.
 */
type Spec = { d?: string[]; t?: string; fill?: string[] };

const I: Record<IconName, Spec> = {
  bold: { t: "B" }, italic: { t: "I" }, underline: { t: "U" }, strike: { t: "S" },
  code: { d: ["M9 8 L4 12 L9 16", "M15 8 L20 12 L15 16"] },

  paragraph: { d: ["M13 4 v16", "M17 4 v16", "M13 4 H9 a5 5 0 0 0 0 10 h4"] },
  h1: { t: "H1" }, h2: { t: "H2" }, h3: { t: "H3" }, h4: { t: "H4" },
  title: { d: ["M4 6 h16", "M12 6 v12"] },

  bulletList: { d: ["M9 7h11", "M9 12h11", "M9 17h11"], fill: ["M4.6 7a1.1 1.1 0 1 0 0-.01Z", "M4.6 12a1.1 1.1 0 1 0 0-.01Z", "M4.6 17a1.1 1.1 0 1 0 0-.01Z"] },
  orderedList: { d: ["M9 7h11", "M9 12h11", "M9 17h11", "M4 5.5 5 5v3.2", "M3.6 11.2a1 1 0 1 1 1.6 1.2L3.6 14h2"] },
  taskList: { d: ["M11 7h9", "M11 12h9", "M11 17h9", "M3.5 7l1.4 1.4L7.8 5.6"] },

  quote: { d: ["M5 5 v14", "M10 8h9", "M10 12h9", "M10 16h5"] },
  codeBlock: { d: ["M3.5 5h17v14h-17z", "M9 10 L6.5 12 L9 14", "M15 10 L17.5 12 L15 14"] },
  divider: { d: ["M3 12h18"] },
  toggle: { d: ["M9 6 L14.5 12 L9 18"] },

  note: { d: ["M4 5h16v14H4z", "M8 10h8", "M8 14h5"] },
  info: { d: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M12 11v5.5"], fill: ["M12 7.2a1.05 1.05 0 1 0 0-.01Z"] },
  warn: { d: ["M12 4 L21 19.5 H3 z", "M12 10v4"], fill: ["M12 17a1.05 1.05 0 1 0 0-.01Z"] },
  success: { d: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M7.8 12.2 L10.8 15.2 L16.2 9.4"] },
  danger: { d: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M9 9l6 6", "M15 9l-6 6"] },

  container: { d: ["M3.5 5.5h17v13h-17z"] },
  swatch: { fill: ["M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z"] },
  share: { d: ["M8 8 H5 v11 h11 v-3", "M11 13 L20 4", "M14 4h6v6"] },
  copy: { d: ["M9 9h11v11H9z", "M5 15H4V4h11v1"] },
  unshare: { d: ["M8 8 H5 v11 h11 v-3", "M12 12 L20 4", "M14 4h6v6", "M4 4 L20 20"] },

  columns: { d: ["M3.5 5.5h17v13h-17z", "M9.2 5.5v13", "M14.8 5.5v13"] },
  columnAdd: { d: ["M3.5 5.5h17v13h-17z", "M12 5.5v13", "M16.5 12h4", "M18.5 10v4"] },
  columnRemove: { d: ["M3.5 5.5h17v13h-17z", "M12 5.5v13", "M16.5 12h4"] },
  unwrap: { d: ["M7 14 L12 9 L17 14", "M12 9 v11", "M4 4h16"] },

  image: { d: ["M3.5 5.5h17v13h-17z", "M3.5 15.5 L9 10.5 L14 15", "M13.5 13.5 L16 11.5 L20.5 15"], fill: ["M15.6 9.4a1.3 1.3 0 1 0 0-.01Z"] },
  sketch: { d: ["M4 20 L5.5 15.5 L16.5 4.5 L19.5 7.5 L8.5 18.5 z", "M14.5 6.5 L17.5 9.5"] },
  link: { d: ["M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.7 6.6", "M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.4-1.4"] },
  highlighter: { d: ["M4 20h6", "M7 16.5 L15.5 8 L18 10.5 L9.5 19 H7 z", "M13.5 6 L17 2.5 L21.5 7 L18 10.5"] },
  // ⚠️ Its own icon rather than sharing `highlighter`. "Apply the key
  // highlighter" and "remove all highlighting" are opposite actions, and one
  // glyph for both is exactly the `⌄` bug — the coverage test named it here too.
  unhighlight: { d: ["M4 20h6", "M7 16.5 L15.5 8 L18 10.5 L9.5 19 H7 z", "M13.5 6 L17 2.5 L21.5 7 L18 10.5", "M3 3 L21 21"] },
  palette: { d: ["M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.6-.7 1.6-1.5 0-1.3-1-1.6-1-2.6 0-.9.7-1.5 1.7-1.5H16a4.5 4.5 0 0 0 4.5-4.5c0-4-3.8-6.9-8.5-6.9z"], fill: ["M7.6 11.4a1.15 1.15 0 1 0 0-.01Z", "M11 8.2a1.15 1.15 0 1 0 0-.01Z", "M15.4 9.8a1.15 1.15 0 1 0 0-.01Z"] },

  database: { d: ["M4.5 6.5c0-1.4 3.4-2.5 7.5-2.5s7.5 1.1 7.5 2.5-3.4 2.5-7.5 2.5-7.5-1.1-7.5-2.5z", "M4.5 6.5v11c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-11", "M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"] },

  alignLeft: { d: ["M4 6h16", "M4 10h10", "M4 14h16", "M4 18h10"] },
  alignCenter: { d: ["M4 6h16", "M7 10h10", "M4 14h16", "M7 18h10"] },
  alignRight: { d: ["M4 6h16", "M10 10h10", "M4 14h16", "M10 18h10"] },

  font: { t: "Aa" },
  textColor: { d: ["M6 15 L12 4 L18 15", "M8.2 11.5h7.6", "M4 20h16"] },
  textSmall: { d: ["M8 15 L12 7 L16 15", "M9.5 12.5h5"] },
  textNormal: { d: ["M6.5 17 L12 5 L17.5 17", "M8.7 12.5h6.6"] },
  textLarge: { d: ["M5 19 L12 3 L19 19", "M8 13h8"] },

  // ⚠️ Distinct from textSmall/Normal/Large, and the coverage test is why.
  // Inline text size and the PER-NOTE text size are two different features and
  // had the same three icons — the same class of ambiguity as `⌄` meaning both
  // "fold this" and "unfold everything". The page outline is the difference.
  pageTextSmall: { d: ["M5.5 3.5h13v17h-13z", "M9.5 15 L12 9 L14.5 15", "M10.5 13h3"] },
  pageTextNormal: { d: ["M5.5 3.5h13v17h-13z", "M8.5 16 L12 7 L15.5 16", "M9.9 12.8h4.2"] },
  pageTextLarge: { d: ["M5.5 3.5h13v17h-13z", "M7.5 17.5 L12 5.5 L16.5 17.5", "M9.3 13h5.4"] },

  mathInline: { d: ["M4 12h4l2.5 6 4-14H20"] },
  mathBlock: { d: ["M17 5H6l6 7-6 7h11"] },

  table: { d: ["M3.5 5.5h17v13h-17z", "M3.5 10h17", "M3.5 14.5h17", "M9.5 5.5v13", "M15 5.5v13"] },
  rowAbove: { d: ["M3.5 11h17v7.5h-17z", "M12 3v5", "M9.5 5.5 L12 3 L14.5 5.5"] },
  rowBelow: { d: ["M3.5 5.5h17V13h-17z", "M12 21v-5", "M9.5 18.5 L12 21 L14.5 18.5"] },
  rowRemove: { d: ["M3.5 9h17v6h-17z", "M8 4 L16 4", "M8 20 L16 20"] },
  colBefore: { d: ["M11 3.5v17h7.5v-17z", "M3 12h5", "M5.5 9.5 L3 12 L5.5 14.5"] },
  colAfter: { d: ["M5.5 3.5h7.5v17H5.5z", "M21 12h-5", "M18.5 9.5 L21 12 L18.5 14.5"] },
  colRemove: { d: ["M9 3.5h6v17H9z", "M4 8v8", "M20 8v8"] },
  headerRow: { d: ["M3.5 5.5h17v13h-17z", "M3.5 10h17", "M9.5 10v8.5", "M15 10v8.5"], fill: ["M3.5 5.5h17V10h-17z"] },
  headerCol: { d: ["M3.5 5.5h17v13h-17z", "M9.5 5.5v13", "M9.5 10h11", "M9.5 14.5h11"], fill: ["M3.5 5.5h6v13h-6z"] },
  merge: { d: ["M3.5 5.5h17v13h-17z", "M8 12h8", "M10.5 9.5 L8 12 L10.5 14.5", "M13.5 9.5 L16 12 L13.5 14.5"] },
  repair: { d: ["M14.5 4.5a4 4 0 0 1 5 5L9 20a2.1 2.1 0 0 1-3-3z", "M12.5 6.5l5 5"] },
  trash: { d: ["M4.5 7h15", "M9.5 7V4.5h5V7", "M6.5 7l1 12.5h9L17.5 7", "M10 10.5v6", "M14 10.5v6"] },

  language: { d: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M3.5 12h17", "M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.3-3.6-8.5s1.2-6.1 3.6-8.5z"] },
  widthAuto: { d: ["M9 5.5h6v13H9z", "M5 9v6", "M19 9v6"] },
  widthWide: { d: ["M6 5.5h12v13H6z", "M3 9v6", "M21 9v6"] },
  widthFull: { d: ["M3.5 5.5h17v13h-17z"] },

  listView: { d: ["M9 7h11", "M9 12h11", "M9 17h11", "M4 6.5l1.2 1.2L7.5 5.4", "M4 11.5l1.2 1.2L7.5 9.9"] },
  boardView: { d: ["M4 5.5h4.5v13H4z", "M9.75 5.5h4.5v9h-4.5z", "M15.5 5.5H20v11h-4.5z"] },
  tableView: { d: ["M3.5 5.5h17v13h-17z", "M3.5 10h17", "M3.5 14.5h17", "M9.5 5.5v13"] },

  foldOne: { d: ["M6 9.5 L12 15.5 L18 9.5"] },
  foldAll: { d: ["M6 12 L12 6 L18 12", "M6 19 L12 13 L18 19"] },
  unfoldAll: { d: ["M6 5 L12 11 L18 5", "M6 12 L12 18 L18 12"] },

  undo: { d: ["M4 9h9a5 5 0 0 1 0 10h-6", "M7.5 5.5 L4 9 L7.5 12.5"] },
  redo: { d: ["M20 9h-9a5 5 0 0 0 0 10h6", "M16.5 5.5 L20 9 L16.5 12.5"] },
};

export const ICON_NAMES = Object.keys(I) as IconName[];

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const spec = I[name];
  return (
    <svg
      className="nx-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {spec.t ? (
        // A letter, for the handful where a letter genuinely IS the clearest
        // symbol. Drawn INSIDE the same box and in the same colour so it sits
        // on the grid with the rest rather than inheriting a text style.
        <text
          x="12" y="12" textAnchor="middle" dominantBaseline="central"
          fill="currentColor" stroke="none"
          fontSize={spec.t.length > 1 ? 11 : 14}
          fontWeight={600}
          fontFamily="inherit"
        >{spec.t}</text>
      ) : null}
      {spec.fill?.map((d, i) => <path key={`f${i}`} d={d} fill="currentColor" stroke="none" />)}
      {spec.d?.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
