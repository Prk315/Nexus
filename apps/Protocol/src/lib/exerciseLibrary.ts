/**
 * Shared exercise library lookup — ~870 exercises with the muscles they train
 * (public-domain free-exercise-db, loaded into protocol_exercise_library). Used
 * by the routine designer's exercise picker. Read-only, anon-readable.
 */
import { getSupabaseClient } from "./supabase";
import type { ExerciseLibraryItem } from "../store/types";

export async function searchExerciseLibrary(query: string): Promise<ExerciseLibraryItem[]> {
  const term = query.trim();
  if (!term) return [];
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("protocol_exercise_library")
    .select("*")
    .ilike("name", `%${term}%`)
    .order("name", { ascending: true })
    .limit(20);
  if (error || !data) return [];
  return data as ExerciseLibraryItem[];
}
