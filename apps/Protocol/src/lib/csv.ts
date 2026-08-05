/** Parse a CSV string into an array of row objects keyed by header name.
 * Proper RFC-4180-ish parsing: quoted fields may contain commas, escaped
 * quotes (""), and newlines — the latter is common in Strava exports where an
 * activity description spans multiple lines. Duplicate header names resolve to
 * the last column with that name (Strava repeats "Distance"/"Varighed"/… for
 * display vs raw values; the raw ones come last). */
export function parseCSV(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((vals) => Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()])));
}

/** Streaming CSV tokenizer — handles quoted fields containing commas, ""
 * escapes, and embedded newlines. Returns an array of rows (arrays of fields). */
function parseRows(text: string): string[][] {
  const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
