import type { CellValue } from "./formula"
import { CellError } from "./formula"
import { serialToDateStr } from "./dateSerial"

const DATE_TOKENS = /YYYY|MM|DD|HH|mm|SS/

/** Apply an Excel-like format string to a cell value. */
export function applyFormat(value: CellValue, fmt: string): string {
  if (value instanceof CellError) return value.toString()

  // ── Date format ───────────────────────────────────────────────────────────
  if (DATE_TOKENS.test(fmt) && typeof value === "number") {
    return serialToDateStr(value, fmt)
  }

  // ── Percentage ────────────────────────────────────────────────────────────
  if (fmt.endsWith("%")) {
    const numFmt = fmt.slice(0, -1).trim()
    const pct = typeof value === "number" ? value * 100 : parseFloat(String(value)) * 100
    if (isNaN(pct)) return String(value)
    return formatNumber(pct, numFmt) + "%"
  }

  // ── Plain number ──────────────────────────────────────────────────────────
  if (typeof value === "number") {
    return formatNumber(value, fmt)
  }

  // ── String passthrough ────────────────────────────────────────────────────
  return String(value)
}

function formatNumber(num: number, fmt: string): string {
  if (!isFinite(num)) return num > 0 ? "#INF!" : "#-INF!"

  // Extract literal prefix (e.g. "$")
  const prefixMatch = fmt.match(/^([^#0,.]*)/)
  const prefix = prefixMatch ? prefixMatch[1] : ""
  const rest = fmt.slice(prefix.length)

  // Extract literal suffix
  const suffixMatch = rest.match(/([^#0,.]+)$/)
  const suffix = suffixMatch ? suffixMatch[1] : ""
  const pattern = rest.slice(0, rest.length - suffix.length)

  const useGrouping = pattern.includes(",")
  const decMatch = pattern.match(/[.](0+|#+)$/)
  const decPlaces = decMatch ? decMatch[1].length : 0

  const formatted = new Intl.NumberFormat("en-US", {
    useGrouping,
    minimumFractionDigits: decPlaces,
    maximumFractionDigits: decPlaces,
  }).format(num)

  return prefix + formatted + suffix
}

/** Common format presets shown in the UI. */
export const FORMAT_PRESETS = [
  { label: "General",    fmt: "" },
  { label: "Number",     fmt: "#,##0.00" },
  { label: "Currency",   fmt: "$#,##0.00" },
  { label: "Percentage", fmt: "0.00%" },
  { label: "Date",       fmt: "YYYY-MM-DD" },
  { label: "Time",       fmt: "HH:mm:SS" },
  { label: "Integer",    fmt: "#,##0" },
] as const
