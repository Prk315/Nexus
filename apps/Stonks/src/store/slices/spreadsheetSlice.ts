import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit"

export interface Sheet {
  id: string
  name: string
  cells: Record<string, string>
  formats: Record<string, string>       // cell key → format string (Feature 3)
  colWidths: Record<number, number>     // col index → px width  (Feature 5)
  rowHeights: Record<number, number>    // row index → px height (Feature 5)
}

interface SpreadsheetState {
  sheets: Sheet[]
  activeSheetId: string
}

function makeSheet(name: string): Sheet {
  return { id: nanoid(), name, cells: {}, formats: {}, colWidths: {}, rowHeights: {} }
}

const firstSheet = makeSheet("Sheet1")

const initialState: SpreadsheetState = {
  sheets: [firstSheet],
  activeSheetId: firstSheet.id,
}

const spreadsheetSlice = createSlice({
  name: "spreadsheet",
  initialState,
  reducers: {
    // ── Cell value ────────────────────────────────────────────────────────
    setCellValue(
      state,
      action: PayloadAction<{ sheetId: string; key: string; value: string }>
    ) {
      const sheet = state.sheets.find((s) => s.id === action.payload.sheetId)
      if (!sheet) return
      if (action.payload.value === "") {
        delete sheet.cells[action.payload.key]
      } else {
        sheet.cells[action.payload.key] = action.payload.value
      }
    },

    setCellValueBatch(
      state,
      action: PayloadAction<Array<{ sheetId: string; key: string; value: string }>>
    ) {
      for (const { sheetId, key, value } of action.payload) {
        const sheet = state.sheets.find((s) => s.id === sheetId)
        if (!sheet) continue
        if (value === "") {
          delete sheet.cells[key]
        } else {
          sheet.cells[key] = value
        }
      }
    },

    // ── Cell format ───────────────────────────────────────────────────────
    setCellFormat(
      state,
      action: PayloadAction<{ sheetId: string; key: string; format: string | null }>
    ) {
      const sheet = state.sheets.find((s) => s.id === action.payload.sheetId)
      if (!sheet) return
      if (action.payload.format === null || action.payload.format === "") {
        delete sheet.formats[action.payload.key]
      } else {
        sheet.formats[action.payload.key] = action.payload.format
      }
    },

    // ── Column / Row sizing ────────────────────────────────────────────────
    setColWidth(
      state,
      action: PayloadAction<{ sheetId: string; col: number; width: number }>
    ) {
      const sheet = state.sheets.find((s) => s.id === action.payload.sheetId)
      if (!sheet) return
      sheet.colWidths[action.payload.col] = action.payload.width
    },

    setRowHeight(
      state,
      action: PayloadAction<{ sheetId: string; row: number; height: number }>
    ) {
      const sheet = state.sheets.find((s) => s.id === action.payload.sheetId)
      if (!sheet) return
      sheet.rowHeights[action.payload.row] = action.payload.height
    },

    // ── Sheets ────────────────────────────────────────────────────────────
    addSheet(state) {
      const nums = state.sheets
        .map((s) => { const m = s.name.match(/^Sheet(\d+)$/); return m ? parseInt(m[1]) : 0 })
        .filter((n) => n > 0)
      const next = nums.length ? Math.max(...nums) + 1 : state.sheets.length + 1
      const sheet = makeSheet(`Sheet${next}`)
      state.sheets.push(sheet)
      state.activeSheetId = sheet.id
    },

    deleteSheet(state, action: PayloadAction<string>) {
      if (state.sheets.length <= 1) return
      const idx = state.sheets.findIndex((s) => s.id === action.payload)
      if (idx === -1) return
      state.sheets.splice(idx, 1)
      if (state.activeSheetId === action.payload) {
        state.activeSheetId = state.sheets[Math.max(0, idx - 1)].id
      }
    },

    renameSheet(state, action: PayloadAction<{ id: string; name: string }>) {
      const sheet = state.sheets.find((s) => s.id === action.payload.id)
      if (sheet) sheet.name = action.payload.name
    },

    setActiveSheet(state, action: PayloadAction<string>) {
      state.activeSheetId = action.payload
    },

    // ── Persistence ───────────────────────────────────────────────────────
    loadWorkbook(
      state,
      action: PayloadAction<{ sheets: Sheet[]; activeSheetId: string }>
    ) {
      state.sheets = action.payload.sheets
      state.activeSheetId = action.payload.activeSheetId
    },
  },
})

export const {
  setCellValue,
  setCellValueBatch,
  setCellFormat,
  setColWidth,
  setRowHeight,
  addSheet,
  deleteSheet,
  renameSheet,
  setActiveSheet,
  loadWorkbook,
} = spreadsheetSlice.actions

export default spreadsheetSlice.reducer
