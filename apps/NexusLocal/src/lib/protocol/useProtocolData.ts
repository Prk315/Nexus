import { useCallback, useEffect, useState } from "react";
import {
  fetchHabitCompletions,
  fetchHabits,
  fetchMealPlanEntries,
  fetchMeals,
  fetchSleepNights,
  fetchSupplementLogs,
  fetchSupplementStacks,
  fetchSupplements,
  isoDaysAgo,
  isoToday,
  type Habit,
  type HabitCompletion,
  type MealPlanEntry,
  type MealRef,
  type SleepNight,
  type Supplement,
  type SupplementLog,
  type SupplementStack,
} from "./api";

/**
 * One load for the whole Protocol page. The panels are views onto this state
 * rather than independent fetchers — the stats tiles need habits + meals +
 * supplements + sleep anyway, so per-panel fetching would just repeat every
 * query a second time.
 *
 * Completions/logs are fetched 7 days back: today's toggles need today, the
 * adherence stat needs the week, and a week of presence rows is tiny.
 */
export type ProtocolData = {
  /** Never empty in practice — the page only mounts panels with a session. */
  userId: string;
  today: string;
  habits: Habit[];
  completions: HabitCompletion[];
  supplements: Supplement[];
  stacks: SupplementStack[];
  suppLogs: SupplementLog[];
  mealEntries: MealPlanEntry[];
  meals: MealRef[];
  sleep: SleepNight[];
  loading: boolean;
  err: string | null;
  reload: () => Promise<void>;
  // Optimistic local patches — the panel flips state instantly, the api call
  // runs behind it, and a failure triggers a reload to reconcile.
  patchCompletions: (fn: (prev: HabitCompletion[]) => HabitCompletion[]) => void;
  patchSuppLogs: (fn: (prev: SupplementLog[]) => SupplementLog[]) => void;
  patchMealEntries: (fn: (prev: MealPlanEntry[]) => MealPlanEntry[]) => void;
  setErr: (e: string | null) => void;
};

export function useProtocolData(userId: string | null): ProtocolData {
  const today = isoToday();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [completions, setCompletions] = useState<HabitCompletion[]>([]);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [stacks, setStacks] = useState<SupplementStack[]>([]);
  const [suppLogs, setSuppLogs] = useState<SupplementLog[]>([]);
  const [mealEntries, setMealEntries] = useState<MealPlanEntry[]>([]);
  const [meals, setMeals] = useState<MealRef[]>([]);
  const [sleep, setSleep] = useState<SleepNight[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    const since = isoDaysAgo(6);
    try {
      const [h, c, s, st, sl, me, m, sn] = await Promise.all([
        fetchHabits(userId),
        fetchHabitCompletions(userId, since),
        fetchSupplements(userId),
        fetchSupplementStacks(userId),
        fetchSupplementLogs(userId, since),
        fetchMealPlanEntries(userId, isoToday()),
        fetchMeals(),
        fetchSleepNights(userId, 14),
      ]);
      setHabits(h);
      setCompletions(c);
      setSupplements(s);
      setStacks(st);
      setSuppLogs(sl);
      setMealEntries(me);
      setMeals(m);
      setSleep(sn);
      setErr(null);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    userId: userId ?? "",
    today,
    habits,
    completions,
    supplements,
    stacks,
    suppLogs,
    mealEntries,
    meals,
    sleep,
    loading,
    err,
    reload,
    patchCompletions: setCompletions,
    patchSuppLogs: setSuppLogs,
    patchMealEntries: setMealEntries,
    setErr,
  };
}
