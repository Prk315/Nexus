/**
 * Læringssti-statistik — Overblikkets venstre kolonne (afløste
 * Pensum-roadmappet og lektions-tidslinjen 2026-11-07, da eksamenerne var
 * overstået og dagen blev læsning → repetition → unit). Ét kort pr.
 * kursussti med enheder mestret/i gang/total, en identitetsfarvet
 * fremdriftsbar og de seneste 7 dages forsøg.
 *
 * Datahonestheden følger husreglerne: en sti uden forsøg i vinduet viser
 * "ingen forsøg de sidste 7 dage", aldrig "0%" (fravær er ikke nul), og en
 * fejlet hentning siger det i stedet for at rendere tomme kort.
 */

import { useEffect, useMemo, useState } from "react";
import { fetchAttempts, fetchAllUnitProgress, fetchUnitCourseMap } from "./api";
import { isCorrectAttempt, type AttemptRow } from "./stats";
import { COURSE_LIST, type CourseDef, type CourseKey } from "./courses";
import { useCourse } from "./CourseContext";
import type { LrUnitProgress } from "./types";

const DAY_MS = 86_400_000;
const DATE_FMT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" });

/** Hvilken sti et `lr_attempt_log.item_ref` hører til — prefikset er
 * kursusnøglen (evt. bag et `spr-`-sprintprefiks), med både `-` og `_` som
 * separator (`la_2_u1-…`, `mc-x-…`, `spr-dbms-…`). Anchored, så `mla-…`
 * (eksamenstræneren) aldrig tælles som `la` eller `mc`. */
function courseKeyOfRef(itemRef: string): CourseKey | null {
  const ref = itemRef.startsWith("spr-") ? itemRef.slice(4) : itemRef;
  for (const c of COURSE_LIST) {
    if (ref.startsWith(`${c.key}-`) || ref.startsWith(`${c.key}_`)) return c.key;
  }
  return null;
}

interface PathStat {
  course: CourseDef;
  mastered: number;
  inProgress: number;
  total: number;
  attempts7: number;
  correct7: number;
  lastTouch: string | null; // ISO — seneste progress-opdatering eller forsøg
}

interface Loaded {
  progressRows: LrUnitProgress[];
  unitCourse: Array<{ unit_id: number; course_id: number | null }>;
  attempts: AttemptRow[];
}

function buildStats(data: Loaded): PathStat[] {
  const courseOfUnit = new Map<number, number>();
  for (const u of data.unitCourse) {
    if (u.course_id != null) courseOfUnit.set(u.unit_id, u.course_id);
  }

  const byCourse = new Map<number, PathStat>();
  for (const c of COURSE_LIST) {
    byCourse.set(c.courseId, {
      course: c, mastered: 0, inProgress: 0, total: 0,
      attempts7: 0, correct7: 0, lastTouch: null,
    });
  }
  for (const courseId of courseOfUnit.values()) {
    const s = byCourse.get(courseId);
    if (s) s.total += 1;
  }
  for (const p of data.progressRows) {
    const courseId = courseOfUnit.get(p.unit_id);
    const s = courseId != null ? byCourse.get(courseId) : undefined;
    if (!s) continue;
    if (p.status === "mastered") s.mastered += 1;
    else if (p.status === "in_progress") s.inProgress += 1;
    if (p.updated_at && (!s.lastTouch || p.updated_at > s.lastTouch)) s.lastTouch = p.updated_at;
  }
  for (const a of data.attempts) {
    const key = courseKeyOfRef(a.item_ref);
    if (!key) continue;
    const s = [...byCourse.values()].find((v) => v.course.key === key);
    if (!s) continue;
    s.attempts7 += 1;
    if (isCorrectAttempt(a.grade)) s.correct7 += 1;
    if (!s.lastTouch || a.at > s.lastTouch) s.lastTouch = a.at;
  }

  // Kun stier der findes (har units); aktiv-senest øverst, så den sti man
  // faktisk arbejder på altid står først.
  return [...byCourse.values()]
    .filter((s) => s.total > 0)
    .sort((a, b) => (b.lastTouch ?? "").localeCompare(a.lastTouch ?? ""));
}

export function PathStatsPanel({ onOpenCourseTab }: { onOpenCourseTab: () => void }) {
  const { setCourseKey } = useCourse();
  // undefined = loading, null = fejlet.
  const [data, setData] = useState<Loaded | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sinceIso = new Date(Date.now() - 7 * DAY_MS).toISOString();
        const [progressRows, unitCourse, attempts] = await Promise.all([
          fetchAllUnitProgress(),
          fetchUnitCourseMap(),
          fetchAttempts({ sinceIso }),
        ]);
        if (alive) setData({ progressRows, unitCourse, attempts });
      } catch (e) {
        console.error("[learn] PathStatsPanel fetch failed", e);
        if (alive) setData(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => (data ? buildStats(data) : []), [data]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A9AA8]">
        Læringsstier
      </h2>

      {data === undefined && (
        <div className="rounded-2xl bg-white p-5 text-sm text-[#6E6E78] shadow-sm">Indlæser…</div>
      )}
      {data === null && (
        <div className="rounded-2xl border border-dashed border-black/[0.12] bg-black/[0.02] p-5 text-sm text-[#6E6E78]">
          Statistikken kunne ikke hentes.
        </div>
      )}

      {stats.map((s) => {
        const dot = s.course.lenses[s.course.lensOrder[0]]?.dot ?? "bg-[#1A1A24]";
        const pct = s.total > 0 ? s.mastered / s.total : 0;
        return (
          <div key={s.course.courseId} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{s.course.title}</div>
                <div className="mt-0.5 text-[11px] text-[#9A9AA8]">
                  {s.lastTouch ? <>senest {DATE_FMT.format(new Date(s.lastTouch))}</> : "ikke startet"}
                </div>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums">
                {s.mastered}<span className="font-normal text-[#9A9AA8]">/{s.total}</span>
              </span>
            </div>

            {/* mestret (fuld farve) + i gang (svag) over samme spor */}
            <div className="mt-2.5 flex h-2 w-full gap-px overflow-hidden rounded-full bg-black/[0.06]">
              {s.mastered > 0 && (
                <div className={`h-full ${dot}`} style={{ width: `${pct * 100}%` }} />
              )}
              {s.inProgress > 0 && (
                <div className={`h-full ${dot} opacity-35`} style={{ width: `${(s.inProgress / s.total) * 100}%` }} />
              )}
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-[#6E6E78]">
              <span className="tabular-nums">
                {s.attempts7 > 0
                  ? <>{s.attempts7} forsøg · {Math.round((s.correct7 / s.attempts7) * 100)}% · 7 dage</>
                  : "ingen forsøg de sidste 7 dage"}
                {s.inProgress > 0 && <> · {s.inProgress} i gang</>}
              </span>
              <button
                onClick={() => { setCourseKey(s.course.key); onOpenCourseTab(); }}
                className="shrink-0 font-semibold text-[#1A1A24]/70 underline-offset-2 hover:text-[#1A1A24] hover:underline"
              >
                åbn sti →
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
