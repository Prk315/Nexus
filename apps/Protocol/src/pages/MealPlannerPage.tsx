import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Check, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  fetchFoods, addFood, fetchMeals, fetchMealItems,
  fetchMealPlanEntries, addMealPlanEntry,
  toggleMealPlanEntryLogged, removeMealPlanEntry, fetchNutritionGoals, saveNutritionGoals,
} from "../store/slices/mealPlannerSlice";
import { CARD_STYLE, isoDate } from "../lib/uiHelpers";
import { entryNutrition, sumNutrition } from "../lib/mealNutrition";
import FoodSearchPanel from "../components/mealplanner/FoodSearchPanel";
import NutrientOverview from "../components/mealplanner/NutrientOverview";
import GoalsWidget from "../components/mealplanner/GoalsWidget";
import type { CreateFood, MealPlanEntry, MealSlot, UpdateNutritionGoals } from "../store/types";

const SLOTS: { id: MealSlot; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snacks" },
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayOf(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00");
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

function addDays(dateISO: string, n: number): string {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export default function MealPlannerPage() {
  const dispatch = useAppDispatch();
  const foods = useAppSelector((s) => s.mealPlanner.foods);
  const meals = useAppSelector((s) => s.mealPlanner.meals);
  const mealItemsById = useAppSelector((s) => s.mealPlanner.mealItems);
  const planEntries = useAppSelector((s) => s.mealPlanner.planEntries);
  const goals = useAppSelector((s) => s.mealPlanner.goals);

  const today = isoDate(new Date());
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [addingSlot, setAddingSlot] = useState<{ date: string; slot: MealSlot } | null>(null);

  const days = useMemo(() => weekDates(weekStart), [weekStart]);

  useEffect(() => {
    dispatch(fetchFoods());
    dispatch(fetchMeals());
    dispatch(fetchNutritionGoals());
  }, [dispatch]);

  // Meal items are fetched lazily per meal so nutrition totals (grid, overview,
  // picker) never need to know when a meal's items are "ready" separately.
  useEffect(() => {
    for (const meal of meals) {
      if (!mealItemsById[meal.id]) dispatch(fetchMealItems(meal.id));
    }
  }, [dispatch, meals, mealItemsById]);

  useEffect(() => {
    dispatch(fetchMealPlanEntries({ start: days[0], end: days[6] }));
  }, [dispatch, days]);

  const foodsById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);
  const mealsById = useMemo(() => new Map(meals.map((m) => [m.id, m])), [meals]);

  const entriesByDaySlot = useMemo(() => {
    const m = new Map<string, MealPlanEntry[]>();
    for (const e of planEntries) {
      const key = `${e.date}__${e.slot}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [planEntries]);

  const todayTotals = useMemo(() => {
    const todays = planEntries.filter((e) => e.date === today && e.logged);
    return sumNutrition(todays.map((e) => entryNutrition(e, foodsById, mealsById, mealItemsById)));
  }, [planEntries, foodsById, mealsById, mealItemsById, today]);

  const perDayCalories = useMemo(() => {
    return days.map((d, i) => {
      const dayEntries = planEntries.filter((e) => e.date === d && e.logged);
      const totals = sumNutrition(dayEntries.map((e) => entryNutrition(e, foodsById, mealsById, mealItemsById)));
      return { date: d, label: DAY_LABELS[i], calories: totals.calories };
    });
  }, [days, planEntries, foodsById, mealsById, mealItemsById]);

  async function handlePick(food: CreateFood, grams: number) {
    if (!addingSlot) return;
    let foodId: string;
    const existing = foods.find(
      (f) => f.source === food.source && f.external_id === food.external_id && food.external_id != null,
    );
    if (existing) {
      foodId = existing.id;
    } else {
      const created = await dispatch(addFood(food)).unwrap();
      foodId = created.id;
    }
    await dispatch(addMealPlanEntry({
      date: addingSlot.date, slot: addingSlot.slot, food_id: foodId, quantity: grams,
    })).unwrap();
    setAddingSlot(null);
  }

  async function handlePickMeal(mealId: string) {
    if (!addingSlot) return;
    await dispatch(addMealPlanEntry({
      date: addingSlot.date, slot: addingSlot.slot, meal_id: mealId, quantity: 1,
    })).unwrap();
    setAddingSlot(null);
  }

  async function handleSaveGoals(newGoals: UpdateNutritionGoals) {
    await dispatch(saveNutritionGoals({ current: goals, goals: newGoals })).unwrap();
  }

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Meal Planner</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Plan your week, log what you actually eat, backed by real nutrition data.
          </p>
        </div>
        <GoalsWidget todayTotals={todayTotals} goals={goals} onSave={handleSaveGoals} />
      </div>

      <NutrientOverview perDay={perDayCalories} todayTotals={todayTotals} goals={goals} />

      {/* Week navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 6, cursor: "pointer", color: "var(--text-secondary)" }}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          {days[0]} — {days[6]}
        </span>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 6, cursor: "pointer", color: "var(--text-secondary)" }}>
          <ChevronRight size={16} />
        </button>
        {weekStart !== mondayOf(today) && (
          <button onClick={() => setWeekStart(mondayOf(today))} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            This week
          </button>
        )}
      </div>

      {/* Weekly grid */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `100px repeat(7, minmax(150px, 1fr))`, gap: 8, minWidth: 900 }}>
          <div />
          {days.map((d, i) => (
            <div key={d} style={{ textAlign: "center", padding: "6px 0" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{DAY_LABELS[i]}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: d === today ? "var(--accent)" : "var(--text)" }}>{d.slice(5)}</div>
            </div>
          ))}

          {SLOTS.map(({ id: slot, label }) => (
            <Fragment key={slot}>
              <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                {label}
              </div>
              {days.map((d) => {
                const entries = entriesByDaySlot.get(`${d}__${slot}`) ?? [];
                return (
                  <div key={`${slot}-${d}`} style={{ ...CARD_STYLE, padding: 8, minHeight: 64, display: "flex", flexDirection: "column", gap: 4 }}>
                    {entries.map((e) => {
                      const name = e.food_id
                        ? foodsById.get(e.food_id)?.name ?? "…"
                        : mealsById.get(e.meal_id ?? "")?.name ?? "…";
                      const n = entryNutrition(e, foodsById, mealsById, mealItemsById);
                      return (
                        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                          <button
                            onClick={() => dispatch(toggleMealPlanEntryLogged({ id: e.id, logged: !e.logged }))}
                            title={e.logged ? "Mark as not eaten" : "Mark as eaten"}
                            style={{
                              width: 14, height: 14, borderRadius: "50%", flexShrink: 0, padding: 0,
                              background: e.logged ? "var(--accent)" : "transparent",
                              border: `1.5px solid ${e.logged ? "var(--accent)" : "var(--border)"}`,
                              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                            }}
                          >
                            {e.logged && <Check size={9} strokeWidth={4} color="var(--accent-fg)" />}
                          </button>
                          <span style={{ flex: 1, minWidth: 0, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {name}
                          </span>
                          <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{n?.calories != null ? Math.round(n.calories) : "—"}</span>
                          <button onClick={() => dispatch(removeMealPlanEntry(e.id))} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                            <Trash2 size={10} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => setAddingSlot({ date: d, slot })}
                      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: "2px 0" }}
                    >
                      <Plus size={11} /> Add
                    </button>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {addingSlot && (
        <FoodSearchPanel
          localFoods={foods}
          meals={meals}
          mealItemsById={mealItemsById}
          foodsById={foodsById}
          onPick={handlePick}
          onPickMeal={handlePickMeal}
          onClose={() => setAddingSlot(null)}
        />
      )}
    </div>
  );
}
