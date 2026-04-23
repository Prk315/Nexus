import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

interface AppState {
  theme: "light" | "dark"
}

const initialState: AppState = {
  theme: "light",
}

const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<"light" | "dark">) {
      state.theme = action.payload
    },
  },
})

export const { setTheme } = appSlice.actions
export default appSlice.reducer
