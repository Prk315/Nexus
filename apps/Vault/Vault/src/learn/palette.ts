/** The four map lenses. Order here is the HUD switcher order. */
export type Lens = "mastery" | "heat" | "importance" | "retention";
export const LENSES: readonly Lens[] = ["mastery", "heat", "importance", "retention"] as const;
export const LENS_LABEL: Record<Lens, string> = {
  mastery: "Mastery",
  heat: "Heat",
  importance: "Importance",
  retention: "Retention",
};

/** Per-course constellation hues, keyed by lr_course.c_id. Chosen for a
 *  near-black field: L* ~0.78–0.83 so they glow rather than sit, and ~100° of
 *  hue between each so the three constellations read apart at a glance.
 *    1  Introduction to Probability and Statistics → aqua
 *    2  Linear Algebra                             → amber (descends from the
 *       outgoing conceptmap.html accent #b8892f, lifted for a dark field)
 *    3  Database Management Systems                → violet
 *  A course id this map has never seen falls back to steel — visible, but
 *  obviously unassigned, so a new course shows up as "needs a hue" rather
 *  than silently borrowing an existing constellation's identity. */
export const COURSE_HUE: Record<number, string> = {
  1: "#3FD8C4",
  2: "#F2B23C",
  3: "#9B7BFF",
};
export const COURSE_HUE_FALLBACK = "#8A93A6";
export function courseHue(courseId: number | null | undefined): string {
  return (courseId != null && COURSE_HUE[courseId]) || COURSE_HUE_FALLBACK;
}

/** Dark-surface tokens. Mirrored in learn.css as CSS custom properties scoped
 *  to .learn-root — keep the two in sync; these are the JS-side copies the
 *  three.js layer needs (three cannot read CSS variables). */
export const LR = {
  void:        "#05060A",
  deep:        "#0B0E17",
  inert:       "#39404E",  // node with no memory state
  slate:       "#3E4552",  // mastery-ramp cold end
  unretained:  "#242A34",  // retention-lens dim end
  ash:         "#2B3038",  // heat-ramp cold end
  ember:       "#FF6A1A",  // heat-ramp mid
  incandescent:"#FFEFC2",  // heat-ramp hot end
  link:        "rgba(126,140,170,0.11)",
  linkPrereq:  "#5AA9FF",  // incoming — what the selection stands on
  linkUnlock:  "#4ADE80",  // outgoing — what the selection unlocks
  fg:          "#E6EAF2",
  fgSoft:      "#A8B0C2",
  fgMuted:     "#6C7488",
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
