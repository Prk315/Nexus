// The Protocol scheduling layer, for apps that are not Protocol — PathFinder
// renders Protocol's workouts, runs, meals, supplement stacks and routines as
// calendar blocks through this.
//
// Reached through the `@nexus/core/protocol` deep alias rather than the barrel,
// for the same reason as `@nexus/core/pathfinder`: the barrel drags in three.js.

export * from "./types";
export * from "./schedule";
export {
  createProtocolApi,
  SyncedEditError,
  type MoveTo,
  type ProtocolApi,
  type ProtocolCatalog,
  type RoutineOption,
  type StackSchedule,
  type SyncedLoad,
  type SyncedLoadError,
} from "./api";
