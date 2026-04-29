import { LayoutDashboard, Target, ListChecks, RefreshCw, CheckSquare, ChevronLeft, ChevronRight, CalendarDays, BookOpen, Download, Heart, FolderKanban, Gamepad2, CalendarRange, Archive, CalendarClock, NotebookPen } from "lucide-react";
import { cn } from "../lib/utils";
import { exportData } from "../lib/api";

export type Page = "dashboard" | "week" | "goals" | "plans" | "projects" | "tasks" | "systems" | "lifestyle" | "courses" | "schedules" | "games" | "backlog" | "planner" | "journal";

const NAV: { id: Page; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "dashboard", label: "Dashboard",  icon: LayoutDashboard },
  { id: "week",      label: "Week",       icon: CalendarDays },
  { id: "goals",     label: "Goals",      icon: Target },
  { id: "plans",     label: "Plans",      icon: ListChecks },
  { id: "projects",  label: "Projects",   icon: FolderKanban },
  { id: "tasks",     label: "Tasks",      icon: CheckSquare },
  { id: "backlog",   label: "Backlog",    icon: Archive },
  { id: "planner",   label: "Planner",    icon: CalendarClock },
  { id: "journal",   label: "Journal",    icon: NotebookPen },
  { id: "systems",   label: "Systems",    icon: RefreshCw },
  { id: "lifestyle", label: "Lifestyle",  icon: Heart },
  { id: "courses",   label: "Study",      icon: BookOpen },
  { id: "schedules", label: "Schedules",  icon: CalendarRange },
  { id: "games",     label: "Games",      icon: Gamepad2 },
];

interface SidebarProps {
  current: Page;
  onChange: (page: Page) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ current, onChange, collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-border bg-sidebar transition-all duration-200 overflow-hidden",
        collapsed ? "w-12" : "w-52"
      )}
    >
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2 gap-2">
        {!collapsed && (
          <span className="flex-1 truncate text-sm font-semibold tracking-tight text-sidebar-foreground px-1">
            PathFinder
          </span>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60",
            "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors",
            collapsed && "mx-auto"
          )}
        >
          {collapsed
            ? <ChevronRight className="h-4 w-4" />
            : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center rounded-md py-1.5 text-sm font-medium transition-colors w-full",
              collapsed ? "justify-center px-0" : "gap-2.5 text-left px-3",
              current === id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>

      {/* Export */}
      <div className="shrink-0 border-t border-border p-2">
        <button
          title="Export all data as JSON backup"
          onClick={async () => {
            try {
              const json = await exportData();
              const blob = new Blob([json], { type: "application/json" });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement("a");
              const date = new Date().toISOString().slice(0, 10);
              a.href     = url;
              a.download = `pathfinder-backup-${date}.json`;
              a.click();
              URL.revokeObjectURL(url);
            } catch (e) {
              console.error("Export failed", e);
            }
          }}
          className={cn(
            "flex items-center rounded-md py-1.5 text-sm font-medium transition-colors w-full",
            collapsed ? "justify-center px-0" : "gap-2.5 text-left px-3",
            "text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )}
        >
          <Download className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Export backup</span>}
        </button>
      </div>
    </aside>
  );
}
