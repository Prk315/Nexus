// Shared internals for the dashboard's components: the day-calendar geometry
// constants, its colour table, and the small time helpers.
//
// Dashboard.tsx was 2,471 lines holding five substantial components plus the
// page container. These constants are what they had in common, so they moved
// here rather than being duplicated or re-threaded as props.



export const todayDate = () => new Date().toISOString().slice(0, 10);

// ── Day Calendar constants ────────────────────────────────────────────────────

export const DC_HOUR_START = 5;
export const DC_HOUR_END   = 23;
export const DC_HOUR_PX    = 48;
export const DC_HOURS      = Array.from({ length: DC_HOUR_END - DC_HOUR_START + 1 }, (_, i) => DC_HOUR_START + i);

export function dcTimeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
export function dcMinToPx(min: number) {
  return ((min - DC_HOUR_START * 60) / 60) * DC_HOUR_PX;
}
export function dcPxToTime(px: number) {
  const raw     = DC_HOUR_START * 60 + (px / DC_HOUR_PX) * 60;
  const snapped = Math.round(raw / 30) * 30;
  const clamped = Math.max(DC_HOUR_START * 60, Math.min((DC_HOUR_END + 1) * 60 - 30, snapped));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function dcAddHour(t: string) {
  const [h, m] = t.split(":").map(Number);
  const total  = Math.min((DC_HOUR_END + 1) * 60, h * 60 + m + 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export const DC_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  blue:    { bg: "bg-blue-500/20",    border: "border-blue-400/50",    text: "text-blue-700 dark:text-blue-300",       dot: "bg-blue-500" },
  indigo:  { bg: "bg-indigo-500/20",  border: "border-indigo-400/50",  text: "text-indigo-700 dark:text-indigo-300",   dot: "bg-indigo-500" },
  violet:  { bg: "bg-violet-500/20",  border: "border-violet-400/50",  text: "text-violet-700 dark:text-violet-300",   dot: "bg-violet-500" },
  purple:  { bg: "bg-purple-500/20",  border: "border-purple-400/50",  text: "text-purple-700 dark:text-purple-300",   dot: "bg-purple-500" },
  pink:    { bg: "bg-pink-500/20",    border: "border-pink-400/50",    text: "text-pink-700 dark:text-pink-300",       dot: "bg-pink-500" },
  rose:    { bg: "bg-rose-500/20",    border: "border-rose-400/50",    text: "text-rose-700 dark:text-rose-300",       dot: "bg-rose-500" },
  red:     { bg: "bg-red-500/20",     border: "border-red-400/50",     text: "text-red-700 dark:text-red-300",         dot: "bg-red-500" },
  orange:  { bg: "bg-orange-500/20",  border: "border-orange-400/50",  text: "text-orange-700 dark:text-orange-300",   dot: "bg-orange-500" },
  amber:   { bg: "bg-amber-500/20",   border: "border-amber-400/50",   text: "text-amber-700 dark:text-amber-300",     dot: "bg-amber-500" },
  yellow:  { bg: "bg-yellow-400/20",  border: "border-yellow-400/50",  text: "text-yellow-700 dark:text-yellow-300",   dot: "bg-yellow-400" },
  green:   { bg: "bg-green-500/20",   border: "border-green-400/50",   text: "text-green-700 dark:text-green-300",     dot: "bg-green-500" },
  emerald: { bg: "bg-emerald-500/20", border: "border-emerald-400/50", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  teal:    { bg: "bg-teal-500/20",    border: "border-teal-400/50",    text: "text-teal-700 dark:text-teal-300",       dot: "bg-teal-500" },
  cyan:    { bg: "bg-cyan-500/20",    border: "border-cyan-400/50",    text: "text-cyan-700 dark:text-cyan-300",       dot: "bg-cyan-500" },
  slate:   { bg: "bg-slate-500/20",   border: "border-slate-400/50",   text: "text-slate-700 dark:text-slate-300",     dot: "bg-slate-500" },
};
export const DC_COLOR_KEYS = Object.keys(DC_COLORS);

export type DCBlockDraft = {
  title: string; start_time: string; end_time: string;
  color: string; description: string; location: string;
  task_id: number | null;
};

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}


// ── Moved here because more than one dashboard component needs them ──

export const HABIT_COLOR_DOT: Record<string, string> = {
  red:    "bg-red-500",    orange: "bg-orange-500", amber:  "bg-amber-500",
  yellow: "bg-yellow-500", lime:   "bg-lime-500",   green:  "bg-green-500",
  emerald:"bg-emerald-500",teal:   "bg-teal-500",   cyan:   "bg-cyan-500",
  sky:    "bg-sky-500",    blue:   "bg-blue-500",   indigo: "bg-indigo-500",
  violet: "bg-violet-500", purple: "bg-purple-500", pink:   "bg-pink-500",
  rose:   "bg-rose-500",   slate:  "bg-slate-500",
};

export interface PieItem {
  id: number;
  label: string;
  subtitle?: string;
  minutes: number;
  done: boolean;
  kind: "task" | "assignment" | "goal";
}

export function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
