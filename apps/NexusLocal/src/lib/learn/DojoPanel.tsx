/**
 * Dojo — visualisering af det selvstændige code-practice-repo
 * (github.com/Prk315/code-practice: projektbaseret deliberate practice i
 * VS Code). Envejsbro: dojoens `tools/report.mjs` skriver `dojo_projects` +
 * `dojo_runs` efter hver check-kørsel; denne komponent LÆSER kun. Ingen
 * kobling til lr_*-stierne — bevidst (dojoen er sin egen verden).
 *
 * Ærlighedsregler som resten af Learn: ingen rækker ≠ "ingen træning" på en
 * flot måde — tom tilstand siger hvordan man starter; en fejlet hentning
 * siger det; "i dag" afgøres i Europe/Copenhagen, aldrig via UTC-midnat.
 */

import { useEffect, useState } from "react";
import { supabasePublic } from "../supabase";

const DOJO_USER = "default";
const REPO_URL = "https://github.com/Prk315/code-practice";

interface DojoProject {
  project: string;
  title: string | null;
  track: string | null;
  level: string | null;
  status: "started" | "green" | "reviewed";
  updated_at: string;
}
interface DojoRun { project: string; passed: boolean; at: string }

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));

/** De seneste 7 Copenhagen-dage, ældst først. */
function last7Days(): string[] {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    out.push(dayKey(new Date(Date.now() - i * 86_400_000).toISOString()));
  }
  return out;
}

export function useDojoToday(): { runs: number; green: number } | null {
  const [today, setToday] = useState<{ runs: number; green: number } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
        const { data, error } = await supabasePublic
          .from("dojo_runs").select("passed, at")
          .eq("user_id", DOJO_USER).gte("at", since);
        if (error) throw error;
        const t = dayKey(new Date().toISOString());
        const rows = (data ?? []).filter((r) => dayKey(r.at as string) === t);
        if (alive) setToday({ runs: rows.length, green: rows.filter((r) => r.passed).length });
      } catch { /* rækken i Today udelades hellere end at lyve */ }
    })();
    return () => { alive = false; };
  }, []);
  return today;
}

const STATUS_CHIP: Record<DojoProject["status"], { label: string; cls: string }> = {
  started:  { label: "i gang",     cls: "bg-amber-100 text-amber-800" },
  green:    { label: "grøn",       cls: "bg-emerald-100 text-emerald-800" },
  reviewed: { label: "reviewed ✓", cls: "bg-indigo-100 text-indigo-800" },
};

export function DojoPanel() {
  const [projects, setProjects] = useState<DojoProject[] | null | undefined>(undefined);
  const [runs, setRuns] = useState<DojoRun[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
        const [p, r] = await Promise.all([
          supabasePublic.from("dojo_projects")
            .select("project, title, track, level, status, updated_at")
            .eq("user_id", DOJO_USER).order("updated_at", { ascending: false }).limit(4),
          supabasePublic.from("dojo_runs")
            .select("project, passed, at")
            .eq("user_id", DOJO_USER).gte("at", since),
        ]);
        if (p.error || r.error) throw p.error ?? r.error;
        if (alive) {
          setProjects((p.data ?? []) as DojoProject[]);
          setRuns((r.data ?? []) as DojoRun[]);
        }
      } catch (e) {
        console.error("[learn] DojoPanel fetch failed", e);
        if (alive) setProjects(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  const days = last7Days();
  const byDay = new Map<string, { any: boolean; green: boolean }>();
  for (const r of runs) {
    const k = dayKey(r.at);
    const cur = byDay.get(k) ?? { any: false, green: false };
    byDay.set(k, { any: true, green: cur.green || r.passed });
  }
  const runs7 = runs.filter((r) => days.includes(dayKey(r.at)));
  const green7 = runs7.filter((r) => r.passed).length;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A9AA8]">
        Dojo
      </h2>

      {projects === undefined && (
        <div className="rounded-2xl bg-white p-5 text-sm text-[#6E6E78] shadow-sm">Indlæser…</div>
      )}
      {projects === null && (
        <div className="rounded-2xl border border-dashed border-black/[0.12] bg-black/[0.02] p-5 text-sm text-[#6E6E78]">
          Dojoen kunne ikke hentes.
        </div>
      )}
      {projects && projects.length === 0 && (
        <div className="rounded-2xl bg-white p-5 text-sm text-[#6E6E78] shadow-sm">
          Intet projekt endnu — åbn dojoen i VS Code og kør <code className="rounded bg-black/[0.06] px-1">/new-project</code>.
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          {/* 7-dages træningsstribe + volumen */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {days.map((d) => {
                const s = byDay.get(d);
                return (
                  <span key={d} title={d}
                    className={`h-2.5 w-2.5 rounded-full ${
                      s?.green ? "bg-emerald-500" : s?.any ? "bg-amber-400" : "bg-black/[0.08]"
                    }`} />
                );
              })}
            </div>
            <span className="text-[11px] tabular-nums text-[#6E6E78]">
              {runs7.length > 0
                ? <>{runs7.length} kørsler · {green7} grønne · 7 dage</>
                : "ingen kørsler de sidste 7 dage"}
            </span>
          </div>

          {/* projekter, senest rørte først */}
          <div className="mt-3 flex flex-col gap-2">
            {projects.map((p) => {
              const chip = STATUS_CHIP[p.status] ?? STATUS_CHIP.started;
              return (
                <div key={p.project} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-semibold">{p.project}</span>
                    {p.level && <span className="ml-1 text-xs text-[#9A9AA8]">{p.level}</span>}
                    {p.track && <span className="ml-1 text-xs uppercase text-[#9A9AA8]">{p.track}</span>}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}>
                    {chip.label}
                  </span>
                </div>
              );
            })}
          </div>

          <a href={REPO_URL} target="_blank" rel="noreferrer"
            className="mt-3 inline-block text-xs font-medium text-[#1A1A24]/60 underline-offset-2 hover:text-[#1A1A24] hover:underline">
            åbn dojoen på GitHub ↗
          </a>
        </div>
      )}
    </section>
  );
}
