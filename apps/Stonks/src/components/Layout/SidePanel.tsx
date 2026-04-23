import { useState } from "react"
import { useAppDispatch, useAppSelector } from "../../store/hooks"
import { setCellFormat } from "../../store/slices/spreadsheetSlice"
import { FORMAT_PRESETS } from "../../lib/format"

interface SidePanelProps {
  side: "left" | "right"
}

export default function SidePanel({ side }: SidePanelProps) {
  const [locked, setLocked] = useState(false)
  const [hovered, setHovered] = useState(false)
  const open = locked || hovered
  const isLeft = side === "left"

  return (
    <div
      className={[
        "absolute top-0 bottom-0 z-20 flex",
        isLeft ? "left-0 flex-row" : "right-0 flex-row-reverse",
      ].join(" ")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Trigger bar */}
      <div className="w-1.5 shrink-0 bg-muted-foreground/20 hover:bg-muted-foreground/40 transition-colors cursor-default" />

      {/* Sidebar panel */}
      <div
        className={[
          "flex flex-col bg-card border-border overflow-hidden min-w-0",
          "transition-[width] duration-150 ease-in-out",
          isLeft
            ? "border-r shadow-[2px_0_8px_rgba(0,0,0,0.08)]"
            : "border-l shadow-[-2px_0_8px_rgba(0,0,0,0.08)]",
          open ? "w-56" : "w-0",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none whitespace-nowrap">
            {isLeft ? "Navigator" : "Properties"}
          </span>
          <button
            onClick={() => setLocked((v) => !v)}
            title={locked ? "Unlock — auto-hide on mouse leave" : "Lock — keep open"}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {locked ? <LockClosedIcon /> : <LockOpenIcon />}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-3">
          {isLeft ? <LeftContent /> : <RightContent />}
        </div>
      </div>
    </div>
  )
}

// ─── Left panel: Navigator ────────────────────────────────────────────────────

function LeftContent() {
  const sheets = useAppSelector((s) => s.spreadsheet.sheets)
  const activeId = useAppSelector((s) => s.spreadsheet.activeSheetId)

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground mb-2">Sheets</p>
      {sheets.map((sheet) => (
        <div
          key={sheet.id}
          className={[
            "text-xs px-2 py-1 rounded truncate",
            sheet.id === activeId
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "text-muted-foreground",
          ].join(" ")}
        >
          {sheet.name}
        </div>
      ))}
    </div>
  )
}

// ─── Right panel: Properties ─────────────────────────────────────────────────

function RightContent() {
  const dispatch = useAppDispatch()
  const activeId = useAppSelector((s) => s.spreadsheet.activeSheetId)

  // Read selected cell info from spreadsheet state
  // We need the anchor key — store it in a selector that reads from a shared source.
  // Since selection is local to the Spreadsheet component, we expose it via a
  // lightweight selector on the Redux store's spreadsheet slice.
  // For now we track the "last edited key" via a simple global ref approach:
  // Actually, we'll just show the format for whatever the user selects.
  // The simplest approach: read the active sheet's formats and expose a format input
  // that the user can type into, with the cell key also typed in.

  const activeSheet = useAppSelector(
    (s) => s.spreadsheet.sheets.find((sh) => sh.id === activeId)
  )

  const [cellRef, setCellRef] = useState("A1")
  const fmt = activeSheet?.formats?.[cellRef.toUpperCase()] ?? ""

  function handleFormatChange(newFmt: string) {
    dispatch(setCellFormat({ sheetId: activeId, key: cellRef.toUpperCase(), format: newFmt }))
  }

  return (
    <div className="space-y-3">
      {/* Cell reference input */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Cell</label>
        <input
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground font-mono"
          value={cellRef}
          onChange={(e) => setCellRef(e.target.value)}
          placeholder="A1"
        />
      </div>

      {/* Format string */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Format</label>
        <input
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground font-mono"
          value={fmt}
          onChange={(e) => handleFormatChange(e.target.value)}
          placeholder="e.g. $#,##0.00"
        />
      </div>

      {/* Presets */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Presets</label>
        <div className="space-y-1">
          {FORMAT_PRESETS.map((p) => (
            <button
              key={p.label}
              className={[
                "w-full text-left text-xs px-2 py-1 rounded transition-colors",
                fmt === p.fmt
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "hover:bg-muted text-muted-foreground",
              ].join(" ")}
              onClick={() => handleFormatChange(p.fmt)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function LockClosedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function LockOpenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  )
}
