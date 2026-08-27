// The PathFinder data layer, for apps that are not PathFinder.
//
// Reached through the `@nexus/core/pathfinder` deep alias rather than the
// package barrel — the barrel pulls in AppGraph3D and therefore three.js, which
// a note-editor block has no business dragging into its chunk. Same reason
// `@nexus/core/coverage` exists.

export * from "./types";
export * from "./filter";
export * from "./tree";
export {
  createPathfinderApi,
  mapTask,
  splitPatch,
  SchedulingGateError,
  TASK_FETCH_LIMIT,
  type CreateTaskInput,
  type PathfinderApi,
  type TaskSnapshot,
} from "./api";
