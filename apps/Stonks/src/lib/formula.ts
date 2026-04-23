import { dateToSerial, serialToDate } from "./dateSerial"

// ─── Value types ────────────────────────────────────────────────────────────

export class CellError {
  constructor(public code: string) {}
  toString() { return `#${this.code}!` }
}

export type CellValue = number | string | CellError
export type CellLookup = (key: string) => CellValue

// ─── Cell key helpers ────────────────────────────────────────────────────────

export function keyToPos(key: string): { col: number; row: number } | null {
  const m = key.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: parseInt(m[2]) - 1 }
}

function expandRange(from: string, to: string): string[] {
  const a = keyToPos(from)
  const b = keyToPos(to)
  if (!a || !b) return []
  const keys: string[] = []
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++)
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      let col = c + 1, colStr = ""
      while (col > 0) { colStr = String.fromCharCode(64 + (col % 26 || 26)) + colStr; col = Math.floor((col - 1) / 26) }
      keys.push(`${colStr}${r + 1}`)
    }
  return keys
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type TT =
  | "NUM" | "STR" | "CELL" | "IDENT"
  | "PLUS" | "MINUS" | "STAR" | "SLASH" | "CARET" | "PERCENT" | "AMP"
  | "EQ" | "NEQ" | "LT" | "GT" | "LTE" | "GTE"
  | "LPAREN" | "RPAREN" | "COLON" | "COMMA" | "EOF"

interface Token { type: TT; value: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }

    if (/\d/.test(ch) || (ch === "." && /\d/.test(src[i + 1] ?? ""))) {
      let v = ""
      while (i < src.length && /[\d.]/.test(src[i])) v += src[i++]
      tokens.push({ type: "NUM", value: v }); continue
    }

    if (ch === '"') {
      let v = ""; i++
      while (i < src.length && src[i] !== '"') { if (src[i] === "\\") i++; v += src[i++] }
      i++; tokens.push({ type: "STR", value: v }); continue
    }

    if (/[A-Za-z]/.test(ch)) {
      let v = ""
      while (i < src.length && /[A-Za-z0-9]/.test(src[i])) v += src[i++]
      const u = v.toUpperCase()
      tokens.push({ type: /^[A-Z]+\d+$/.test(u) ? "CELL" : "IDENT", value: u }); continue
    }

    if (ch === "<") {
      if (src[i + 1] === ">") { tokens.push({ type: "NEQ", value: "<>" }); i += 2 }
      else if (src[i + 1] === "=") { tokens.push({ type: "LTE", value: "<=" }); i += 2 }
      else { tokens.push({ type: "LT", value: "<" }); i++ }
      continue
    }
    if (ch === ">") {
      if (src[i + 1] === "=") { tokens.push({ type: "GTE", value: ">=" }); i += 2 }
      else { tokens.push({ type: "GT", value: ">" }); i++ }
      continue
    }

    const single: Partial<Record<string, TT>> = {
      "+": "PLUS", "-": "MINUS", "*": "STAR", "/": "SLASH",
      "^": "CARET", "%": "PERCENT", "&": "AMP", "=": "EQ",
      "(": "LPAREN", ")": "RPAREN", ":": "COLON", ",": "COMMA",
    }
    if (single[ch]) { tokens.push({ type: single[ch]!, value: ch }); i++; continue }
    i++ // skip unknown
  }
  tokens.push({ type: "EOF", value: "" })
  return tokens
}

// ─── AST ─────────────────────────────────────────────────────────────────────

type Expr =
  | { k: "num";   val: number }
  | { k: "str";   val: string }
  | { k: "cell";  ref: string }
  | { k: "range"; from: string; to: string }
  | { k: "bin";   op: string; l: Expr; r: Expr }
  | { k: "neg";   e: Expr }
  | { k: "call";  name: string; args: Expr[] }

// ─── Parser ───────────────────────────────────────────────────────────────────

class Parser {
  private i = 0
  constructor(private t: Token[]) {}
  private peek() { return this.t[this.i] }
  private eat() { return this.t[this.i++] }
  private expect(tt: TT) { const t = this.eat(); if (t.type !== tt) throw new Error(`Expected ${tt}`); return t }

  parse(): Expr { return this.parseCmp() }

  private parseCmp(): Expr {
    let l = this.parseConcat()
    const ops: TT[] = ["EQ","NEQ","LT","GT","LTE","GTE"]
    while (ops.includes(this.peek().type)) {
      const op = this.eat().value
      l = { k: "bin", op, l, r: this.parseConcat() }
    }
    return l
  }

