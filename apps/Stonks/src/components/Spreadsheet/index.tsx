import { useEffect, useMemo, useRef, useState } from "react"
import { useAppDispatch, useAppSelector } from "../../store/hooks"
import {
  addSheet, deleteSheet, renameSheet, setActiveSheet, setCellValue, setCellValueBatch, setColWidth, setRowHeight,
} from "../../store/slices/spreadsheetSlice"
import { undo, redo } from "../../store/slices/historySlice"
import { makeLookup, formatValue, shiftFormula, CellError } from "../../lib/formula"
import { applyFormat } from "../../lib/format"
import { detectFillSeries } from "../../lib/fillSeries"

const NUM_ROWS = 50
const NUM_COLS = 26

const colLetter = (col: number) => String.fromCharCode(65 + col)
const cellKey = (row: number, col: number) => `${colLetter(col)}${row + 1}`

type Pos = { row: number; col: number }
type Selection = { anchor: Pos; focus: Pos }

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function selRange(sel: Selection) {
  return {
    minRow: Math.min(sel.anchor.row, sel.focus.row),
    maxRow: Math.max(sel.anchor.row, sel.focus.row),
    minCol: Math.min(sel.anchor.col, sel.focus.col),
    maxCol: Math.max(sel.anchor.col, sel.focus.col),
  }
}

function inRange(row: number, col: number, sel: Selection) {
  const { minRow, maxRow, minCol, maxCol } = selRange(sel)
  return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol
}

function isSingle(sel: Selection) {
  return sel.anchor.row === sel.focus.row && sel.anchor.col === sel.focus.col
}

// ─── Sheet tabs ──────────────────────────────────────────────────────────────

function SheetTabs() {
  const dispatch = useAppDispatch()
  const sheets = useAppSelector((s) => s.spreadsheet.sheets)
  const activeId = useAppSelector((s) => s.spreadsheet.activeSheetId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (renamingId) renameInputRef.current?.focus() }, [renamingId])

  function commitRename() {
    if (!renamingId) return
    const name = renameValue.trim()
    if (name) dispatch(renameSheet({ id: renamingId, name }))
    setRenamingId(null)
  }

  return (
    <div className="flex items-end border-b border-border bg-muted/50 shrink-0 overflow-x-auto">
      {sheets.map((sheet) => {
        const isActive = sheet.id === activeId
        const isRenaming = renamingId === sheet.id
        return (
          <div
            key={sheet.id}
            className={[
              "group flex items-center gap-1 px-3 h-8 border-r border-border text-sm cursor-pointer shrink-0 select-none",
              isActive
                ? "bg-background text-foreground border-b-2 border-b-blue-500 -mb-px"
                : "text-muted-foreground hover:bg-background/60",
            ].join(" ")}
            onClick={() => dispatch(setActiveSheet(sheet.id))}
            onDoubleClick={() => { setRenamingId(sheet.id); setRenameValue(sheet.name) }}
          >
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="w-20 text-sm bg-transparent outline outline-1 outline-blue-500 rounded px-0.5"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null) }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{sheet.name}</span>
            )}
            {sheets.length > 1 && (
              <button
                className="ml-1 opacity-0 group-hover:opacity-100 hover:text-destructive text-muted-foreground leading-none"
                onClick={(e) => { e.stopPropagation(); dispatch(deleteSheet(sheet.id)) }}
              >×</button>
            )}
          </div>
        )
      })}
      <button
        className="px-3 h-8 text-muted-foreground hover:text-foreground hover:bg-background/60 text-lg leading-none shrink-0"
        onClick={() => dispatch(addSheet())}
        title="Add sheet"
      >+</button>
    </div>
  )
}

// ─── Spreadsheet grid ────────────────────────────────────────────────────────

