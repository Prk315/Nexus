import { configureStore } from "@reduxjs/toolkit"
import appReducer from "./slices/appSlice"
import spreadsheetReducer from "./slices/spreadsheetSlice"
import historyReducer from "./slices/historySlice"
import { persistenceMiddleware } from "./middleware/persistenceMiddleware"
import { historyMiddleware } from "./middleware/historyMiddleware"

export const store = configureStore({
  reducer: {
    app: appReducer,
    spreadsheet: spreadsheetReducer,
    history: historyReducer,
  },
  middleware: (getDefault) =>
    getDefault()
      .prepend(persistenceMiddleware.middleware)
      .prepend(historyMiddleware.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
