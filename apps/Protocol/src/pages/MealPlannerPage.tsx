import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Check, Trash2, Target } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  fetchFoods, addFood, fetchMealPlanEntries, addMealPlanEntry,
  toggleMealPlanEntryLogged, removeMealPlanEntry, fetchNutritionGoals, saveNutritionGoals,
} from "../store/slices/mealPlannerSlice";
import { CARD_STYLE, INPUT_SM, LABEL_STYLE, FIELD_GROUP, isoDate } from "../lib/uiHelpers";
import FoodSearchPanel from "../components/mealplanner/FoodSearchPanel";
import type { CreateFood, Food, MealPlanEntry, MealSlot, UpdateNutritionGoals } from "../store/types";

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

/** Nutrition for a plan entry, scaled from the food's per-100g values. */
function entryNutrition(entry: MealPlanEntry, food: Food | undefined) {
  if (!food) return null;
  const factor = entry.quantity / 100;
  const scale = (v: number | null) => (v != null ? v * factor : null);
  return {
    calories: scale(food.calories), protein_g: scale(food.protein_g), carbs_g: scale(food.carbs_g),
    fat_g: scale(food.fat_g), fiber_g: scale(food.fiber_g), sugar_g: scale(food.sugar_g),
    sodium_mg: scale(food.sodium_mg), potassium_mg: scale(food.potassium_mg), calcium_mg: scale(food.calcium_mg),
    iron_mg: scale(food.iron_mg), vitamin_c_mg: scale(food.vitamin_c_mg), vitamin_d_mcg: scale(food.vitamin_d_mcg),
  };
}

function sumNutrition(list: ReturnType<typeof entryNutrition>[]) {
  const keys = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "vitamin_c_mg", "vitamin_d_mcg"] as const;
  const totals: Record<(typeof keys)[number], number> = Object.fromEntries(keys.map((k) => [k, 0])) as never;
  for (const n of list) {
    if (!n) continue;
    for (const k of keys) totals[k] += n[k] ?? 0;
  }
  return totals;
}

function GoalBar({ label, value, goal, unit }: { label: string; value: number; goal: number | null; unit: string }) {
  const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>
          {Math.round(value)}{unit} {goal ? `/ ${Math.round(goal)}${unit}` : ""}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--progress-bg)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct ?? 0}%`, background: "var(--accent)", borderRadius: 3 }} />
      </div>
    </div>
  );
}

export default function MealPlannerPage() {
  const dispatch = useAppDispatch();
  const foods = useAppSelector((s) => s.mealPlanner.foods);
  const planEntries = useAppSelector((s) => s.mealPlanner.planEntries);
  const goals = useAppSelector((s) => s.mealPlanner.goals);

  const today = isoDate(new Date());
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [addingSlot, setAddingSlot] = useState<{ date: string; slot: MealSlot } | null>(null);
  const [editingGoals, setEditingGoals] = useState(false);
  const [goalsForm, setGoalsForm] = useState<UpdateNutritionGoals>({});

  const days = useMemo(() => weekDates(weekStart), [weekStart]);

  useEffect(() => {
    dispatch(fetchFoods());
    dispatch(fetchNutritionGoals());
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchMealPlanEntries({ start: days[0], end: days[6] }));
  }, [dispatch, days]);

  const foodsById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);

  const entriesByDaySlot = useMemo(() => {
    const m = new Map<string, MealPlanEntry[]>();
    for (const e of planEntries) {
      const key = `${e.date}__${e.slot}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [planEntries]);

  const todayLoggedTotals = useMemo(() => {
    const todays = planEntries.filter((e) => e.date === today && e.logged);
    return sumNutrition(todays.map((e) => entryNutrition(e, foodsById.get(e.food_id ?? ""))));
  }, [planEntries, foodsById, today]);

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

  function openGoalsEdit() {
    setGoalsForm(goals ? { ...goals } : {});
    setEditingGoals(true);
  }

  async function submitGoals(e: React.FormEvent) {
    e.preventDefault();
    await dispatch(saveNutritionGoals({ current: goals, goals: goalsForm })).unwrap();
    setEditingGoals(false);
  }

  const setGoal = <K extends keyof UpdateNutritionGoals>(key: K, value: string) =>
    setGoalsForm((g) => ({ ...g, [key]: value ? Number(value) : null }));

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Meal Planner</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Plan your week, log what you actually eat, backed by real nutrition data.
        </p>
      </div>

      {/* Goals card */}
      <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Target size={16} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>Today's Progress</span>
          </div>
          <button
            onClick={openGoalsEdit}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 12px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}
          >
            {goals ? "Edit goals" : "Set goals"}
          </button>
        </div>

        {editingGoals ? (
          <form onSubmit={submitGoals} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              {([
                ["calories", "Calories"], ["protein_g", "Protein (g)"], ["carbs_g", "Carbs (g)"], ["fat_g", "Fat (g)"],
              ] as const).map(([key, label]) => (
                <div key={key} style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>{label}</label>
                  <input type="number" value={goalsForm[key] ?? ""} onChange={(e) => setGoal(key, e.target.value)} style={INPUT_SM} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              {([
                ["fiber_g", "Fiber (g)"], ["sugar_g", "Sugar (g)"], ["sodium_mg", "Sodium (mg)"], ["potassium_mg", "Potassium (mg)"],
              ] as const).map(([key, label]) => (
                <div key={key} style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>{label}</label>
                  <input type="number" value={goalsForm[key] ?? ""} onChange={(e) => setGoal(key, e.target.value)} style={INPUT_SM} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              {([
                ["calcium_mg", "Calcium (mg)"], ["iron_mg", "Iron (mg)"], ["vitamin_c_mg", "Vitamin C (mg)"], ["vitamin_d_mcg", "Vitamin D (mcg)"],
              ] as const).map(([key, label]) => (
                <div key={key} style={FIELD_GROUP}>
                  <label style={LABEL_STYLE}>{label}</label>
                  <input type="number" value={goalsForm[key] ?? ""} onChange={(e) => setGoal(key, e.target.value)} style={INPUT_SM} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                <Check size={13} /> Save
              </button>
              <button type="button" onClick={() => setEditingGoals(false)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 14px", fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        ) : goals ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
              <GoalBar label="Calories" value={todayLoggedTotals.calories} goal={goals.calories} unit="" />
              <GoalBar label="Protein" value={todayLoggedTotals.protein_g} goal={goals.protein_g} unit="g" />
              <GoalBar label="Carbs" value={todayLoggedTotals.carbs_g} goal={goals.carbs_g} unit="g" />
              <GoalBar label="Fat" value={todayLoggedTotals.fat_g} goal={goals.fat_g} unit="g" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
              <GoalBar label="Sodium" value={todayLoggedTotals.sodium_mg} goal={goals.sodium_mg} unit="mg" />
              <GoalBar label="Calcium" value={todayLoggedTotals.calcium_mg} goal={goals.calcium_mg} unit="mg" />
              <GoalBar label="Iron" value={todayLoggedTotals.iron_mg} goal={goals.iron_mg} unit="mg" />
              <GoalBar label="Vitamin C" value={todayLoggedTotals.vitamin_c_mg} goal={goals.vitamin_c_mg} unit="mg" />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Based on entries marked as eaten today.</div>
          </div>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No goals set yet — click "Set goals" to define daily targets.</p>
        )}
      </div>

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
                      const food = foodsById.get(e.food_id ?? "");
                      const n = entryNutrition(e, food);
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
                            {food?.name ?? "…"}
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
          onPick={handlePick}
          onClose={() => setAddingSlot(null)}
        />
      )}
    </div>
  );
}
