import type { ReactNode } from "react";
import { LayoutDashboard, CalendarDays, Target, CheckSquare, Map, Cog } from "lucide-react";
import type { Page } from "./Sidebar";

interface BottomNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const TABS: { page: Page; label: string; icon: ReactNode }[] = [
  { page: "dashboard", label: "Home",    icon: <LayoutDashboard size={20} /> },
  { page: "week",      label: "Week",    icon: <CalendarDays size={20} /> },
  { page: "goals",     label: "Goals",   icon: <Target size={20} /> },
  { page: "tasks",     label: "Tasks",   icon: <CheckSquare size={20} /> },
  { page: "plans",     label: "Plans",   icon: <Map size={20} /> },
  { page: "systems",   label: "Systems", icon: <Cog size={20} /> },
];

export function BottomNav({ currentPage, onNavigate }: BottomNavProps) {
  return (
    <nav className="pf-bottom-nav">
      {TABS.map(({ page, label, icon }) => (
        <button
          key={page}
          className={`pf-bottom-nav-tab${currentPage === page ? " active" : ""}`}
          onClick={() => onNavigate(page)}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