  private parseConcat(): Expr {
    let l = this.parseAddSub()
    while (this.peek().type === "AMP") {
      this.eat()
      l = { k: "bin", op: "&", l, r: this.parseAddSub() }
    }
    return l
  }

  private parseAddSub(): Expr {
    let l = this.parseMulDiv()
    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.eat().value
      l = { k: "bin", op, l, r: this.parseMulDiv() }
    }
    return l
  }

  private parseMulDiv(): Expr {
    let l = this.parsePow()
    while (this.peek().type === "STAR" || this.peek().type === "SLASH") {
      const op = this.eat().value
      l = { k: "bin", op, l, r: this.parsePow() }
    }
    return l
  }

  private parsePow(): Expr {
    const l = this.parseUnary()
    if (this.peek().type === "CARET") { this.eat(); return { k: "bin", op: "^", l, r: this.parseUnary() } }
    return l
  }

  private parseUnary(): Expr {
    if (this.peek().type === "MINUS") { this.eat(); return { k: "neg", e: this.parsePostfix() } }
    if (this.peek().type === "PLUS") { this.eat() }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    if (this.peek().type === "PERCENT") { this.eat(); e = { k: "bin", op: "/", l: e, r: { k: "num", val: 100 } } }
    return e
  }

  private parsePrimary(): Expr {
    const t = this.peek()

    if (t.type === "NUM") { this.eat(); return { k: "num", val: parseFloat(t.value) } }
    if (t.type === "STR") { this.eat(); return { k: "str", val: t.value } }

    if (t.type === "CELL") {
      this.eat()
      if (this.peek().type === "COLON") {
        this.eat()
        const to = this.expect("CELL")
        return { k: "range", from: t.value, to: to.value }
      }
      return { k: "cell", ref: t.value }
    }

    if (t.type === "IDENT") {
      this.eat()
      // Boolean literals
      if (t.value === "TRUE") return { k: "num", val: 1 }
      if (t.value === "FALSE") return { k: "num", val: 0 }
      this.expect("LPAREN")
      const args: Expr[] = []
      while (this.peek().type !== "RPAREN" && this.peek().type !== "EOF") {
        args.push(this.parse())
        if (this.peek().type === "COMMA") this.eat()
      }
      this.expect("RPAREN")
      return { k: "call", name: t.value, args }
    }

    if (t.type === "LPAREN") {
      this.eat()
      const e = this.parse()
      this.expect("RPAREN")
      return e
    }

    throw new Error(`Unexpected token "${t.value}"`)
  }
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

function toNum(v: CellValue): number | CellError {
  if (v instanceof CellError) return v
  if (typeof v === "number") return v
  const n = parseFloat(String(v))
  return isNaN(n) ? new CellError("VALUE") : n
}

function isTruthy(v: CellValue) {
  if (v instanceof CellError) return false
  return typeof v === "number" ? v !== 0 : v !== "" && v !== "0"
}

function evalExpr(e: Expr, lookup: CellLookup): CellValue {
  switch (e.k) {
    case "num": return e.val
    case "str": return e.val
    case "cell": return lookup(e.ref)
    case "range": return new CellError("VALUE") // ranges only valid inside functions

    case "neg": {
      const v = toNum(evalExpr(e.e, lookup))
      return v instanceof CellError ? v : -v
    }

    case "bin": {
      if (e.op === "&") {
        const l = evalExpr(e.l, lookup), r = evalExpr(e.r, lookup)
        if (l instanceof CellError) return l
        if (r instanceof CellError) return r
        return String(l) + String(r)
      }
      // Comparison operators
      if (["=","<>","<",">","<=",">="].includes(e.op)) {
        const l = evalExpr(e.l, lookup), r = evalExpr(e.r, lookup)
        if (l instanceof CellError) return l
        if (r instanceof CellError) return r
        const compare = (a: CellValue, b: CellValue) => {
          if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0
          return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
        }
        const cmp = compare(l, r)
        const result = e.op === "=" ? cmp === 0 : e.op === "<>" ? cmp !== 0
          : e.op === "<" ? cmp < 0 : e.op === ">" ? cmp > 0
          : e.op === "<=" ? cmp <= 0 : cmp >= 0
        return result ? 1 : 0
      }
      const l = toNum(evalExpr(e.l, lookup))
      const r = toNum(evalExpr(e.r, lookup))
      if (l instanceof CellError) return l
      if (r instanceof CellError) return r
      switch (e.op) {
        case "+": return l + r
        case "-": return l - r
        case "*": return l * r
        case "/": return r === 0 ? new CellError("DIV/0") : l / r
        case "^": return Math.pow(l, r)
      }
      return new CellError("VALUE")
    }

    case "call": {
      // Expand range args before passing to functions
      const vals: CellValue[] = []
      for (const arg of e.args) {
        if (arg.k === "range") {
          for (const key of expandRange(arg.from, arg.to)) vals.push(lookup(key))
        } else {
          vals.push(evalExpr(arg, lookup))
        }
      }
      return callFn(e.name, vals, e.args, lookup)
    }
  }
}

