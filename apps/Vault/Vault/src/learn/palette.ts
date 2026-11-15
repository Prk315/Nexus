/** The five map lenses. Order here is the HUD switcher order.
 *  `retrievability` leads: it answers "can I still recall this NOW?", the
 *  question "is the graph lit?" was always really asking. Unlike heat (a
 *  global 24 h activity glow) its decay is PER CARD — time since review
 *  measured against the card's own stability_days, so a saturated card
 *  stays bright for months while a fresh one fades in days. */
export type Lens = "retrievability" | "mastery" | "heat" | "importance" | "retention";
export const LENSES: readonly Lens[] = ["retrievability", "mastery", "heat", "importance", "retention"] as const;
export const LENS_LABEL: Record<Lens, string> = {
  retrievability: "Retrievability",
  mastery: "Mastery",
  heat: "Heat",
  importance: "Importance",
  retention: "Retention",
};

/** Domain-coordinated constellation hues (2026-11-15). The graph is heading
 *  toward "all the major sciences", so colour is organised in two levels:
 *  each DOMAIN owns a hue family, and each course is a shade inside its
 *  family — family membership reads at a glance, siblings stay separable.
 *
 *  Anchors sit ~50–85° apart and were VALIDATED, not eyeballed: all anchor
 *  pairs ≥ 20 ΔE (CIE76) in normal vision and ≥ 13 under simulated
 *  deuteranopia AND protanopia; within-family pairs ≥ 10 under deuteranopia
 *  (the stats-board lesson: the lens triad fails exactly this test, so hue
 *  alone is never trusted — families also separate in lightness). All L* ≤ 72
 *  so every dot sits ON the white paper.
 *
 *    Matematik   → gold    (anchor #C8821A — LinAlg keeps its heritage hue)
 *    Datalogi    → violet  (anchor #7657E8 — DBMS keeps its hue)
 *    AI & ML     → teal    (anchor #0FA18F — inherits Prob&Stat's old teal)
 *    Fysik       → navy    (#16349C; deliberately darker than linkPrereq blue)
 *    Medicin     → magenta (#B01E6E; NOT the heat-ramp red — heat is a lens,
 *                           identity may never imitate it)
 *    Spil/intera.→ green   (#3C7F24)
 *
 *  Reserved for future sciences (do not spend on course shades): kemi ~#9A3FB8
 *  (purple), biologi ~#1F8A3D (leaf — retire if Spil grows crowded), økonomi
 *  ~#6B7280 steel is taken by the fallback, pick warm grey-brown #8A6F5C.
 *
 *  A course id this map has never seen falls back to steel — visible, but
 *  obviously unassigned, so a new course shows up as "needs a hue" rather
 *  than silently borrowing an existing constellation's identity. */
export const COURSE_DOMAIN: Record<number, string> = {
  1: "Matematik", 2: "Matematik", 6: "Matematik",
  3: "Datalogi", 8: "Datalogi", 11: "Datalogi",
  4: "AI & ML", 5: "AI & ML", 7: "AI & ML", 9: "AI & ML", 10: "AI & ML",
  13: "Fysik",
  14: "Medicin",
  12: "Spil & interaktive systemer", 15: "Spil & interaktive systemer",
};
export const COURSE_HUE: Record<number, string> = {
  // Matematik — gold
  2: "#C8821A",   // Linear Algebra (anchor)
  6: "#D9A850",   // Kalkulus — lighter, honey
  1: "#7D540A",   // Prob & Stat — deep bronze (moved from teal; AI owns teal now)
  // Datalogi — violet
  3: "#7657E8",   // DBMS (anchor)
  8: "#5436C9",   // Modern C — deep indigo
  11: "#9D7BF4",  // AD — light periwinkle
  // AI & ML — teal
  7: "#0FA18F",   // ML (anchor)
  9: "#0A7066",   // Deep Learning — deep sea
  10: "#26B9D1",  // Computer Vision — bright cyan
  4: "#3C9F6B",   // PGM — green-teal
  5: "#1D86A8",   // Probabilistic Robotics — blue-teal
  // Fysik — navy
  13: "#16349C",  // HQP (anchor)
  // Medicin — magenta
  14: "#B01E6E",  // Medicinsk Fysiologi (anchor)
  // Spil & interaktive systemer — green
  15: "#3C7F24",  // Game Engine Architecture (anchor)
  12: "#6FA32E",  // Virtual Reality — spring green
};
export const COURSE_HUE_FALLBACK = "#7A8294";
export function courseHue(courseId: number | null | undefined): string {
  return (courseId != null && COURSE_HUE[courseId]) || COURSE_HUE_FALLBACK;
}

/** Soft-white-surface tokens (retuned 2026-11-13 from the original dark set).
 *  Mirrored in learn.css as CSS custom properties scoped to .learn-root —
 *  keep the two in sync; these are the JS-side copies the three.js layer
 *  needs (three cannot read CSS variables). The ramps all flip polarity vs.
 *  the dark theme: "cold/empty" is now pale, "hot/strong" is dark+saturated —
 *  on paper, ink is intensity. */
export const LR = {
  void:        "#F7F6F2",
  deep:        "#ECEAE3",
  inert:       "#C6CAD3",  // node with no memory state
  slate:       "#AEB4C0",  // mastery-ramp cold end
  unretained:  "#DBDED4",  // retention-lens dim end
  ash:         "#DCD8CF",  // heat-ramp cold end
  ember:       "#FF6A1A",  // heat-ramp mid
  incandescent:"#C81E12",  // heat-ramp hot end (dark red — ink, not light)
  link:        "rgba(70,80,105,0.16)",
  linkPrereq:  "#2563EB",  // incoming — what the selection stands on
  linkUnlock:  "#15803D",  // outgoing — what the selection unlocks
  fg:          "#1A1A24",
  fgSoft:      "#4A4F5C",
  fgMuted:     "#7A8090",
} as const;

/** sRGB linear interpolation between two #rrggbb strings. Deliberately naive
 *  (no OKLab) so both implementers produce byte-identical colors. */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * k);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * k);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * k);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/** Three-stop heat ramp: cold ash → ember → incandescent. */
export function heatColor(h: number): string {
  const k = Math.max(0, Math.min(1, h));
  return k < 0.5
    ? mixHex(LR.ash, LR.ember, k / 0.5)
    : mixHex(LR.ember, LR.incandescent, (k - 0.5) / 0.5);
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
