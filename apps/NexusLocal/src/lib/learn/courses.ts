/**
 * Multi-course registry — LEARN_PLAN.md "DBMS course (pinned, 2026-08-11)",
 * "App course support": the app now hosts more than one `lr_course`, and a
 * `Lens` is no longer a hardcoded LA union — it is per-course data, resolved
 * through this file via `CourseContext.tsx`'s `useCourse()`.
 *
 * Two courses today, both already live in `lr_course`:
 *   - `la`   — `lr_course.c_id = 2`, "Linear Algebra" (LinAlgDat). The
 *     original, complete 28-unit course. Lenses `row · matrix · column`,
 *     Danish content, `la-` item slugs.
 *   - `dbms` — `lr_course.c_id = 3`, "Database Management Systems" (DIS).
 *     Built incrementally (LEARN_PLAN.md: "linearize globally, materialize +
 *     author one section at a time" — Section 1 approved, 5 units). Lenses
 *     `nl · rc · ra · sql`, English content, `dbms-` item slugs.
 *
 * ── Adding a third course ────────────────────────────────────────────────
 * Add one entry to `COURSES` and one key to `CourseKey`. Every panel resolves
 * everything else (lens colours, chapter grouping, item-pool prefix, whether
 * `lr_learn_state` applies) off this registry — no other file should ever
 * hardcode a course id, a lens key, or an item-slug prefix again.
 *
 * ── Picking the DBMS lens colours (frozen 2026-08-11) ───────────────────
 * LA already claims cyan (row) / indigo (matrix) / fuchsia (column), and
 * DESIGN.md §0 rule 2/§1.2's reserved-hue table permanently claims emerald
 * (correct) / red (wrong) / amber (draft) across BOTH courses — those three
 * co-occur with a lens chip on the very same screen (a feedback banner next
 * to a drill's lens tag), so DBMS's four new hues had to clear a ~30°+ hue
 * gap from red(0°)/amber(38°)/emerald(152°) specifically, not just "look
 * different". LA's own three hues never co-render with DBMS's (courses are
 * mutually exclusive views, gated by the course switcher), so reusing
 * adjacent hue territory near cyan/indigo/fuchsia was fair game and let the
 * four DBMS hues sit far enough apart from EACH OTHER (~35-70° pairwise) to
 * read as genuinely distinct chips at a glance — the same bar LA's own
 * row/matrix/column already clears (49°/53° apart). Chosen, in the order the
 * translation chain reads (LEARN_PLAN.md: "RC→RA→SQL forward, describe in NL
 * backward"):
 *   nl  (natural language) -> sky    #0ea5e9 — plain, legible, the "reading" lens
 *   rc  (relational calculus) -> violet #8b5cf6 — the formal/set-theoretic lens
 *   ra  (relational algebra)  -> blue   #3b82f6 — the operator/procedural lens
 *   sql (SQL)                 -> pink   #ec4899 — warm outlier: the concrete,
 *                                                  executable, "runs against a
 *                                                  real engine" lens
 * Every recipe mirrors DESIGN.md §7.3's light-theme formula exactly (pale
 * `-50` chip fill, `-700`/`-800` text, `-600` ring at 25-40%, solid `-500`
 * dot/edge/bar) so a DBMS chip is structurally identical to an LA chip —
 * only the hue changes, never the shape.
 */

export interface LensToken {
  /** Short label — fits a chip ("NL", "RC"). */
  label: string;
  /** Full name — fold-out trigger text ("Natural language"). */
  long: string;
  hex: string;
  chip: string;
  chipOn: string;
  dot: string;
  edge: string;
  tint: string;
}

/** Best-effort "which lens is this translate drill given IN" detector — see
 * `player/tokens.tsx`'s `detectSourceLens`. Course-scoped because the words
 * that name a lens are the course's own vocabulary (Danish for LA, English
 * for DBMS) — never a general content parser. */
export interface SourceLensPattern {
  re: RegExp;
  lens: string;
}

