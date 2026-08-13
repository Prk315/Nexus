import { useEffect, useState } from "react";
import {
  MEAL_SLOTS,
  deleteMealPlanEntry,
  quickLogEntry,
  searchFoods,
  setEntryLogged,
  type MealRef,
  type MealSlot,
} from "./api";
import type { ProtocolData } from "./useProtocolData";

/**
 * Today's meals: what was planned, what's been eaten, and a quick-log picker.
 *
 * Logging = flipping `logged` on a `protocol_meal_plan_entries` row (the same
 * model as Protocol's meal planner, so the two apps agree). Quick-logging
 * something unplanned inserts an entry for today already marked logged —
 * eaten-but-unplanned is still a fact worth recording.
 */
export function MealLogPanel({ data }: { data: ProtocolData }) {
  const { userId, today, mealEntries, meals, patchMealEntries, reload, setErr } = data;

  const [adding, setAdding] = useState<MealSlot | null>(null);
  const [query, setQuery] = useState("");
  const [foodResults, setFoodResults] = useState<MealRef[]>([]);

  // Debounced food search; saved meals are already local and filter instantly.
  useEffect(() => {
    if (!adding || query.trim().length < 2) {
      setFoodResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchFoods(query.trim())
        .then(setFoodResults)
        .catch(() => setFoodResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, adding]);

  const toggleLogged = async (id: string, to: boolean) => {
    patchMealEntries((prev) => prev.map((e) => (e.id === id ? { ...e, logged: to } : e)));
    try {
      await setEntryLogged(id, to);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      void reload();
    }
  };

  const remove = async (id: string) => {
    patchMealEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await deleteMealPlanEntry(id);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      void reload();
    }
  };

  const quickLog = async (slot: MealSlot, ref: { meal_id?: string; food_id?: string }) => {
    setAdding(null);
    setQuery("");
    try {
      await quickLogEntry(userId, today, slot, ref);
      await reload();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  };

  const mealMatches =
    query.trim().length >= 1
      ? meals.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
      : meals.slice(0, 8);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-white/40">Meals today</h3>
      <div className="flex flex-col gap-2">
        {MEAL_SLOTS.map((slot) => {
          const entries = mealEntries.filter((e) => e.slot === slot);
          return (
            <div key={slot} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium capitalize text-white/70">{slot}</span>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(adding === slot ? null : slot);
                    setQuery("");
                  }}
                  className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50 hover:text-white/80"
                >
                  {adding === slot ? "Cancel" : "+ Log"}
                </button>
              </div>

              {entries.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {entries.map((e) => (
                    <div key={e.id} className="group flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={e.logged ? "Mark not eaten" : "Mark eaten"}
                        onClick={() => void toggleLogged(e.id, !e.logged)}
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] transition-colors ${
                          e.logged
                            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                            : "border-white/20 text-transparent hover:border-emerald-400/50 hover:text-emerald-300/60"
                        }`}
                      >
                        ✓
                      </button>
                      <span className={`truncate text-sm ${e.logged ? "text-white/45" : "text-white/80"}`}>
                        {e.name}
                        {e.quantity !== 1 && <span className="text-white/35"> ×{e.quantity}</span>}
                      </span>
                      <button
                        type="button"
                        aria-label="Remove entry"
                        onClick={() => void remove(e.id)}
                        className="ml-auto rounded px-1 text-white/25 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {adding === slot && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search meals & foods…"
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm outline-none placeholder:text-white/30 focus:border-indigo-400/40"
                  />
                  <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                    {mealMatches.map((m) => (
                      <PickRow key={`m-${m.id}`} label={m.name} tag="meal" onPick={() => void quickLog(slot, { meal_id: m.id })} />
                    ))}
                    {foodResults.map((f) => (
                      <PickRow key={`f-${f.id}`} label={f.name} tag="food" onPick={() => void quickLog(slot, { food_id: f.id })} />
                    ))}
                    {mealMatches.length === 0 && foodResults.length === 0 && (
                      <p className="px-1 py-2 text-[11px] text-white/30">
                        {query.trim().length < 2 ? "Type to search foods…" : "No matches."}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PickRow({ label, tag, onPick }: { label: string; tag: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-white/75 hover:bg-white/[0.06]"
    >
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/35">
        {tag}
      </span>
    </button>
  );
}
