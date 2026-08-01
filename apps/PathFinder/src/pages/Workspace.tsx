import { useState } from "react";
import { Navigator, type Selection } from "../components/workspace/Navigator";
import { TaskBoard } from "../components/workspace/TaskBoard";

// Unified workspace replacing Planner + Backlog + Goals + Systems.
// Phase 2: Goals/Plans navigator (left) filters the customizable task board (center).
// The Systems + Schedule dock (right) is added in Phase 3.
export function Workspace() {
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  // Bumped whenever the navigator mutates goals/plans, so the board reloads.
  const [dataVersion, setDataVersion] = useState(0);

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
      <div className="flex-1 min-w-0">
        <TaskBoard
          selectedGoalId={selectedGoalId}
          selectedPlanId={selectedPlanId}
          reloadSignal={dataVersion}
        />
      </div>
    </div>
  );
}