export default function Spreadsheet() {
  const dispatch = useAppDispatch()
  const activeId = useAppSelector((s) => s.spreadsheet.activeSheetId)
  const activeSheet = useAppSelector(
    (s) => s.spreadsheet.sheets.find((sh) => sh.id === activeId)
  )
  const cells = activeSheet?.cells ?? {}
  const formats = activeSheet?.formats ?? {}
  const colWidths = activeSheet?.colWidths ?? {}
  const rowHeights = activeSheet?.rowHeights ?? {}

  const lookup = useMemo(() => makeLookup(cells), [cells])

  const [sel, setSel] = useState<Selection>({
    anchor: { row: 0, col: 0 },
    focus: { row: 0, col: 0 },
  })
  const [editing, setEditing] = useState<Pos | null>(null)
  const [editValue, setEditValue] = useState("")
  const [copiedRange, setCopiedRange] = useState<Selection | null>(null)
  const [resizingCol, setResizingCol] = useState<{ col: number; width: number } | null>(null)
  const [resizingRow, setResizingRow] = useState<{ row: number; height: number } | null>(null)
  const [fillPreview, setFillPreview] = useState<Selection | null>(null)
  const fillPreviewRef = useRef<Selection | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditing(null)
    setSel({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
  }, [activeId])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
    else containerRef.current?.focus()
  }, [editing])

  function navigate(row: number, col: number, extend = false) {
    const pos = { row: clamp(row, 0, NUM_ROWS - 1), col: clamp(col, 0, NUM_COLS - 1) }
    setSel((prev) => extend ? { ...prev, focus: pos } : { anchor: pos, focus: pos })
  }

  function commitEdit() {
    if (!editing) return
    dispatch(setCellValue({ sheetId: activeId, key: cellKey(editing.row, editing.col), value: editValue }))
    setEditing(null)
  }

  function startEditing(pos: Pos, initial?: string) {
    const raw = initial !== undefined ? initial : (cells[cellKey(pos.row, pos.col)] ?? "")
    setSel({ anchor: pos, focus: pos })
    setEditing(pos)
    setEditValue(raw)
  }

  function handleColResizeStart(e: React.MouseEvent, col: number) {
    e.preventDefault()
    const startX = e.clientX
    const baseWidth = colWidths[col] ?? 96
    const onMove = (ev: MouseEvent) => {
      const width = Math.max(40, baseWidth + ev.clientX - startX)
      setResizingCol({ col, width })
    }
    const onUp = (ev: MouseEvent) => {
      const width = Math.max(40, baseWidth + ev.clientX - startX)
      dispatch(setColWidth({ sheetId: activeId, col, width }))
      setResizingCol(null)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function handleRowResizeStart(e: React.MouseEvent, row: number) {
    e.preventDefault()
    const startY = e.clientY
    const baseHeight = rowHeights[row] ?? 24
    const onMove = (ev: MouseEvent) => {
      const height = Math.max(18, baseHeight + ev.clientY - startY)
      setResizingRow({ row, height })
    }
    const onUp = (ev: MouseEvent) => {
      const height = Math.max(18, baseHeight + ev.clientY - startY)
      dispatch(setRowHeight({ sheetId: activeId, row, height }))
      setResizingRow(null)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function handleCopy() {
    const { minRow, maxRow, minCol, maxCol } = selRange(sel)
    const tsv = Array.from({ length: maxRow - minRow + 1 }, (_, ri) =>
      Array.from({ length: maxCol - minCol + 1 }, (_, ci) =>
        cells[cellKey(minRow + ri, minCol + ci)] ?? ""
      ).join("\t")
    ).join("\n")
    navigator.clipboard.writeText(tsv).catch(console.error)
    setCopiedRange({ ...sel })
  }

  function handlePaste() {
    navigator.clipboard.readText().then((text) => {
      const rows = text.split(/\r?\n/)
      const patches: Array<{ sheetId: string; key: string; value: string }> = []
      const { anchor } = sel
      rows.forEach((row, ri) => {
        row.split("\t").forEach((raw, ci) => {
          const targetRow = anchor.row + ri
          const targetCol = anchor.col + ci
          if (targetRow >= NUM_ROWS || targetCol >= NUM_COLS) return
          const key = cellKey(targetRow, targetCol)
          const value =
            raw.startsWith("=")
              ? "=" + shiftFormula(raw.slice(1), ri, ci)
              : raw
          patches.push({ sheetId: activeId, key, value })
        })
      })
      if (patches.length > 0) dispatch(setCellValueBatch(patches))
    }).catch(console.error)
  }

  function executeFill(target: Selection) {
    const src = selRange(sel)
    const tgt = selRange(target)

    // Determine direction and source/fill ranges
    let direction: "down" | "right"
    let sourceValues: string[]
    let fillCells: Array<{ row: number; col: number }>

    if (tgt.maxRow > src.maxRow) {
      // Fill down
      direction = "down"
      sourceValues = Array.from(
        { length: src.maxRow - src.minRow + 1 },
        (_, ri) => cells[cellKey(src.minRow + ri, src.minCol)] ?? ""
      )
      fillCells = Array.from(
        { length: tgt.maxRow - src.maxRow },
        (_, i) => ({ row: src.maxRow + 1 + i, col: src.minCol })
      )
    } else if (tgt.maxCol > src.maxCol) {
      // Fill right
      direction = "right"
      sourceValues = Array.from(
        { length: src.maxCol - src.minCol + 1 },
        (_, ci) => cells[cellKey(src.minRow, src.minCol + ci)] ?? ""
      )
      fillCells = Array.from(
        { length: tgt.maxCol - src.maxCol },
        (_, i) => ({ row: src.minRow, col: src.maxCol + 1 + i })
      )
    } else {
      return
    }

    const rowDelta = direction === "down" ? 1 : 0
    const colDelta = direction === "right" ? 1 : 0
    const filled = detectFillSeries(sourceValues, fillCells.length, direction, rowDelta, colDelta)

    const patches = fillCells.map((pos, i) => ({
      sheetId: activeId,
      key: cellKey(pos.row, pos.col),
      value: filled[i] ?? "",
    }))

    if (patches.length > 0) dispatch(setCellValueBatch(patches))
  }

  function handleFillHandleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    const onMove = (ev: MouseEvent) => {
      // Find which cell the mouse is over by querying the table
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const td = el?.closest("td[data-row][data-col]") as HTMLElement | null
      if (!td) return
      const row = parseInt(td.dataset.row ?? "", 10)
      const col = parseInt(td.dataset.col ?? "", 10)
      if (isNaN(row) || isNaN(col)) return
      const { anchor, focus } = sel
      const srcMinRow = Math.min(anchor.row, focus.row)
      const srcMaxRow = Math.max(anchor.row, focus.row)
      const srcMinCol = Math.min(anchor.col, focus.col)
      const srcMaxCol = Math.max(anchor.col, focus.col)
      if (row > srcMaxRow) {
        const next = { anchor: { row: srcMinRow, col: srcMinCol }, focus: { row, col: srcMaxCol } }
        fillPreviewRef.current = next
        setFillPreview(next)
      } else if (col > srcMaxCol) {
        const next = { anchor: { row: srcMinRow, col: srcMinCol }, focus: { row: srcMaxRow, col } }
        fillPreviewRef.current = next
        setFillPreview(next)
      } else {
        fillPreviewRef.current = null
        setFillPreview(null)
      }
    }

    const onUp = () => {
      const preview = fillPreviewRef.current
      if (preview) {
        executeFill(preview)
        fillPreviewRef.current = null
        setFillPreview(null)
      }
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function handleContainerKeyDown(e: React.KeyboardEvent) {
    if (editing) return
    const { anchor, focus } = sel
    const from = e.shiftKey ? focus : anchor

    switch (e.key) {
      case "ArrowUp":    e.preventDefault(); navigate(from.row - 1, from.col, e.shiftKey); break
      case "ArrowDown":  e.preventDefault(); navigate(from.row + 1, from.col, e.shiftKey); break
      case "ArrowLeft":  e.preventDefault(); navigate(from.row, from.col - 1, e.shiftKey); break
      case "ArrowRight": e.preventDefault(); navigate(from.row, from.col + 1, e.shiftKey); break
      case "Tab":        e.preventDefault(); navigate(anchor.row, anchor.col + (e.shiftKey ? -1 : 1)); break
      case "Enter":
      case "F2":         e.preventDefault(); startEditing(anchor); break
      case "Delete":
      case "Backspace":
        e.preventDefault()
        dispatch(setCellValue({ sheetId: activeId, key: cellKey(anchor.row, anchor.col), value: "" }))
        break
      case "c":
      case "C":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          handleCopy()
        }
        break
      case "v":
      case "V":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          handlePaste()
        }
        break
      case "z":
      case "Z":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          if (e.shiftKey) dispatch(redo())
          else dispatch(undo())
        }
        break
      case "y":
      case "Y":
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); dispatch(redo()) }
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) startEditing(anchor, e.key)
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!editing) return
    switch (e.key) {
      case "Enter":  e.preventDefault(); commitEdit(); navigate(editing.row + 1, editing.col); break
      case "Tab":    e.preventDefault(); commitEdit(); navigate(editing.row, editing.col + (e.shiftKey ? -1 : 1)); break
      case "Escape": e.preventDefault(); setEditing(null); break
    }
  }

  const { anchor } = sel
  const anchorKey = cellKey(anchor.row, anchor.col)
  const { minRow, maxRow, minCol, maxCol } = selRange(sel)
  const refLabel = isSingle(sel)
    ? anchorKey
    : `${cellKey(minRow, minCol)}:${cellKey(maxRow, maxCol)}`
  const rawAnchor = cells[anchorKey] ?? ""

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <SheetTabs />

      {/* Formula bar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border bg-muted/30 shrink-0">
        <div className="w-20 text-center text-xs font-mono font-semibold border border-border rounded px-1 py-0.5 bg-background select-none">
          {refLabel}
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex-1 text-sm px-1 text-foreground font-mono">
          {editing ? editValue : rawAnchor}
        </div>
      </div>

      {/* Grid */}
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex-1 overflow-auto outline-none"
        onKeyDown={handleContainerKeyDown}
      >
        <table className="border-collapse text-sm select-none">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 w-12 min-w-12 h-6 bg-muted border border-border" />
              {Array.from({ length: NUM_COLS }, (_, c) => {
                const colW = resizingCol?.col === c ? resizingCol.width : (colWidths[c] ?? 96)
                return (
                  <th
                    key={c}
                    className={[
                      "relative sticky top-0 z-20 h-6 text-center text-xs font-medium border border-border",
                      c >= minCol && c <= maxCol
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : "bg-muted text-muted-foreground",
                    ].join(" ")}
                    style={{ width: colW, minWidth: colW }}
                  >
                    {colLetter(c)}
                    {/* Resize handle */}
                    <div
                      className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400 z-10"
                      onMouseDown={(e) => handleColResizeStart(e, c)}
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: NUM_ROWS }, (_, r) => {
              const rowH = resizingRow?.row === r ? resizingRow.height : (rowHeights[r] ?? 24)
              return (
              <tr key={r} style={{ height: rowH }}>
                <td
                  className={[
                    "relative sticky left-0 z-10 w-12 min-w-12 text-center text-xs font-medium border border-border select-none",
                    r >= minRow && r <= maxRow
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      : "bg-muted text-muted-foreground",
                  ].join(" ")}
                  style={{ height: rowH }}
                >
                  {r + 1}
                  {/* Row resize handle */}
                  <div
                    className="absolute bottom-0 left-0 w-full h-0.5 cursor-row-resize hover:bg-blue-400 z-10"
                    onMouseDown={(e) => handleRowResizeStart(e, r)}
                  />
                </td>

                {Array.from({ length: NUM_COLS }, (_, c) => {
                  const colW = resizingCol?.col === c ? resizingCol.width : (colWidths[c] ?? 96)
                  const key = cellKey(r, c)
                  const isAnchor = r === anchor.row && c === anchor.col
                  const isInSel = inRange(r, c, sel)
                  const isEditing = editing?.row === r && editing?.col === c
                  const isCopied = copiedRange ? inRange(r, c, copiedRange) : false
                  const evaluated = lookup(key)
                  const isError = evaluated instanceof CellError
                  const fmt = formats[key]
                  const displayVal = cells[key]
                    ? (fmt ? applyFormat(evaluated, fmt) : formatValue(evaluated))
                    : ""
                  const isNumber = typeof evaluated === "number"
                  const isFillPreview = fillPreview ? inRange(r, c, fillPreview) : false

                  return (
                    <td
                      key={c}
                      data-row={r}
                      data-col={c}
                      style={{ width: colW, minWidth: colW, height: rowH }}
                      className={[
                        "relative border border-border p-0 cursor-default",
                        isEditing ? "z-10 bg-background" :
                          isAnchor ? "outline outline-2 outline-blue-500 outline-offset-[-1px] z-10 bg-background" :
                          isInSel ? "bg-blue-100/70 dark:bg-blue-900/30" : "bg-background",
                        isCopied && !isEditing ? "outline outline-1 outline-dashed outline-blue-400 outline-offset-[-1px]" : "",
                        isFillPreview && !isInSel ? "bg-blue-50 dark:bg-blue-900/20" : "",
                      ].join(" ")}
                      onClick={(e) => {
                        if (editing) commitEdit()
                        const pos = { row: r, col: c }
                        setSel((prev) => e.shiftKey ? { ...prev, focus: pos } : { anchor: pos, focus: pos })
                        containerRef.current?.focus()
                      }}
                      onDoubleClick={() => startEditing({ row: r, col: c })}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="absolute inset-0 w-full h-full px-1 outline outline-2 outline-blue-500 bg-background text-foreground text-sm font-mono"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={handleInputKeyDown}
                          onBlur={commitEdit}
                        />
                      ) : (
                        <span className={[
                          "px-1 truncate block text-sm leading-6",
                          isError ? "text-red-500 dark:text-red-400" : "",
                          isNumber && !isError ? "text-right" : "",
                        ].join(" ")}>
                          {displayVal}
                        </span>
                      )}
                      {isAnchor && !isEditing && isSingle(sel) && (
                        <div
                          className="absolute bottom-0 right-0 w-2 h-2 bg-blue-500 cursor-crosshair z-20 translate-x-1/2 translate-y-1/2"
                          onMouseDown={handleFillHandleMouseDown}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
