import { useState } from "react";
import { ListTree, RefreshCw } from "lucide-react";
import { Navigator, type Selection } from "../components/workspace/Navigator";
import { TaskBoard } from "../components/workspace/TaskBoard";
import { SystemsRail } from "../components/workspace/SystemsRail";
import { SidePane } from "../components/common/SidePane";

// Unified workspace replacing Planner + Backlog + Goals + Systems.
// Left: Goals/Plans navigator (filters the board). Center: customizable task
// board. Right: Systems rail. (Schedule dock still to come.)
//
// Both side panes are drag-resizable and collapse to a labelled strip on their
// own edge; width and open state persist per pane (components/common/SidePane).
export function Workspace() {
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  // Bumped whenever the navigator mutates goals/plans, so the board reloads.
  const [dataVersion, setDataVersion] = useState(0);

  const selectedGoalId = selection.kind === "goal" ? selection.id : null;
  const selectedPlanId = selection.kind === "plan" ? selection.id : null;

  return (
    <div className="flex h-full min-h-0">
      <SidePane id="workspace-nav" side="left" label="Navigator" icon={ListTree} initial={240} min={190} max={440}>
        {(collapse) => (
          <Navigator
            selection={selection}
            onSelect={setSelection}
            onDataChange={() => setDataVersion((v) => v + 1)}
            onCollapse={collapse}
          />
        )}
      </SidePane>

      <div className="flex-1 min-w-0">
        <TaskBoard
          selectedGoalId={selectedGoalId}
          selectedPlanId={selectedPlanId}
          reloadSignal={dataVersion}
        />
      </div>

      <SidePane id="workspace-systems" side="right" label="Systems" icon={RefreshCw} initial={288} min={220} max={480}>
        {(collapse) => <SystemsRail onCollapse={collapse} />}
      </SidePane>
    </div>
  );
}
