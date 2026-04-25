import { useState } from "react";
import type { ReactNode } from "react";
import { LayoutDashboard, CalendarDays, Target, CheckSquare, Map, MoreHorizontal } from "lucide-react";
import type { Page } from "./Sidebar";

const PRIMARY_TABS: { page: Page; label: string; icon: ReactNode }[] = [
  { page: "dashboard", label: "Home",  icon: <LayoutDashboard size={22} /> },
  { page: "week",      label: "Week",  icon: <CalendarDays size={22} /> },
  { page: "goals",     label: "Goals", icon: <Target size={22} /> },
  { page: "tasks",     label: "Tasks", icon: <CheckSquare size={22} /> },
  { page: "plans",     label: "Plans", icon: <Map size={22} /> },
];

const MORE_PAGES: { page: Page; label: string }[] = [
  { page: "systems",   label: "Systems" },
  { page: "projects",  label: "Projects" },
  { page: "lifestyle", label: "Lifestyle" },
  { page: "courses",   label: "Courses" },
  { page: "games",     label: "Games" },
];

interface BottomNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function BottomNav({ currentPage, onNavigate }: BottomNavProps) {
  const [showMore, setShowMore] = useState(false);
  const isMoreActive = MORE_PAGES.some(p => p.page === currentPage);

  return (
    <>
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setShowMore(false)}
          />
          <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 rounded-2xl border border-border bg-popover shadow-xl p-3 grid grid-cols-3 gap-2">
            {MORE_PAGES.map(({ page, label }) => (
              <button
                key={page}
                onClick={() => { onNavigate(page); setShowMore(false); }}
                className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl text-xs font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <nav className="pf-bottom-nav">
        {PRIMARY_TABS.map(({ page, label, icon }) => (
          <button
            key={page}
            className={`pf-bottom-nav-tab${currentPage === page ? " active" : ""}`}
            onClick={() => { onNavigate(page); setShowMore(false); }}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
        <button
          className={`pf-bottom-nav-tab${isMoreActive || showMore ? " active" : ""}`}
          onClick={() => setShowMore(s => !s)}
        >
          <MoreHorizontal size={22} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
