import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

// ─── Patch types ─────────────────────────────────────────────────────────────

export type CellPatch = {
  type: "cell"
  sheetId: string
  key: string
  before: string
  after: string
}

export type BatchPatch = {
  type: "batch"
  patches: CellPatch[]
}

export type SheetAddPatch = {
  type: "sheetAdd"
  id: string
  name: string
}

export type SheetDeletePatch = {
  type: "sheetDelete"
  id: string
  name: string
  position: number
  cells: Record<string, string>
}

export type SheetRenamePatch = {
  type: "sheetRename"
  id: string
  before: string
  after: string
}

export type UndoPatch =
  | CellPatch
  | BatchPatch
  | SheetAddPatch
  | SheetDeletePatch
  | SheetRenamePatch

// ─── State ───────────────────────────────────────────────────────────────────

const MAX_HISTORY = 100

interface HistoryState {
  past: UndoPatch[]
  future: UndoPatch[]
}

const initialState: HistoryState = {
  past: [],
  future: [],
}

const historySlice = createSlice({
  name: "history",
  initialState,
  reducers: {
    pushPatch(state, action: PayloadAction<UndoPatch>) {
      state.past.push(action.payload)
      if (state.past.length > MAX_HISTORY) state.past.shift()
      state.future = [] // new action clears redo stack
    },

    undo(state) {
      const patch = state.past.pop()
      if (patch) state.future.push(patch)
    },

    redo(state) {
      const patch = state.future.pop()
      if (patch) state.past.push(patch)
    },

    clearHistory(state) {
      state.past = []
      state.future = []
    },
  },
})

export const { pushPatch, undo, redo, clearHistory } = historySlice.actions
export default historySlice.reducer