export interface CourseDef {
  /** `lr_course.c_id` / `lr_unit.course_id` — the one hard DB key everything
   * else in this file exists to avoid hardcoding a second time. */
  courseId: number;
  key: "la" | "dbms";
  /** Full title, this course's own language ("Lineær Algebra" — LA is
   * Danish-content, DBMS is English-content, per each course's own
   * `contentLanguage`). Used in the path header ("Learn · {title}"). */
  title: string;
  /** Compact badge text for the course switcher ("LA" / "DBMS"). */
  shortLabel: string;
  contentLanguage: "da" | "en";
  /** `lr_item.slug` prefix for this course's Infinite-exercises pool, e.g.
   * `"la-"` / `"dbms-"` — `api.fetchExercisePool` turns this into a
   * `LIKE 'prefix%'` filter. */
  itemSlugPrefix: string;
  /** `lr_learn_state` (the Phase-3 verdict row: streak, due concepts,
   * frontier) is computed for ONE user, not per-course — today only the LA
   * pipeline (`learn-evaluate`) feeds it. `ReviewPanel` must never show that
   * verdict's numbers under a course header it wasn't computed for; see
   * that file's course-gating. */
  hasLearnState: boolean;
  /** Whether every section of the linearized path has been authored. `false`
   * makes `PathPanel` render the "More sections on the way" horizon after
   * the last chapter instead of implying the course ends there for good. */
  complete: boolean;
  /** Ordered lens keys — drives chip order (theory cards, `UnitOpening`,
   * the graduation lens-payoff row) and is the least-seen-lens fallback set
   * for `memory.leastSeenLens`. */
  lensOrder: string[];
  lenses: Record<string, LensToken>;
  /** Drill-card top edge for a single-lens (non-translate) drill. */
  solidBar: Record<string, string>;
  /** Drill-card top edge for a `translate` drill, keyed `"from-to"` — every
   * ordered pair among this course's lenses, written out in full (never
   * composed from `solidBar`/`lenses`) per DESIGN.md §1.1's anti-
   * interpolation rule: Tailwind's JIT only sees literal class substrings. */
  translateBar: Record<string, string>;
  sourceLensPatterns: SourceLensPattern[];
}

export type CourseKey = CourseDef["key"];

const LA_LENSES: Record<string, LensToken> = {
  row: {
    label: "Række",
    long: "Rækkebilledet",
    hex: "#22d3ee",
    chip: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-600/25",
    chipOn: "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-600/40",
    dot: "bg-cyan-500",
    edge: "border-l-2 border-cyan-500/60",
    tint: "bg-cyan-50",
  },
  matrix: {
    label: "Matrix",
    long: "Matrixformen",
    hex: "#818cf8",
    chip: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/25",
    chipOn: "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-600/40",
    dot: "bg-indigo-500",
    edge: "border-l-2 border-indigo-500/60",
    tint: "bg-indigo-50",
  },
  column: {
    label: "Søjle",
    long: "Søjlebilledet",
    hex: "#e879f9",
    chip: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-600/25",
    chipOn: "bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-600/40",
    dot: "bg-fuchsia-500",
    edge: "border-l-2 border-fuchsia-500/60",
    tint: "bg-fuchsia-50",
  },
};

const LA_SOLID_BAR: Record<string, string> = {
  row: "bg-cyan-500",
  matrix: "bg-indigo-500",
  column: "bg-fuchsia-500",
};

const LA_TRANSLATE_BAR: Record<string, string> = {
  "row-matrix": "bg-gradient-to-r from-cyan-500 to-indigo-500",
  "row-column": "bg-gradient-to-r from-cyan-500 to-fuchsia-500",
  "matrix-row": "bg-gradient-to-r from-indigo-500 to-cyan-500",
  "matrix-column": "bg-gradient-to-r from-indigo-500 to-fuchsia-500",
  "column-row": "bg-gradient-to-r from-fuchsia-500 to-cyan-500",
  "column-matrix": "bg-gradient-to-r from-fuchsia-500 to-indigo-500",
};

// DBMS — nl (sky) · rc (violet) · ra (blue) · sql (pink). See the file-header
// comment for why these four hues.
const DBMS_LENSES: Record<string, LensToken> = {
  nl: {
    label: "NL",
    long: "Natural language",
    hex: "#0ea5e9",
    chip: "bg-sky-50 text-sky-700 ring-1 ring-sky-600/25",
    chipOn: "bg-sky-100 text-sky-800 ring-1 ring-sky-600/40",
    dot: "bg-sky-500",
    edge: "border-l-2 border-sky-500/60",
    tint: "bg-sky-50",
  },
  rc: {
    label: "RC",
    long: "Relational calculus",
    hex: "#8b5cf6",
    chip: "bg-violet-50 text-violet-700 ring-1 ring-violet-600/25",
    chipOn: "bg-violet-100 text-violet-800 ring-1 ring-violet-600/40",
    dot: "bg-violet-500",
    edge: "border-l-2 border-violet-500/60",
    tint: "bg-violet-50",
  },
  ra: {
    label: "RA",
    long: "Relational algebra",
    hex: "#3b82f6",
    chip: "bg-blue-50 text-blue-700 ring-1 ring-blue-600/25",
    chipOn: "bg-blue-100 text-blue-800 ring-1 ring-blue-600/40",
    dot: "bg-blue-500",
    edge: "border-l-2 border-blue-500/60",
    tint: "bg-blue-50",
  },
  sql: {
    label: "SQL",
    long: "SQL",
    hex: "#ec4899",
    chip: "bg-pink-50 text-pink-700 ring-1 ring-pink-600/25",
    chipOn: "bg-pink-100 text-pink-800 ring-1 ring-pink-600/40",
    dot: "bg-pink-500",
    edge: "border-l-2 border-pink-500/60",
    tint: "bg-pink-50",
  },
};

