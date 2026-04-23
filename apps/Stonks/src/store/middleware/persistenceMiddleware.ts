import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit"
import { invoke } from "@tauri-apps/api/core"
import type { RootState } from "../index"
import {
  setCellValue,
  setCellValueBatch,
  setCellFormat,
  setColWidth,
  setRowHeight,
  addSheet,
  deleteSheet,
  renameSheet,
} from "../slices/spreadsheetSlice"

export const persistenceMiddleware = createListenerMiddleware()

const listen = persistenceMiddleware.startListening

// ── Cell value ────────────────────────────────────────────────────────────────

listen({
  actionCreator: setCellValue,
  effect: async (action, api) => {
    const { sheetId, key, value } = action.payload
    if (value === "") {
      await invoke("db_delete_cell", { sheetId, cellKey: key }).catch(console.error)
    } else {
      const state = api.getState() as RootState
      const sheet = state.spreadsheet.sheets.find((s) => s.id === sheetId)
      const format = sheet?.formats?.[key] ?? null
      await invoke("db_save_cell", { sheetId, cellKey: key, value, format }).catch(console.error)
    }
  },
})

listen({
  actionCreator: setCellValueBatch,
  effect: async (action, api) => {
    const state = api.getState() as RootState
    for (const { sheetId, key, value } of action.payload) {
      if (value === "") {
        await invoke("db_delete_cell", { sheetId, cellKey: key }).catch(console.error)
      } else {
        const sheet = state.spreadsheet.sheets.find((s) => s.id === sheetId)
        const format = sheet?.formats?.[key] ?? null
        await invoke("db_save_cell", { sheetId, cellKey: key, value, format }).catch(console.error)
      }
    }
  },
})

// ── Cell format ───────────────────────────────────────────────────────────────

listen({
  actionCreator: setCellFormat,
  effect: async (action, api) => {
    const { sheetId, key, format } = action.payload
    const state = api.getState() as RootState
    const sheet = state.spreadsheet.sheets.find((s) => s.id === sheetId)
    const value = sheet?.cells?.[key]
    if (!value) return // no cell value to update
    await invoke("db_save_cell", { sheetId, cellKey: key, value, format: format ?? null }).catch(
      console.error
    )
  },
})

// ── Column / Row sizing ───────────────────────────────────────────────────────

listen({
  actionCreator: setColWidth,
  effect: async (action) => {
    const { sheetId, col, width } = action.payload
    await invoke("db_set_col_width", { sheetId, colIndex: col, widthPx: width }).catch(
      console.error
    )
  },
})

listen({
  actionCreator: setRowHeight,
  effect: async (action) => {
    const { sheetId, row, height } = action.payload
    await invoke("db_set_row_height", { sheetId, rowIndex: row, heightPx: height }).catch(
      console.error
    )
  },
})

// ── Sheet operations ──────────────────────────────────────────────────────────

listen({
  actionCreator: addSheet,
  effect: async (_action, api) => {
    const state = api.getState() as RootState
    const sheets = state.spreadsheet.sheets
    const newSheet = sheets[sheets.length - 1]
    await invoke("db_add_sheet", {
      id: newSheet.id,
      name: newSheet.name,
      position: sheets.length - 1,
    }).catch(console.error)
  },
})

listen({
  actionCreator: deleteSheet,
  effect: async (action) => {
    await invoke("db_delete_sheet", { sheetId: action.payload }).catch(console.error)
  },
})

listen({
  matcher: isAnyOf(renameSheet),
  effect: async (action) => {
    const p = action.payload as { id: string; name: string }
    await invoke("db_rename_sheet", {
      sheetId: p.id,
      name: p.name,
    }).catch(console.error)
  },
})
