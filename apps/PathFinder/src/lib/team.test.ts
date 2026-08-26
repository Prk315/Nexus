import { describe, it, expect } from "vitest";
import { isTaskRelevantToMe } from "./team";

const ME = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";
const TEAMMATE = "870ca14b-2a8a-4634-9c08-2eb2d67207b0";
const TEAM_ID = "c74f40f3-b78c-44d6-bb95-111e5e1f6f6d";

describe("isTaskRelevantToMe", () => {
  it("is always relevant when the task has no team", () => {
    expect(isTaskRelevantToMe({ team_id: null, assigned_to: null }, ME)).toBe(true);
    expect(isTaskRelevantToMe({ team_id: null, assigned_to: TEAMMATE }, ME)).toBe(true);
  });

  it("is relevant when a team task is unassigned", () => {
    expect(isTaskRelevantToMe({ team_id: TEAM_ID, assigned_to: null }, ME)).toBe(true);
  });

  it("is relevant when a team task is assigned to 'all'", () => {
    expect(isTaskRelevantToMe({ team_id: TEAM_ID, assigned_to: "all" }, ME)).toBe(true);
  });

  it("is relevant when a team task is assigned to me", () => {
    expect(isTaskRelevantToMe({ team_id: TEAM_ID, assigned_to: ME }, ME)).toBe(true);
  });

  it("is NOT relevant when a team task is assigned to someone else", () => {
    expect(isTaskRelevantToMe({ team_id: TEAM_ID, assigned_to: TEAMMATE }, ME)).toBe(false);
  });
});
