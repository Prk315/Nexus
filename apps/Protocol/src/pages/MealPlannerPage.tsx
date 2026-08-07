import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, BarChart3 } from "lucide-react";
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
import PlanPane from "../components/mealplanner/panes/PlanPane";
import MealsPane from "../components/mealplanner/panes/MealsPane";
import FoodsPane from "../components/mealplanner/panes/FoodsPane";
import type { CreateFood, MealPlanEntry, MealSlot, UpdateNutritionGoals } from "../store/types";

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
  const goals = useAppSelector((s) => s.mealPlanner.goals);

  const isWide = useIsWide();
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
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Meal Planner</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Plan your week, log what you actually eat, backed by real nutrition data.
          </p>
        </div>
        <GoalsWidget todayTotals={todayTotals} goals={goals} onSave={handleSaveGoals} />
      </div>

      {/* Everything on one dashboard: 2-col grid on Mac, single stack on iPhone.
          Overview + Plan span the full width; My Meals + Foods share the last row. */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: isWide ? "1fr 1fr" : "1fr",
          alignItems: "start",
        }}
      >
        <DashCard title="Overview" icon={<BarChart3 size={15} />} fullWidth={isWide}>
          <NutrientOverview perDay={perDayCalories} todayTotals={todayTotals} goals={goals} />
        </DashCard>

        <DashCard title="Plan" icon={<CalendarDays size={15} />} fullWidth={isWide}>
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

        <DashCard>
          <MealsPane meals={meals} mealItemsById={mealItemsById} foodsById={foodsById} />
        </DashCard>

        <DashCard>
          <FoodsPane foods={foods} />
        </DashCard>
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
 * One dashboard tile. `fullWidth` makes it span both grid columns (used for the
 * wide Overview + Plan panes). `title` is only rendered for panes that don't
 * already carry their own header (My Meals / Foods self-title, so they omit it).
 * `maxBodyHeight` caps the body with internal scroll so tiles stay balanced.
 */
function DashCard({
  title, icon, fullWidth, maxBodyHeight, children,
}: {
  title?: string;
  icon?: ReactNode;
  fullWidth?: boolean;
  maxBodyHeight?: number;
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
        gridColumn: fullWidth ? "1 / -1" : "auto",
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
