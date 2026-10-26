// Output conventions shared by every command.
//
//   --json   one JSON document on stdout, stable field names, nothing else
//   default  a one-line header naming the profile, then a compact table
//
// The header exists so that `dev` (sandbox) and `me` (personal) output can
// never be mistaken for each other when both are on screen. It goes to stdout
// with the table (it is part of the human view), never into --json output.

export interface OutputOptions {
  json: boolean;
}

export function header(profileName: string, email: string | undefined, title: string): string {
  const who = email ? `${profileName} <${email}>` : profileName;
  return `[${who}] ${title}`;
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/**
 * Renders rows as a fixed-width table. Column widths come from the data, with
 * a per-column cap so one long title cannot push everything else off screen.
 */
export function table(
  columns: Array<{ key: string; label: string; max?: number; align?: "left" | "right" }>,
  rows: ReadonlyArray<object>,
): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.join(",");
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v).replace(/\s*\n\s*/g, " ");
  };
  const clip = (s: string, max: number | undefined): string =>
    max && s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;

  const data = rows.map((r) => columns.map((c) => clip(cell((r as Record<string, unknown>)[c.key]), c.max)));
  const widths = columns.map((c, i) => Math.max(c.label.length, ...data.map((d) => d[i].length)));
  const fmt = (vals: string[]) =>
    vals
      .map((v, i) => (columns[i].align === "right" ? v.padStart(widths[i]) : v.padEnd(widths[i])))
      .join("  ")
      .replace(/\s+$/, "");

  const lines = [fmt(columns.map((c) => c.label)), fmt(widths.map((w) => "-".repeat(w)))];
  for (const d of data) lines.push(fmt(d));
  return lines.join("\n");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.length > 16 ? iso.slice(0, 16).replace("T", " ") : iso;
}
