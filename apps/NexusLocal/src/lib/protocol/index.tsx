import { useNexusAuth } from "@nexus/core";
import { useProtocolData } from "./useProtocolData";
import { StatsPanel } from "./StatsPanel";
import { SleepStatsPanel } from "./SleepStatsPanel";
import { MealLogPanel } from "./MealLogPanel";
import { HabitsPanel } from "./HabitsPanel";
import { SupplementsPanel } from "./SupplementsPanel";

/**
 * Barrel for the Protocol (health) feature. `ProtocolPage` is a full page
 * mounted from `App.tsx` when its `page` state is `"protocol"` — same shape
 * as `lib/learn`'s `LearnPage` and `lib/pathfinder`'s `TasksPage`. Panels
 * register here, never in `App.tsx`.
 *
 * Order is dashboard-first: the stats tiles and sleep chart are the "what's
 * the state of things" read; the meal / habit / supplement panels below are
 * the logging surfaces you act on.
 */
export function ProtocolPage() {
  const { session, loading } = useNexusAuth();
  const data = useProtocolData(session?.user.id ?? null);

  if (loading) return null;

  if (!session) {
    return (
      <section className="flex flex-col gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-sm text-amber-200/90">
        <span className="font-medium">Sign in to see your protocol</span>
        <span className="text-xs text-amber-200/60">
          Health data is scoped to your account — use the avatar in the header.
        </span>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      {data.err && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{data.err}</div>}
      <StatsPanel data={data} />
      <SleepStatsPanel sleep={data.sleep} />
      <MealLogPanel data={data} />
      <HabitsPanel data={data} />
      <SupplementsPanel data={data} />
      {data.loading && <p className="text-center text-[11px] text-white/30">Loading…</p>}
    </div>
  );
}
