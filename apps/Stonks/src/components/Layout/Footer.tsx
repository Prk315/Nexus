import { useAppSelector } from "../../store/hooks"

export default function Footer() {
  const sheets = useAppSelector((state) => state.spreadsheet.sheets)
  const activeId = useAppSelector((state) => state.spreadsheet.activeSheetId)
  const activeSheet = sheets.find((s) => s.id === activeId)
  const cellCount = activeSheet ? Object.keys(activeSheet.cells).length : 0

  return (
    <footer className="flex items-center justify-between h-6 px-3 border-t border-border bg-muted/30 shrink-0 select-none">
      <span className="text-xs text-muted-foreground">
        {activeSheet?.name ?? ""} · {cellCount} {cellCount === 1 ? "cell" : "cells"} used
      </span>
      <span className="text-xs text-muted-foreground">
        {sheets.length} {sheets.length === 1 ? "sheet" : "sheets"}
      </span>
    </footer>
  )
}
