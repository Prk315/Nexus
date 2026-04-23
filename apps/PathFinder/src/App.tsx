import { useState, useEffect, useRef } from "react";
import "./App.css";
import { Sidebar, type Page } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { Goals } from "./pages/Goals";
import { Plans } from "./pages/Plans";
import { Tasks } from "./pages/Tasks";
import { Systems } from "./pages/Systems";
import { Week } from "./pages/Week";
import { Courses } from "./pages/Courses";
import { Lifestyle } from "./pages/Lifestyle";
import { Projects } from "./pages/Projects";
import { Games } from "./pages/Games";
import { search as searchApi } from "./lib/api";
import { Search, Mail, Calendar, LayoutGrid } from "lucide-react";
import type { SearchResult } from "./types";

const KIND_TO_PAGE: Record<SearchResult["kind"], Page> = {
  goal: "goals",
  plan: "plans",
  task: "tasks",
  system: "systems",
};

function SearchBar({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      searchApi(query).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(result: SearchResult) {
    onNavigate(KIND_TO_PAGE[result.kind]);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  const kindLabel: Record<SearchResult["kind"], string> = {
    goal: "Goal", plan: "Plan", task: "Task", system: "System",
  };

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 h-8 rounded-md border border-input bg-background px-3 text-sm w-56 focus-within:ring-1 focus-within:ring-ring">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          placeholder="Search..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => handleSelect(r)}
              className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-secondary transition-colors"
            >
              <span className="text-xs text-muted-foreground w-10 shrink-0">{kindLabel[r.kind]}</span>
              <span className="text-sm text-foreground truncate flex-1">{r.title}</span>
              {r.subtitle && <span className="text-xs text-muted-foreground truncate">{r.subtitle}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GridMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative self-stretch">
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-full w-14 flex items-center justify-center border-l border-border
                   text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/60
                   transition-colors"
        title="Menu"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-px w-48 rounded-lg border border-border bg-card shadow-lg z-50 p-2">
          {/* placeholder — empty for now */}
        </div>
      )}
    </div>
  );
}

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  week:      "Week",
  goals:     "Goals",
  plans:     "Plans",
  projects:  "Projects",
  tasks:     "Tasks",
  systems:   "Systems",
  lifestyle: "Lifestyle",
  courses:   "Study",
  games:     "Games",
};

const iconBtn = "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/60 transition-colors text-xs font-semibold";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        current={page}
        onChange={setPage}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <header className="flex h-10 shrink-0 items-center border-b border-border">
          {/* Page title */}
          <span className="flex-1 px-6 text-sm font-medium text-foreground">{PAGE_TITLES[page]}</span>

          {/* Placeholder icon buttons */}
          <div className="flex items-center gap-1 px-3">
            <button className={iconBtn} title="Vault">V</button>
            <button className={iconBtn} title="Nexus">N</button>
            <button className={iconBtn} title="Messages">
              <Mail className="h-3.5 w-3.5" />
            </button>
            <button className={iconBtn} title="Calendar">
              <Calendar className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Search */}
          <div className="px-3">
            <SearchBar onNavigate={setPage} />
          </div>

          {/* Grid menu — fills header vertically */}
          <GridMenu />
        </header>

        <main className="flex-1 overflow-y-auto">
          {page === "dashboard" && <Dashboard />}
          {page === "week"      && <Week />}
          {page === "goals"     && <Goals />}
          {page === "plans"     && <Plans />}
          {page === "tasks"     && <Tasks />}
          {page === "systems"   && <Systems />}
          {page === "projects"  && <Projects />}
          {page === "lifestyle" && <Lifestyle />}
          {page === "courses"   && <Courses />}
          {page === "games"     && <Games />}
        </main>
      </div>
    </div>
  );
}

export default App;
