import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, BarChart3 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  fetchFoods, addFood, fetchMeals, fetchMealItems,
  fetchMealPlanEntries, addMealPlanEntry,
  toggleMealPlanEntryLogged, removeMealPlanEntry,
  fetchNutritionGoalItems, saveNutritionGoalItem, deleteNutritionGoalItem,
} from "../store/slices/mealPlannerSlice";
import { fetchSupplements, fetchSupplementStacks, fetchSupplementLogs } from "../store/slices/supplementsSlice";
import { fetchActivityGoals, saveActivityGoals } from "../store/slices/workoutsSlice";
import { fetchBodyMetrics } from "../store/slices/biomarkersSlice";
import { CARD_STYLE, isoDate } from "../lib/uiHelpers";
import { entryNutrition, sumNutrition, scaleNutrients } from "../lib/mealNutrition";
import { calorieConfigFrom } from "../lib/nutritionScore";
import FoodSearchPanel from "../components/mealplanner/FoodSearchPanel";
import NutrientOverview from "../components/mealplanner/NutrientOverview";
import NutrientBreakdown from "../components/mealplanner/NutrientBreakdown";
import GoalsWidget from "../components/mealplanner/GoalsWidget";
import PlanPane from "../components/mealplanner/panes/PlanPane";
import MealsPane from "../components/mealplanner/panes/MealsPane";
import FoodsPane from "../components/mealplanner/panes/FoodsPane";
import SupplementPane from "../components/mealplanner/panes/SupplementPane";
import type { CreateFood, MealPlanEntry, MealSlot, CreateNutritionGoalItem } from "../store/types";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** True on Mac-width viewports; false on phone-width. Drives grid vs. stack. */
function useIsWide(breakpoint = 900): boolean {
  const [wide, setWide] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth >= breakpoint : true),
  );
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [breakpoint]);
  return wide;
}

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
  const goalItems = useAppSelector((s) => s.mealPlanner.goalItems);
  const activityGoals = useAppSelector((s) => s.workouts.activityGoals);
  const bodyMetrics = useAppSelector((s) => s.biomarkers.bodyMetrics);
  const supplements = useAppSelector((s) => s.supplements.items);
  const supplementLogs = useAppSelector((s) => s.supplements.logs);

  const isWide = useIsWide();
  const today = isoDate(new Date());
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [addingSlot, setAddingSlot] = useState<{ date: string; slot: MealSlot } | null>(null);

  const days = useMemo(() => weekDates(weekStart), [weekStart]);

  useEffect(() => {
    dispatch(fetchFoods());
    dispatch(fetchMeals());
    dispatch(fetchNutritionGoalItems());
    dispatch(fetchActivityGoals());
    dispatch(fetchBodyMetrics());
    dispatch(fetchSupplements());
    dispatch(fetchSupplementStacks());
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
    dispatch(fetchSupplementLogs(days[0]));
  }, [dispatch, days]);

  const foodsById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);
  const mealsById = useMemo(() => new Map(meals.map((m) => [m.id, m])), [meals]);
  const supplementsById = useMemo(() => new Map(supplements.map((s) => [s.id, s])), [supplements]);

  const entriesByDaySlot = useMemo(() => {
    const m = new Map<string, MealPlanEntry[]>();
    for (const e of planEntries) {
      const key = `${e.date}__${e.slot}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [planEntries]);

  // Supplements taken on a date contribute their absolute per-dose nutrients.
  const supplementTotalsOn = useMemo(() => {
    return (date: string) =>
      supplementLogs
        .filter((l) => l.date === date)
        .map((l) => {
          const s = supplementsById.get(l.supplement_id);
          return s ? scaleNutrients(s, 1) : null;
        });
  }, [supplementLogs, supplementsById]);

  const todayTotals = useMemo(() => {
    const meal = planEntries
      .filter((e) => e.date === today && e.logged)
      .map((e) => entryNutrition(e, foodsById, mealsById, mealItemsById));
    return sumNutrition([...meal, ...supplementTotalsOn(today)]);
  }, [planEntries, foodsById, mealsById, mealItemsById, today, supplementTotalsOn]);

  const perDayCalories = useMemo(() => {
    const cfg = calorieConfigFrom(activityGoals);
    return days.map((d, i) => {
      const dayEntries = planEntries.filter((e) => e.date === d && e.logged);
      const totals = sumNutrition([
        ...dayEntries.map((e) => entryNutrition(e, foodsById, mealsById, mealItemsById)),
        ...supplementTotalsOn(d),
      ]);
      // Each day's dynamic calorie target = base + that day's active + offset.
      const target = Math.round(cfg.base_bmr + Number(bodyMetrics.find((b) => b.date === d)?.active_calories ?? 0) + cfg.offset);
      return { date: d, label: DAY_LABELS[i], calories: totals.calories, target };
    });
  }, [days, planEntries, foodsById, mealsById, mealItemsById, supplementTotalsOn, activityGoals, bodyMetrics]);

  // This week's total intake (meals + supplements), for the weekly goal readouts.
  const weekTotals = useMemo(() => {
    const meal = planEntries
      .filter((e) => e.logged && e.date >= days[0] && e.date <= days[6])
      .map((e) => entryNutrition(e, foodsById, mealsById, mealItemsById));
    const supp = days.flatMap((d) => supplementTotalsOn(d));
    return sumNutrition([...meal, ...supp]);
  }, [planEntries, foodsById, mealsById, mealItemsById, days, supplementTotalsOn]);

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

  /** Reconcile the edited weekly nutrient goals (delete removed, upsert the
   *  rest) and persist the dynamic calorie strategy. */
  async function handleSaveGoals(
    items: CreateNutritionGoalItem[],
    calorie: { base_bmr: number | null; calorie_offset: number | null; calorie_tolerance: number | null },
  ) {
    const desired = new Set(items.map((i) => i.nutrient_key));
    await Promise.all(
      goalItems
        .filter((g) => !desired.has(g.nutrient_key) && g.nutrient_key !== "calories")
        .map((g) => dispatch(deleteNutritionGoalItem(g.nutrient_key)).unwrap()),
    );
    await Promise.all(items.map((i) => dispatch(saveNutritionGoalItem(i)).unwrap()));
    await dispatch(saveActivityGoals(calorie)).unwrap();
  }

  const calorieStrategy = activityGoals
    ? { base_bmr: activityGoals.base_bmr, calorie_offset: activityGoals.calorie_offset, calorie_tolerance: activityGoals.calorie_tolerance }
    : null;
  const calorieCfg = calorieConfigFrom(activityGoals);
  const todayActive = bodyMetrics.find((b) => b.date === today)?.active_calories ?? 0;
  const dailyCalorieTarget = Math.round(calorieCfg.base_bmr + Number(todayActive) + calorieCfg.offset);
  // Weekly calorie target = Σ each day's dynamic maintenance (base + active + offset).
  const weekCalorieTarget = Math.round(
    days.reduce((sum, d) => sum + calorieCfg.base_bmr + Number(bodyMetrics.find((b) => b.date === d)?.active_calories ?? 0) + calorieCfg.offset, 0),
  );

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Meal Planner</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Plan your week, log what you actually eat, backed by real nutrition data.
          </p>
        </div>
        <GoalsWidget weekTotals={weekTotals} goals={goalItems} calorie={calorieStrategy} weekCalorieTarget={weekCalorieTarget} onSave={handleSaveGoals} />
      </div>

      {/* One dashboard, three full-width rows on Mac (each stacks on iPhone):
          Overview · Plan + Supplement stack · My Meals + Foods. The supplement
          stack is a thin column beside Plan and stretches to Plan's height, so
          the pair is exactly as wide as the rows above and below. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <DashCard title="Overview" icon={<BarChart3 size={15} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <NutrientOverview perDay={perDayCalories} todayTotals={todayTotals} weekTotals={weekTotals} goals={goalItems} dailyCalorieTarget={dailyCalorieTarget} />
            <NutrientBreakdown totals={todayTotals} />
          </div>
        </DashCard>

        {/* Plan + Supplement stack share a row and align to the same height. */}
        <div style={{ display: "flex", flexDirection: isWide ? "row" : "column", gap: 16, alignItems: "stretch" }}>
          <DashCard title="Plan" icon={<CalendarDays size={15} />} style={{ flex: 1 }}>
            <PlanPane
              days={days}
              today={today}
              weekLabel={`${days[0]} — ${days[6]}`}
              isThisWeek={weekStart === mondayOf(today)}
              entriesByDaySlot={entriesByDaySlot}
              foodsById={foodsById}
              mealsById={mealsById}
              mealItemsById={mealItemsById}
              onPrevWeek={() => setWeekStart(addDays(weekStart, -7))}
              onNextWeek={() => setWeekStart(addDays(weekStart, 7))}
              onThisWeek={() => setWeekStart(mondayOf(today))}
              onAddSlot={(date, slot) => setAddingSlot({ date, slot })}
              onToggle={(id, logged) => dispatch(toggleMealPlanEntryLogged({ id, logged }))}
              onRemove={(id) => dispatch(removeMealPlanEntry(id))}
            />
          </DashCard>
          <div style={{ width: isWide ? 300 : "auto", flexShrink: 0, display: "flex" }}>
            <SupplementPane />
          </div>
        </div>

        {/* My Meals + Foods share the last row. */}
        <div style={{ display: "flex", flexDirection: isWide ? "row" : "column", gap: 16, alignItems: "stretch" }}>
          <DashCard style={{ flex: 1 }}>
            <MealsPane meals={meals} mealItemsById={mealItemsById} foodsById={foodsById} />
          </DashCard>
          <DashCard style={{ flex: 1 }}>
            <FoodsPane foods={foods} />
          </DashCard>
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

/**
 * One dashboard tile. `title` is only rendered for panes that don't already
 * carry their own header (My Meals / Foods self-title, so they omit it).
 * `maxBodyHeight` caps the body with internal scroll so tiles stay balanced.
 * `style` merges into the card (used to make a tile flex:1 inside a row).
 */
function DashCard({
  title, icon, maxBodyHeight, style, children,
}: {
  title?: string;
  icon?: ReactNode;
  maxBodyHeight?: number;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        ...CARD_STYLE,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        ...style,
      }}
    >
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text)", fontSize: 15, fontWeight: 700 }}>
          <span style={{ color: "var(--accent)", display: "flex" }}>{icon}</span>
          {title}
        </div>
      )}
      <div style={{ minWidth: 0, maxHeight: maxBodyHeight, overflowY: maxBodyHeight ? "auto" : undefined }}>
        {children}
      </div>
    </section>
  );
}
