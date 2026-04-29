import { useState } from "react";
import { Target, ListChecks, CheckSquare } from "lucide-react";
import { GoalsPanel } from "./Goals";
import { PlansPanel } from "./Plans";
import { TasksPanel } from "./Tasks";
import { cn } from "../lib/utils";

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

type HubTab = "goals" | "plans" | "tasks";

const TABS: { id: HubTab; label: string; icon: React.ReactNode }[] = [
  { id: "goals", label: "Goals", icon: <Target className="w-4 h-4 text-violet-500" /> },
  { id: "plans", label: "Plans", icon: <ListChecks className="w-4 h-4 text-blue-500" /> },
  { id: "tasks", label: "Tasks", icon: <CheckSquare className="w-4 h-4 text-emerald-500" /> },
];

// ── Column header (desktop only) ───────────────────────────────────────────────

function ColHeader({ icon, title, border = true }: {
  icon: React.ReactNode;
  title: string;
  border?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 bg-background/80 backdrop-blur-sm sticky top-0 z-10",
      border && "border-r border-border"
    )}>
      {icon}
      <span className="text-sm font-semibold">{title}</span>
    </div>
  );
}

// ── GoalHub ────────────────────────────────────────────────────────────────────

/**
 * Unified Goals → Plans → Tasks page.
 * Desktop: 3 columns side-by-side.
 * iOS: tab switcher (one panel at a time).
 */
export function GoalHub() {
  const [activeTab, setActiveTab] = useState<HubTab>("goals");

  if (IS_IOS) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-border bg-background">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2",
                activeTab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground"
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Active panel */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "goals" && <GoalsPanel />}
          {activeTab === "plans" && <PlansPanel />}
          {activeTab === "tasks" && <TasksPanel />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row h-full min-h-0 overflow-hidden bg-background divide-x divide-border">

      {/* Goals column */}
      <div className="flex flex-col w-[32%] min-w-[280px] min-h-0 shrink-0">
        <ColHeader
          icon={<Target className="w-4 h-4 text-violet-500" />}
          title="Goals"
        />
        <div className="flex-1 overflow-y-auto">
          <GoalsPanel />
        </div>
      </div>

      {/* Plans column */}
      <div className="flex flex-col flex-1 min-w-[300px] min-h-0">
        <ColHeader
          icon={<ListChecks className="w-4 h-4 text-blue-500" />}
          title="Plans"
        />
        <div className="flex-1 overflow-y-auto">
          <PlansPanel />
        </div>
      </div>

      {/* Tasks column */}
      <div className="flex flex-col w-[34%] min-w-[300px] min-h-0 shrink-0">
        <ColHeader
          icon={<CheckSquare className="w-4 h-4 text-emerald-500" />}
          title="Tasks"
          border={false}
        />
        <div className="flex-1 overflow-y-auto">
          <TasksPanel />
        </div>
      </div>

    </div>
  );
}
