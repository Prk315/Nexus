/**
 * Uge-træet — pensum som en git-graf. Stammen er terminens uger (én node per
 * uge, forbundet af en path ned til eksamensnoden); hver uges leverancer
 * sidder som blade på farvede kursusgrene, der kurver ud fra ugenoden —
 * samme sprog som `git log --graph`. Fortiden er dæmpet og ✓-markeret,
 * nutiden fremhævet, fremtiden er projektionen fra `buildWeekTree`.
 *
 * Rent SVG, alt beregnet fra data — ingen håndtegnede positioner. Farver er
 * per kursus og stabile (rækkefølgen af enrollments), deadlines er altid
 * røde: semantik må ikke skifte med temaet eller kursuslisten.
 */
import type { WeekNode } from "./roadmapData";

const COURSE_HUES = ["#5B5BD6", "#047857", "#B45309", "#B426C4"];
const ROSE = "#BE123C";
const ROW = 22;          // px per leverance-række
const WEEK_PAD = 14;     // luft over/under en uges blade
const TRUNK_X = 26;
const BRANCH_X = 54;

export function WeekTree({ weeks }: { weeks: WeekNode[] }) {
  const courses = [...new Set(weeks.flatMap((w) => w.items.map((i) => i.course)))]
    .filter(Boolean);
  const hue = (course: string, kind: string) =>
    kind === "deadline" ? ROSE : COURSE_HUES[courses.indexOf(course) % COURSE_HUES.length];

  // layout: én sektion per uge; højden afhænger af antal blade
  let y = 10;
  const sections = weeks.map((w) => {
    const h = Math.max(ROW, w.items.length * ROW) + WEEK_PAD * 2;
    const top = y;
    y += w.state === "exam" ? 46 : h;
    return { w, top, h };
  });
  const totalH = y + 10;

  return (
    <div className="overflow-x-auto rounded-2xl bg-white p-2 shadow-sm">
      <svg width="100%" height={totalH} viewBox={`0 0 560 ${totalH}`} style={{ minWidth: 420 }}>
        {/* stammen */}
        <line x1={TRUNK_X} y1={14} x2={TRUNK_X} y2={totalH - 14}
          stroke="#C6C6D2" strokeWidth={2.5} />
        {sections.map(({ w, top }) => {
          const nodeY = top + WEEK_PAD + 2;
          const dim = w.state === "past";
          if (w.state === "exam") {
            return (
              <g key={w.idx}>
                <circle cx={TRUNK_X} cy={nodeY} r={9} fill={ROSE} />
                <text x={TRUNK_X + 20} y={nodeY + 5} fontSize={14} fontWeight={700} fill={ROSE}
                  fontFamily="Archivo, sans-serif">EKSAMEN · {w.start}</text>
              </g>
            );
          }
          return (
            <g key={w.idx} opacity={dim ? 0.45 : 1}>
              {/* ugenode */}
              <circle cx={TRUNK_X} cy={nodeY} r={w.state === "current" ? 8 : 6}
                fill={w.state === "current" ? "#1A1A24" : "#fff"}
                stroke="#1A1A24" strokeWidth={2} />
              <text x={TRUNK_X - 18} y={nodeY + 4} fontSize={11} fontWeight={700}
                textAnchor="end" fill="#6E6E78" fontFamily="Archivo, sans-serif">
                U{w.idx}
              </text>
              {w.state === "current" && (
                <text x={TRUNK_X - 18} y={nodeY + 17} fontSize={9} textAnchor="end"
                  fill="#B426C4" fontFamily="Archivo, sans-serif">nu</text>
              )}
              {/* blade på grene */}
              {w.items.map((it, i) => {
                const iy = top + WEEK_PAD + i * ROW + 2;
                const col = hue(it.course, it.kind);
                return (
                  <g key={i}>
                    <path d={`M ${TRUNK_X} ${nodeY} C ${TRUNK_X + 16} ${nodeY}, ${BRANCH_X - 14} ${iy}, ${BRANCH_X} ${iy}`}
                      fill="none" stroke={col} strokeWidth={1.6} opacity={0.75} />
                    <circle cx={BRANCH_X} cy={iy} r={4.5}
                      fill={it.done ? col : "#fff"} stroke={col} strokeWidth={1.8} />
                    {it.done && (
                      <text x={BRANCH_X} y={iy + 3} fontSize={7} fontWeight={700} fill="#fff"
                        textAnchor="middle">✓</text>
                    )}
                    <text x={BRANCH_X + 12} y={iy + 4} fontSize={12}
                      fill={it.done ? "#9A9AA8" : "#1A1A24"}
                      textDecoration={it.done ? "line-through" : undefined}
                      fontFamily="Archivo, sans-serif">
                      {it.course && it.kind !== "deadline" ? `${it.course} · ` : ""}{it.text}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {/* legende */}
      <div className="flex flex-wrap gap-3 px-3 pb-2 pt-1 text-[11px] text-[#6E6E78]">
        {courses.map((c, i) => (
          <span key={c} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: COURSE_HUES[i % COURSE_HUES.length] }} />
            {c}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: ROSE }} />deadline
        </span>
      </div>
    </div>
  );
}
