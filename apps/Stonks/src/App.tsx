import { useEffect } from "react"
import { useAppSelector } from "./store/hooks"
import Header from "./components/Layout/Header"
import SidePanel from "./components/Layout/SidePanel"
import Footer from "./components/Layout/Footer"
import Spreadsheet from "./components/Spreadsheet"

function App() {
  const theme = useAppSelector((state) => state.app.theme)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      <Header />

      <div className="flex flex-1 overflow-hidden relative">
        <SidePanel side="left" />
        <main className="flex-1 overflow-hidden">
          <Spreadsheet />
        </main>
        <SidePanel side="right" />
      </div>

      <Footer />
    </div>
  )
}

export default App
