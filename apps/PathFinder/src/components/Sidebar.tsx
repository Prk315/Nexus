import { LayoutDashboard, ChevronLeft, ChevronRight, CalendarDays, BookOpen, Download, FolderKanban, Gamepad2, CalendarRange, Kanban } from "lucide-react";
import { cn } from "../lib/utils";
import { exportData } from "../lib/api";
import { useQuickPanels } from "./QuickPanels";

export type Page = "dashboard" | "workspace" | "week" | "projects" | "courses" | "schedules" | "games";

const NAV: { id: Page; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "dashboard", label: "Dashboard",  icon: LayoutDashboard },
  { id: "workspace", label: "Workspace",  icon: Kanban },
  { id: "week",      label: "Week",       icon: CalendarDays },
  { id: "projects",  label: "Projects",   icon: FolderKanban },
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

      {/* Tools — the six side-panels, below a divider.
          They sit apart from the nav on purpose: navigation changes *where you
          are*, these open something over wherever you already were. Icon-only
          even when the sidebar is expanded, because six labelled rows would
          out-weigh the seven pages above them. */}
      <QuickPanelRail collapsed={collapsed} />

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

function QuickPanelRail({ collapsed }: { collapsed: boolean }) {
  const { panels, open, toggle } = useQuickPanels();

  return (
    <div className="shrink-0 border-t border-border px-2 py-2">
      {/* A fixed grid, not flex-wrap: six icons in a 208px sidebar wrap to 5+1,
          which reads as a mistake. Two rows of three reads as a set. */}
      {/* Extra row gap: the badge sits above the button box (-top-1), so a
            uniform gap-1 let a badge nearly touch the icon on the row above. */}
        <div className={cn("grid gap-x-1 gap-y-2.5 justify-items-center", collapsed ? "grid-cols-1" : "grid-cols-3")}>
        {panels.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            // Marks this as a trigger so the flyout's click-outside handler
            // ignores it — otherwise closing then re-toggling would fight.
            data-quick-panel-trigger
            onClick={() => toggle(id)}
            title={label}
            aria-label={label}
            aria-pressed={open === id}
            className={cn(
              "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              open === id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {/* Superscript count of unchecked items. Capped at "9+" so a long
                shopping list can't widen the badge past the icon it sits on. */}
            {count != null && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-sidebar">
                {count > 9 ? "9+" : count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
