import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient, getUserId } from "./supabase";
import { libraryMusclesToGroups, type SetLike } from "./muscleMap";
import { isoDate } from "./uiHelpers";

const WINDOW_DAYS = 45; // matches the Garmin exercise-set window
const MAX_SETS_PER_EXERCISE = 12;

function cutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - WINDOW_DAYS);
  return isoDate(d);
}

/**
 * Turns manually-logged strength exercises (protocol_exercises) into the same
 * SetLike shape the muscle-fatigue model consumes — matching each exercise's name
 * to the library to resolve the muscles it trains. One entry per prescribed set,
 * so a logged "3×5" credits three sets of impulse. Only exercises whose name is in
 * the library contribute (that's why the logger picks from it).
 */
export function useLoggedMuscleWork() {
  const [contributions, setContributions] = useState<SetLike[]>([]);

  const load = useCallback(async () => {
    let userId: string;
    try { userId = getUserId(); } catch { return; }
    const sb = getSupabaseClient();

    const { data: sessions } = await sb
      .from("protocol_workout_sessions")
      .select("id, scheduled_date")
      .eq("user_id", userId)
      .gte("scheduled_date", cutoff());
    const sessionRows = (sessions ?? []) as { id: string; scheduled_date: string }[];
    if (sessionRows.length === 0) { setContributions([]); return; }
    const dateById = new Map(sessionRows.map((s) => [s.id, s.scheduled_date]));

    const { data: exs } = await sb
      .from("protocol_exercises")
      .select("session_id, name, sets, reps, weight_kg")
      .in("session_id", sessionRows.map((s) => s.id));
    const exRows = (exs ?? []) as { session_id: string; name: string; sets: number | null; reps: number | null; weight_kg: number | null }[];
    if (exRows.length === 0) { setContributions([]); return; }

    const names = [...new Set(exRows.map((e) => e.name))];
    const { data: lib } = await sb
      .from("protocol_exercise_library")
      .select("name, primary_muscles, secondary_muscles")
      .in("name", names);
    const musclesByName = new Map<string, string[]>();
    for (const l of (lib ?? []) as { name: string; primary_muscles: string[] | null; secondary_muscles: string[] | null }[]) {
      musclesByName.set(l.name, [...(l.primary_muscles ?? []), ...(l.secondary_muscles ?? [])]);
    }

    const out: SetLike[] = [];
    for (const e of exRows) {
      const groups = libraryMusclesToGroups(musclesByName.get(e.name) ?? []);
      const date = dateById.get(e.session_id);
      if (groups.length === 0 || !date) continue;
      const count = Math.max(1, Math.min(e.sets ?? 1, MAX_SETS_PER_EXERCISE));
      for (let i = 0; i < count; i++) {
        out.push({ date, category: "", reps: e.reps, weight_kg: e.weight_kg, muscles: groups });
      }
    }
    setContributions(out);
  }, []);

  useEffect(() => { load(); }, [load]);

  return { loggedContributions: contributions, reloadLogged: load };
}
