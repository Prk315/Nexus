import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  MEAL_SLOT_DEFAULTS,
  MEAL_SLOTS,
  SYNCED_KINDS,
  SYNCED_KIND_LABEL,
  hhmm,
  type MealSlot,
  type ProtocolCatalog,
  type StackRow,
  type SyncedKind,
} from "@nexus/core/protocol";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { PROTOCOL_WEEKDAYS, SYNCED_META } from "./meta";
import { protocolApi, type SyncedState } from "./useSyncedItems";

type MealPick = { key: string; label: string; food_id?: string; meal_id?: string; quantity: number };

const selectCls = "h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-muted-foreground space-y-1">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Monday = 0 toggles. An empty selection means every day, as in Protocol. */
function DayPicker({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex gap-1">
      {PROTOCOL_WEEKDAYS.map((label, d) => {
        const on = value.length === 0 || value.includes(d);
        return (
          <button key={label} type="button"
            onClick={() => {
              const base = value.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : value;
              const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort();
              onChange(next.length === 7 ? [] : next);
            }}
            className={cn("h-7 flex-1 rounded text-[11px] border transition-colors",
              on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Schedule a Protocol item from PathFinder. Writes go to Protocol's own tables
 * (a planned session, meal-plan entries, or a stack's schedule) — so the item
 * appears in Protocol too, because it only ever exists there.
 */
export function ScheduleProtocolDialog({ open, initialDate, initialTime, initialKind = "workout", synced, onClose }: {
  open: boolean;
  initialDate: string;
  initialTime?: string;
  initialKind?: SyncedKind;
  synced: SyncedState;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SyncedKind>(initialKind);
  const [catalog, setCatalog] = useState<ProtocolCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(initialTime ?? "");
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);

  // workout / run
  const [routineId, setRoutineId] = useState("");
  const [customName, setCustomName] = useState("");
  const [km, setKm] = useState("");
  // meal
  const [slot, setSlot] = useState<MealSlot>("lunch");
  const [picks, setPicks] = useState<MealPick[]>([]);
  const [foodQuery, setFoodQuery] = useState("");
  const [foodHits, setFoodHits] = useState<{ id: string; name: string; brand: string | null }[]>([]);
  // stacks
  const [stackId, setStackId] = useState("");
  const [days, setDays] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setDate(initialDate);
    setStart(initialTime ?? "");
    setPicks([]);
    synced.clearActionError();
    protocolApi().loadCatalog().then(setCatalog, (e) => setCatalogError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDate, initialTime, initialKind]);

  useEffect(() => {
    setMinutes(kind === "workout" ? 60 : kind === "run" ? 45 : 15);
    setStackId("");
  }, [kind]);

  // Debounced food search.
  useEffect(() => {
    if (kind !== "meal" || foodQuery.trim().length < 2) { setFoodHits([]); return; }
    const t = setTimeout(() => {
      protocolApi().searchFoods(foodQuery).then(setFoodHits, () => setFoodHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [foodQuery, kind]);

  const stacks: StackRow[] = kind === "routine" ? catalog?.habitStacks ?? [] : kind === "supplements" ? catalog?.supplementStacks ?? [] : [];

  // Picking a stack shows its CURRENT schedule, so editing it is an edit and
  // not a blind overwrite.
  useEffect(() => {
    const s = stacks.find((x) => x.id === stackId);
    if (!s) return;
    setStart(hhmm(s.scheduled_time) ?? initialTime ?? "");
    setMinutes(s.duration_min ?? 15);
    setDays(s.repeat_days ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackId]);

  const routine = catalog?.routines.find((r) => r.id === routineId) ?? null;
  const routinesByPlan = useMemo(() => {
    const m = new Map<string, NonNullable<typeof catalog>["routines"]>();
    for (const r of catalog?.routines ?? []) {
      const k = r.plan_name ?? "No plan";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [catalog]);

  const canSubmit =
    !busy && (
      (kind === "workout" && (routineId || customName.trim()) && date) ||
      (kind === "run" && date) ||
      (kind === "meal" && date && picks.length > 0) ||
      ((kind === "routine" || kind === "supplements") && stackId && start)
    );

  const submit = async () => {
    setBusy(true);
    const ok = await synced.act(async (api) => {
      switch (kind) {
        case "workout":
          return api.scheduleWorkout({
            routine_id: routine?.id ?? null,
            plan_id: routine?.plan_id ?? null,
            name: customName.trim() || routine?.name || "Workout",
            date, start_time: start || null, duration_min: minutes,
          });
        case "run":
          return api.scheduleRun({
            date, start_time: start || null, duration_min: minutes,
            planned_km: km ? Number(km.replace(",", ".")) : null,
          });
        case "meal":
          return api.planMeal({
            date, slot, start_time: start || null,
            entries: picks.map((p) => ({ food_id: p.food_id, meal_id: p.meal_id, quantity: p.quantity })),
          });
        case "routine":
        case "supplements":
          return api.scheduleStack(kind, stackId, { scheduled_time: start, duration_min: minutes, repeat_days: days });
      }
    });
    setBusy(false);
    if (ok) onClose();
  };

  const addPick = (p: Omit<MealPick, "key" | "quantity">) =>
    setPicks((prev) => [...prev, { ...p, key: `${p.food_id ?? p.meal_id}-${prev.length}`, quantity: 1 }]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Schedule from Protocol" description="Lives in Protocol — ticked here, ticked there." className="max-w-lg">
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-secondary/50 p-1">
            {SYNCED_KINDS.map((k) => {
              const Icon = SYNCED_META[k].icon;
              return (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={cn("flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                    kind === k ? cn("bg-card shadow-sm", SYNCED_META[k].text) : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="h-3.5 w-3.5" />{SYNCED_KIND_LABEL[k]}
                </button>
              );
            })}
          </div>

          {catalogError && <p className="text-xs text-destructive">Couldn't load Protocol: {catalogError}</p>}

          {kind === "workout" && (
            <div className="space-y-3">
              <Field label="Routine">
                <select className={selectCls} value={routineId} onChange={(e) => setRoutineId(e.target.value)}>
                  <option value="">— none, just a name —</option>
                  {routinesByPlan.map(([plan, rs]) => (
                    <optgroup key={plan} label={plan}>
                      {rs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label={routine ? "Name (optional)" : "Name"}>
                <Input value={customName} placeholder={routine?.name ?? "e.g. Upper body"} onChange={(e) => setCustomName(e.target.value)} />
              </Field>
            </div>
          )}

          {kind === "run" && (
            <Field label="Planned distance (km)">
              <Input inputMode="decimal" value={km} placeholder="e.g. 5" onChange={(e) => setKm(e.target.value)} />
            </Field>
          )}

          {kind === "meal" && (
            <div className="space-y-3">
              <Field label="Slot">
                <select className={selectCls} value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)}>
                  {MEAL_SLOTS.map((s) => <option key={s} value={s}>{MEAL_SLOT_DEFAULTS[s].label} (default {MEAL_SLOT_DEFAULTS[s].start})</option>)}
                </select>
              </Field>
              <Field label="Saved meal">
                <select className={selectCls} value=""
                  onChange={(e) => {
                    const m = catalog?.meals.find((x) => x.id === e.target.value);
                    if (m) addPick({ label: m.name, meal_id: m.id });
                  }}>
                  <option value="">Add a saved meal…</option>
                  {catalog?.meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="Or a food">
                <Input value={foodQuery} placeholder="Search foods…" onChange={(e) => setFoodQuery(e.target.value)} />
              </Field>
              {foodHits.length > 0 && (
                <ul className="max-h-32 overflow-y-auto rounded-md border border-border text-sm">
                  {foodHits.map((f) => (
                    <li key={f.id}>
                      <button type="button" className="w-full text-left px-2.5 py-1 hover:bg-accent"
                        onClick={() => { addPick({ label: f.brand ? `${f.name} (${f.brand})` : f.name, food_id: f.id }); setFoodQuery(""); }}>
                        {f.name}{f.brand && <span className="text-muted-foreground"> · {f.brand}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {picks.length > 0 && (
                <ul className="space-y-1">
                  {picks.map((p) => (
                    <li key={p.key} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{p.label}</span>
                      <Input type="number" min={0.25} step={0.25} value={p.quantity} className="h-7 w-20"
                        aria-label={`Quantity of ${p.label}`}
                        onChange={(e) => setPicks((prev) => prev.map((x) => x.key === p.key ? { ...x, quantity: Math.max(0.25, Number(e.target.value) || 1) } : x))} />
                      <button type="button" aria-label={`Remove ${p.label}`} onClick={() => setPicks((prev) => prev.filter((x) => x.key !== p.key))}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {(kind === "routine" || kind === "supplements") && (
            <div className="space-y-3">
              <Field label={kind === "routine" ? "Routine (habit stack)" : "Supplement stack"}>
                <select className={selectCls} value={stackId} onChange={(e) => setStackId(e.target.value)}>
                  <option value="">Choose…</option>
                  {stacks.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{hhmm(s.scheduled_time) ? ` — now ${hhmm(s.scheduled_time)}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Days"><DayPicker value={days} onChange={setDays} /></Field>
              <p className="text-xs text-muted-foreground">Repeats on these days. Each tick logs to Protocol for that day.</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {kind !== "routine" && kind !== "supplements" && (
              <Field label="Day"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            )}
            <Field label={kind === "meal" ? "Time (optional)" : kind === "routine" || kind === "supplements" ? "Time" : "Start (optional)"}>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            {kind !== "meal" && (
              <Field label="Minutes">
                <Input type="number" min={5} step={5} value={minutes} onChange={(e) => setMinutes(Math.max(5, Number(e.target.value) || 5))} />
              </Field>
            )}
          </div>

          {synced.actionError && <p className="text-xs text-destructive" role="alert">{synced.actionError}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!canSubmit} onClick={submit}>
              {kind === "routine" || kind === "supplements" ? "Save schedule" : "Schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
