import { useState } from "react";
import { PanelRight } from "lucide-react";
import { Navigator, type Selection } from "../components/workspace/Navigator";
import { TaskBoard } from "../components/workspace/TaskBoard";
import { SystemsRail } from "../components/workspace/SystemsRail";

// Unified workspace replacing Planner + Backlog + Goals + Systems.
// Left: Goals/Plans navigator (filters the board). Center: customizable task
// board. Right: Systems rail. (Schedule dock still to come.)
export function Workspace() {
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  // Bumped whenever the navigator mutates goals/plans, so the board reloads.
  const [dataVersion, setDataVersion] = useState(0);
  const [rightOpen, setRightOpen] = useState(true);

  const selectedGoalId = selection.kind === "goal" ? selection.id : null;
  const selectedPlanId = selection.kind === "plan" ? selection.id : null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 shrink-0 border-r border-border">
        <Navigator
          selection={selection}
          onSelect={setSelection}
          onDataChange={() => setDataVersion((v) => v + 1)}
        />
      </aside>

      <div className="flex-1 min-w-0 relative">
        <TaskBoard
          selectedGoalId={selectedGoalId}
          selectedPlanId={selectedPlanId}
          reloadSignal={dataVersion}
        />
        {!rightOpen && (
          <button
            onClick={() => setRightOpen(true)}
            title="Show Systems"
            className="absolute bottom-3 right-3 z-10 p-1.5 rounded-md border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {rightOpen && (
        <aside className="w-72 shrink-0 border-l border-border">
          <SystemsRail onCollapse={() => setRightOpen(false)} />
        </aside>
      )}
    </div>
  );
}
