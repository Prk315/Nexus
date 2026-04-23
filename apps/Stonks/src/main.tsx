import React from "react"
import ReactDOM from "react-dom/client"
import { Provider } from "react-redux"
import { invoke } from "@tauri-apps/api/core"
import { store } from "./store"
import { loadWorkbook } from "./store/slices/spreadsheetSlice"
import type { Sheet } from "./store/slices/spreadsheetSlice"
import App from "./App"
import "./App.css"

interface CellRow { cell_key: string; value: string; format: string | null }
interface SheetData {
  id: string; name: string; position: number
  cells: CellRow[]
  col_widths: [number, number][]
  row_heights: [number, number][]
}
interface WorkbookData { sheets: SheetData[] }

async function bootstrap() {
  try {
    const data = await invoke<WorkbookData>("db_load_workbook")
    if (data.sheets.length > 0) {
      const sheets: Sheet[] = data.sheets.map((s) => ({
        id: s.id,
        name: s.name,
        cells: Object.fromEntries(s.cells.map((c) => [c.cell_key, c.value])),
        formats: Object.fromEntries(
          s.cells.filter((c) => c.format).map((c) => [c.cell_key, c.format!])
        ),
        colWidths: Object.fromEntries(s.col_widths.map(([i, w]) => [i, w])),
        rowHeights: Object.fromEntries(s.row_heights.map(([i, h]) => [i, h])),
      }))
      store.dispatch(loadWorkbook({ sheets, activeSheetId: sheets[0].id }))

      // Ensure the default sheet is persisted on first launch
      // (sheets already in DB, so nothing to write)
    }
  } catch (e) {
    console.warn("DB load failed (expected in browser dev mode):", e)
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>
  )
}

bootstrap()
