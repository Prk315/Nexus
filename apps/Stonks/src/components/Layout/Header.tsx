import { useAppDispatch, useAppSelector } from "../../store/hooks"
import { setTheme } from "../../store/slices/appSlice"

export default function Header() {
  const dispatch = useAppDispatch()
  const theme = useAppSelector((state) => state.app.theme)

  return (
    <header className="flex items-center justify-between h-10 px-4 border-b border-border bg-card shrink-0">
      <span className="font-semibold text-sm tracking-tight select-none">Stonks</span>

      <button
        onClick={() => dispatch(setTheme(theme === "light" ? "dark" : "light"))}
        title="Toggle theme"
        className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        {theme === "light" ? <MoonIcon /> : <SunIcon />}
      </button>
    </header>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}
