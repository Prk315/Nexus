// Teams: shared ownership of tasks and plans between a handful of people.
//
// RLS on pf_teams/pf_team_members already scopes rows to "teams I'm a member
// of", so every read here is a plain select — no user_id filter needed, same
// as getSubtree/getTaskScheduling in tasks.ts.

import { err, supabase, getUserId } from "./_shared";

export interface Team {
  id: string;
  name: string;
  createdBy: string;
}

export interface TeamMember {
  userId: string;
  displayName: string;
}

function mapTeam(r: any): Team {
  return { id: r.id, name: r.name, createdBy: r.created_by };
}

/**
 * There is no profiles table and `auth.users` is unreadable client-side, so the
 * two seeded members' display names are hardcoded rather than fetched.
 * `memberName` falls back to a uid prefix for anyone not in this map.
 */
const KNOWN_MEMBERS: Record<string, string> = {
  "a33625c2-4dd2-44fa-b2e5-4d455eeac59d": "Bastian",
  "870ca14b-2a8a-4634-9c08-2eb2d67207b0": "Josefine",
};

export function memberName(userId: string): string {
  return KNOWN_MEMBERS[userId] ?? userId.slice(0, 8);
}

export const getMyTeams = async (): Promise<Team[]> => {
  const { data, error } = await supabase.from("pf_teams").select("*");
  if (error) err(error);
  return (data ?? []).map(mapTeam);
};

// Single-flight cache of the caller's team ids. Every broadened read (tasks,
// plans, week, daily) needs this on nearly every call, and re-querying
// pf_teams each time would double the round-trips for something that changes
// only when a team is created or joined. Reset by createTeam.
let teamIdsPromise: Promise<string[]> | null = null;

export const getMyTeamIds = (): Promise<string[]> => {
  if (!teamIdsPromise) {
    teamIdsPromise = getMyTeams().then((teams) => teams.map((t) => t.id));
  }
  return teamIdsPromise;
};

export const createTeam = async (name: string): Promise<Team> => {
  const { data, error } = await supabase
    .from("pf_teams")
    .insert({ name, created_by: getUserId() })
    .select()
    .single();
  if (error) err(error);

  const { error: memberError } = await supabase
    .from("pf_team_members")
    .insert({ team_id: data!.id, user_id: getUserId() });
  if (memberError) err(memberError);

  // Force the next getMyTeamIds() call to refetch — the cached list (if any)
  // is now stale and would hide the team that was just created.
  teamIdsPromise = null;
  return mapTeam(data!);
};

export const getTeamMembers = async (teamId: string): Promise<TeamMember[]> => {
  const { data, error } = await supabase
    .from("pf_team_members")
    .select("user_id")
    .eq("team_id", teamId);
  if (error) err(error);
  return (data ?? []).map((r) => ({ userId: r.user_id, displayName: memberName(r.user_id) }));
};

/**
 * The `.or()` fragment that broadens a "mine only" read to "mine + my teams'".
 *
 * Returns null when the caller belongs to no team, so call sites fall back to
 * the plain `.eq("user_id", …)` filter they had before this feature existed —
 * a member of zero teams sees exactly what they saw before.
 */
export const getTeamOrFilter = async (): Promise<string | null> => {
  const teamIds = await getMyTeamIds();
  if (teamIds.length === 0) return null;
  return `user_id.eq.${getUserId()},team_id.in.(${teamIds.join(",")})`;
};