function nums(vals: CellValue[]): number[] {
  return vals.flatMap(v => {
    if (typeof v === "number") return [v]
    if (typeof v === "string" && v !== "") { const n = parseFloat(v); return isNaN(n) ? [] : [n] }
    return []
  })
}

function callFn(name: string, vals: CellValue[], _rawArgs: Expr[], _lookup: CellLookup): CellValue {
  const ns = nums(vals)
  switch (name) {
    case "SUM":     return ns.reduce((a, b) => a + b, 0)
    case "AVERAGE":
    case "AVG":     return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : new CellError("DIV/0")
    case "MIN":     return ns.length ? Math.min(...ns) : new CellError("VALUE")
    case "MAX":     return ns.length ? Math.max(...ns) : new CellError("VALUE")
    case "COUNT":   return ns.length
    case "COUNTA":  return vals.filter(v => !(v instanceof CellError) && v !== "").length
    case "ABS":     return ns.length ? Math.abs(ns[0]) : new CellError("VALUE")
    case "ROUND":   return ns.length >= 1 ? parseFloat(ns[0].toFixed(ns[1] ?? 0)) : new CellError("VALUE")
    case "FLOOR":   return ns.length ? Math.floor(ns[0]) : new CellError("VALUE")
    case "CEILING":
    case "CEIL":    return ns.length ? Math.ceil(ns[0]) : new CellError("VALUE")
    case "SQRT":    return ns.length ? (ns[0] < 0 ? new CellError("NUM") : Math.sqrt(ns[0])) : new CellError("VALUE")
    case "MOD":     return ns.length >= 2 ? (ns[1] === 0 ? new CellError("DIV/0") : ns[0] % ns[1]) : new CellError("VALUE")
    case "POWER":
    case "POW":     return ns.length >= 2 ? Math.pow(ns[0], ns[1]) : new CellError("VALUE")
    case "LOG":     return ns.length ? (ns[0] <= 0 ? new CellError("NUM") : Math.log(ns[0]) / Math.log(ns[1] ?? 10)) : new CellError("VALUE")
    case "LN":      return ns.length ? (ns[0] <= 0 ? new CellError("NUM") : Math.log(ns[0])) : new CellError("VALUE")
    case "EXP":     return ns.length ? Math.exp(ns[0]) : new CellError("VALUE")
    case "PI":      return Math.PI
    case "IF": {
      if (vals.length < 2) return new CellError("VALUE")
      return isTruthy(vals[0]) ? vals[1] : (vals[2] ?? 0)
    }
    case "AND": return vals.every(isTruthy) ? 1 : 0
    case "OR":  return vals.some(isTruthy) ? 1 : 0
    case "NOT": return vals.length ? (isTruthy(vals[0]) ? 0 : 1) : new CellError("VALUE")
    case "IFERROR": return vals.length >= 2 && vals[0] instanceof CellError ? vals[1] : (vals[0] ?? new CellError("VALUE"))
    case "CONCAT":
    case "CONCATENATE": return vals.map(v => v instanceof CellError ? "" : String(v)).join("")
    case "LEN":   return vals.length ? String(vals[0] instanceof CellError ? "" : vals[0]).length : new CellError("VALUE")
    case "UPPER": return vals.length ? String(vals[0] instanceof CellError ? "" : vals[0]).toUpperCase() : new CellError("VALUE")
    case "LOWER": return vals.length ? String(vals[0] instanceof CellError ? "" : vals[0]).toLowerCase() : new CellError("VALUE")
    case "TRIM":  return vals.length ? String(vals[0] instanceof CellError ? "" : vals[0]).trim() : new CellError("VALUE")
    case "TEXT":  return vals.length ? String(vals[0] instanceof CellError ? "" : vals[0]) : new CellError("VALUE")
    case "VALUE": return ns.length ? ns[0] : new CellError("VALUE")
    // ── Date functions ────────────────────────────────────────────────────
    case "TODAY": return dateToSerial(new Date())
    case "NOW": {
      const now = new Date()
      const frac = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86400
      return dateToSerial(now) + frac
    }
    case "DATE":
      return ns.length >= 3
        ? dateToSerial(new Date(Date.UTC(ns[0], ns[1] - 1, ns[2])))
        : new CellError("VALUE")
    case "YEAR":   return ns.length ? serialToDate(ns[0]).getUTCFullYear() : new CellError("VALUE")
    case "MONTH":  return ns.length ? serialToDate(ns[0]).getUTCMonth() + 1 : new CellError("VALUE")
    case "DAY":    return ns.length ? serialToDate(ns[0]).getUTCDate() : new CellError("VALUE")
    case "HOUR":   return ns.length ? serialToDate(ns[0]).getUTCHours() : new CellError("VALUE")
    case "MINUTE": return ns.length ? serialToDate(ns[0]).getUTCMinutes() : new CellError("VALUE")
    case "SECOND": return ns.length ? serialToDate(ns[0]).getUTCSeconds() : new CellError("VALUE")
    case "DAYS":   return ns.length >= 2 ? ns[0] - ns[1] : new CellError("VALUE")
    case "EDATE": {
      if (ns.length < 2) return new CellError("VALUE")
      const d = serialToDate(ns[0])
      d.setUTCMonth(d.getUTCMonth() + ns[1])
      return dateToSerial(d)
    }
    case "EOMONTH": {
      if (ns.length < 2) return new CellError("VALUE")
      const d = serialToDate(ns[0])
      d.setUTCMonth(d.getUTCMonth() + ns[1] + 1, 0)
      return dateToSerial(d)
    }
    case "WEEKDAY": return ns.length ? serialToDate(ns[0]).getUTCDay() + 1 : new CellError("VALUE")
    default:      return new CellError("NAME")
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Build a memoized lookup function for a sheet's cells. */
export function makeLookup(cells: Record<string, string>): CellLookup {
  const cache = new Map<string, CellValue>()
  const visiting = new Set<string>()

  function lookup(key: string): CellValue {
    if (cache.has(key)) return cache.get(key)!
    if (visiting.has(key)) return new CellError("CIRC")
    const raw = cells[key] ?? ""
    if (!raw) return ""
    visiting.add(key)
    let result: CellValue
    if (raw.startsWith("=")) {
      try {
        const tokens = tokenize(raw.slice(1))
        const ast = new Parser(tokens).parse()
        result = evalExpr(ast, lookup)
      } catch {
        result = new CellError("PARSE")
      }
    } else {
      const n = parseFloat(raw)
      result = raw.trim() !== "" && !isNaN(n) ? n : raw
    }
    visiting.delete(key)
    cache.set(key, result)
    return result
  }

  return lookup
}

/**
 * Shift all relative cell references in a formula by (rowDelta, colDelta).
 * Input formula should NOT include the leading "=".
 */
export function shiftFormula(formula: string, rowDelta: number, colDelta: number): string {
  if (rowDelta === 0 && colDelta === 0) return formula
  const tokens = tokenize(formula)
  return tokens
    .slice(0, -1) // remove EOF
    .map((t) => {
      if (t.type !== "CELL") return t.value
      const m = t.value.match(/^([A-Z]+)(\d+)$/)
      if (!m) return t.value
      let col = 0
      for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
      col = col - 1 + colDelta
      const row = parseInt(m[2]) - 1 + rowDelta
      if (col < 0 || row < 0 || col > 25 || row > 49) return "#REF!"
      let colStr = ""
      let c = col + 1
      while (c > 0) { colStr = String.fromCharCode(64 + (c % 26 || 26)) + colStr; c = Math.floor((c - 1) / 26) }
      return `${colStr}${row + 1}`
    })
    .join("")
}

/** Format a CellValue for display in a cell. */
export function formatValue(v: CellValue): string {
  if (v instanceof CellError) return v.toString()
  if (typeof v === "number") {
    if (!isFinite(v)) return v > 0 ? "#INF!" : "#-INF!"
    if (Number.isInteger(v)) return String(v)
    return parseFloat(v.toPrecision(10)).toString()
  }
  return String(v)
}
