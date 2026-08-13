import { setSupplementTaken } from "./api";
import type { ProtocolData } from "./useProtocolData";

/**
 * The supplement stack, grouped the way Protocol groups it (by
 * `protocol_supplement_stacks`, ungrouped last), each row a one-tap
 * taken-today toggle against `protocol_supplement_logs` — presence rows,
 * exactly like habit completions.
 */
export function SupplementsPanel({ data }: { data: ProtocolData }) {
  const { userId, today, supplements, stacks, suppLogs, patchSuppLogs, reload, setErr } = data;

  const toggle = async (suppId: string, taken: boolean) => {
    patchSuppLogs((prev) => {
      const without = prev.filter((l) => !(l.supplement_id === suppId && l.date === today));
      return taken ? [...without, { supplement_id: suppId, date: today }] : without;
    });
    try {
      await setSupplementTaken(userId, suppId, today, taken);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      void reload();
    }
  };

  if (supplements.length === 0) return null;

  const groups: Array<{ id: string | null; name: string }> = [
    ...stacks.map((s) => ({ id: s.id as string | null, name: s.name })),
    { id: null, name: "Other" },
  ];

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-white/40">Supplements</h3>
      <div className="flex flex-col gap-2">
        {groups.map((g) => {
          const items = supplements.filter((s) => s.stack_id === g.id);
          if (items.length === 0) return null;
          const takenCount = items.filter((s) =>
            suppLogs.some((l) => l.supplement_id === s.id && l.date === today),
          ).length;
          return (
            <div key={g.id ?? "other"} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/70">{g.name}</span>
                <span className="text-[10px] tabular-nums text-white/35">
                  {takenCount}/{items.length}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {items.map((s) => {
                  const taken = suppLogs.some((l) => l.supplement_id === s.id && l.date === today);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => void toggle(s.id, !taken)}
                      className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-white/[0.04]"
                    >
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] transition-colors ${
                          taken
                            ? "border-amber-400/40 bg-amber-500/15 text-amber-300"
                            : "border-white/20 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className={`truncate text-sm ${taken ? "text-white/45" : "text-white/80"}`}>
                        {s.name}
                      </span>
                      {s.dose && <span className="ml-auto shrink-0 text-[10px] text-white/30">{s.dose}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