const DBMS_SOLID_BAR: Record<string, string> = {
  nl: "bg-sky-500",
  rc: "bg-violet-500",
  ra: "bg-blue-500",
  sql: "bg-pink-500",
};

// Every ordered pair among nl/rc/ra/sql (4×3 = 12), written out in full —
// same anti-interpolation rule as LA_TRANSLATE_BAR above.
const DBMS_TRANSLATE_BAR: Record<string, string> = {
  "nl-rc": "bg-gradient-to-r from-sky-500 to-violet-500",
  "nl-ra": "bg-gradient-to-r from-sky-500 to-blue-500",
  "nl-sql": "bg-gradient-to-r from-sky-500 to-pink-500",
  "rc-nl": "bg-gradient-to-r from-violet-500 to-sky-500",
  "rc-ra": "bg-gradient-to-r from-violet-500 to-blue-500",
  "rc-sql": "bg-gradient-to-r from-violet-500 to-pink-500",
  "ra-nl": "bg-gradient-to-r from-blue-500 to-sky-500",
  "ra-rc": "bg-gradient-to-r from-blue-500 to-violet-500",
  "ra-sql": "bg-gradient-to-r from-blue-500 to-pink-500",
  "sql-nl": "bg-gradient-to-r from-pink-500 to-sky-500",
  "sql-rc": "bg-gradient-to-r from-pink-500 to-violet-500",
  "sql-ra": "bg-gradient-to-r from-pink-500 to-blue-500",
};

export const COURSES: Record<CourseKey, CourseDef> = {
  la: {
    courseId: 2,
    key: "la",
    title: "Lineær Algebra",
    shortLabel: "LA",
    contentLanguage: "da",
    itemSlugPrefix: "la-",
    hasLearnState: true,
    complete: true,
    lensOrder: ["row", "matrix", "column"],
    lenses: LA_LENSES,
    solidBar: LA_SOLID_BAR,
    translateBar: LA_TRANSLATE_BAR,
    sourceLensPatterns: [
      { re: /Givet i række\w*(?:linsen|billedet|form)/i, lens: "row" },
      { re: /Givet i søjle\w*(?:linsen|billedet|form)/i, lens: "column" },
      { re: /Givet i (?:matrix|koordinat)\w*(?:linsen|billedet|form)/i, lens: "matrix" },
    ],
  },
  dbms: {
    courseId: 3,
    key: "dbms",
    title: "Database Management Systems",
    shortLabel: "DBMS",
    contentLanguage: "en",
    itemSlugPrefix: "dbms-",
    // lr_learn_state has no course_id column — it's one verdict row per user,
    // fed only by the LA-scoped `learn-evaluate` cron job today. See
    // ReviewPanel.tsx's course-gating.
    hasLearnState: false,
    // Built incrementally — Section 1 (5 units) approved 2026-08-11 of a
    // globally-linearized, multi-section course. PathPanel renders the
    // partial-path horizon after the last authored chapter.
    complete: false,
    lensOrder: ["nl", "rc", "ra", "sql"],
    lenses: DBMS_LENSES,
    solidBar: DBMS_SOLID_BAR,
    translateBar: DBMS_TRANSLATE_BAR,
    // Best-effort, matching the course's own English vocabulary — content
    // for Section 1 hasn't been authored yet, so these are a documented
    // guess (mirrors LA's "not every translate drill carries this preface"
    // degrade-to-null posture) rather than a verified pattern.
    sourceLensPatterns: [
      { re: /Given in (?:natural language|NL)\b/i, lens: "nl" },
      { re: /Given in (?:relational calculus|RC)\b/i, lens: "rc" },
      { re: /Given in (?:relational algebra|RA)\b/i, lens: "ra" },
      { re: /Given in SQL\b/i, lens: "sql" },
    ],
  },
};

export const DEFAULT_COURSE_KEY: CourseKey = "la";

export function getCourse(key: CourseKey): CourseDef {
  return COURSES[key];
}

export function isCourseKey(value: string): value is CourseKey {
  return value === "la" || value === "dbms";
}

export const COURSE_LIST: CourseDef[] = [COURSES.la, COURSES.dbms];
