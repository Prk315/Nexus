import { TaskBoard } from "../components/workspace/TaskBoard";

// Unified workspace replacing Planner + Backlog + Goals + Systems.
// Phase 1: the customizable task board (center rail). The Goals/Plans navigator
// (left) and Systems + Schedule dock (right) are added in later phases.
export function Workspace() {
  return (
    <div className="h-full min-h-0">
      <TaskBoard />
    </div>
  );
}
