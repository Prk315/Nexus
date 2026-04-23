// Excel-compatible date serial numbers.
// Serial 1 = Jan 1 1900. Uses Dec 30 1899 as epoch to match Excel's leap-year bug.
const EPOCH = new Date(Date.UTC(1899, 11, 30)).getTime()
const MS_PER_DAY = 86400000

export function dateToSerial(d: Date): number {
  return Math.floor((d.getTime() - EPOCH) / MS_PER_DAY)
}

export function serialToDate(serial: number): Date {
  return new Date(EPOCH + Math.floor(serial) * MS_PER_DAY)
}

/** Format a date serial as a string using Excel-like format tokens.
 *  Supported tokens: YYYY MM DD HH mm SS  (mm = minutes when preceded by HH:)
 */
export function serialToDateStr(serial: number, fmt: string): string {
  const d = serialToDate(serial)
  const pad = (n: number) => String(n).padStart(2, "0")

  // Replace time tokens first so MM is unambiguous
  return fmt
    .replace("YYYY", String(d.getUTCFullYear()))
    .replace("MM", pad(d.getUTCMonth() + 1))
    .replace("DD", pad(d.getUTCDate()))
    .replace("HH", pad(d.getUTCHours()))
    .replace("mm", pad(d.getUTCMinutes()))
    .replace("SS", pad(d.getUTCSeconds()))
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DMY_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
// MDY_RE intentionally omitted — same pattern as DMY; prefer ISO

/** Try to parse a date string into a serial number. Returns null if not recognised. */
export function tryParseDateString(s: string): number | null {
  let m: RegExpMatchArray | null
  if ((m = s.match(ISO_RE))) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    return isNaN(d.getTime()) ? null : dateToSerial(d)
  }
  if ((m = s.match(DMY_RE))) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
    return isNaN(d.getTime()) ? null : dateToSerial(d)
  }
  return null
}
