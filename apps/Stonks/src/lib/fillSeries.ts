import { shiftFormula } from "./formula"

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]
const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DAYS_LONG = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const DAYS_SHORT = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

function matchCycle(val: string, list: string[]): number {
  const lower = val.toLowerCase()
  return list.findIndex((m) => m === lower)
}

function cycleFill(
  sourceValues: string[],
  fillCount: number,
  list: string[],
  startIdx: number,
  preserveCase: (original: string, listVal: string) => string
): string[] {
  return Array.from({ length: fillCount }, (_, i) => {
    const idx = (startIdx + sourceValues.length + i) % list.length
    return preserveCase(sourceValues[0], list[idx])
  })
}

function detectStep(nums: number[]): number {
  if (nums.length < 2) return 1
  const diffs = nums.slice(1).map((v, i) => v - nums[i])
  // Use the most common diff; if all the same, use that
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length
  return avg
}

/** Infer and produce fill series values for `fillCount` cells beyond the source. */
export function detectFillSeries(
  sourceValues: string[],
  fillCount: number,
  direction: "down" | "right",
  rowDelta: number,
  colDelta: number,
): string[] {
  if (sourceValues.length === 0 || fillCount === 0) return []

  // ── Formula series ─────────────────────────────────────────────────────────
  if (sourceValues.every((v) => v.startsWith("="))) {
    return Array.from({ length: fillCount }, (_, i) => {
      const srcIdx = i % sourceValues.length
      const stepMultiplier = Math.floor(i / sourceValues.length) + 1
      const formula = sourceValues[srcIdx].slice(1)
      const dr = direction === "down" ? rowDelta * stepMultiplier : 0
      const dc = direction === "right" ? colDelta * stepMultiplier : 0
      return "=" + shiftFormula(formula, dr, dc)
    })
  }

  // ── Numeric series ─────────────────────────────────────────────────────────
  if (sourceValues.every((v) => v !== "" && !isNaN(Number(v)))) {
    const nums = sourceValues.map(Number)
    const step = detectStep(nums)
    const last = nums[nums.length - 1]
    return Array.from({ length: fillCount }, (_, i) => String(last + step * (i + 1)))
  }

  // ── Text + trailing number (e.g. "Item 1", "Q1") ──────────────────────────
  const trailNumRe = /^(.*?)(\d+)$/
  if (sourceValues.every((v) => trailNumRe.test(v))) {
    const matches = sourceValues.map((v) => v.match(trailNumRe)!)
    const prefix = matches[0][1]
    const nums = matches.map((m) => parseInt(m[2], 10))
    const step = detectStep(nums)
    const last = nums[nums.length - 1]
    const width = matches[0][2].length // preserve zero-padding
    return Array.from({ length: fillCount }, (_, i) => {
      const n = last + step * (i + 1)
      return prefix + String(Math.round(n)).padStart(width, "0")
    })
  }

  // ── Month names ────────────────────────────────────────────────────────────
  for (const list of [MONTHS, MONTHS_SHORT]) {
    const indices = sourceValues.map((v) => matchCycle(v, list))
    if (indices.every((idx) => idx !== -1)) {
      const startIdx = (indices[indices.length - 1] + 1) % list.length
      const isUpper = sourceValues[0] === sourceValues[0].toUpperCase()
      const isTitled = !isUpper && sourceValues[0][0] === sourceValues[0][0].toUpperCase()
      return cycleFill(sourceValues, fillCount, list, startIdx, (_, v) =>
        isUpper ? v.toUpperCase() : isTitled ? v[0].toUpperCase() + v.slice(1) : v
      )
    }
  }

  // ── Day names ──────────────────────────────────────────────────────────────
  for (const list of [DAYS_LONG, DAYS_SHORT]) {
    const indices = sourceValues.map((v) => matchCycle(v, list))
    if (indices.every((idx) => idx !== -1)) {
      const startIdx = (indices[indices.length - 1] + 1) % list.length
      const isUpper = sourceValues[0] === sourceValues[0].toUpperCase()
      const isTitled = !isUpper && sourceValues[0][0] === sourceValues[0][0].toUpperCase()
      return cycleFill(sourceValues, fillCount, list, startIdx, (_, v) =>
        isUpper ? v.toUpperCase() : isTitled ? v[0].toUpperCase() + v.slice(1) : v
      )
    }
  }

  // ── Plain text — repeat the pattern ───────────────────────────────────────
  return Array.from({ length: fillCount }, (_, i) => sourceValues[i % sourceValues.length])
}
