/**
 * The course switcher — LEARN_PLAN.md "App course support": "a course
 * switcher on the Learn page". Two entries today (LA default, DBMS second),
 * compact enough to sit next to the page's own chrome rather than becoming a
 * new full-width section — every panel below it (`PathPanel`, `ReviewPanel`,
 * `InfinitePanel`, `ChallengePanel`) re-reads `useCourse()` and refetches on
 * its own, so switching is just a `setCourseKey` call; this component owns no
 * data of its own.
 *
 * Styled as a two-segment pill, matching the soft-white "paper" token ladder
 * (DESIGN.md §7) rather than inventing a new control shape.
 */

import { COURSE_LIST } from "./courses";
import { useCourse } from "./CourseContext";

export function CourseSwitcher() {
  const { courseKey, setCourseKey } = useCourse();

  return (
    <div
      role="tablist"
      aria-label="Course"
      className="inline-flex shrink-0 gap-0.5 rounded-full bg-black/[0.04] p-0.5 ring-1 ring-black/[0.06]"
    >
      {COURSE_LIST.map((c) => {
        const active = c.key === courseKey;
        return (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setCourseKey(c.key)}
            className={`min-h-[30px] rounded-full px-3 text-[11px] font-medium tracking-wide transition-colors ${
              active
                ? "bg-white text-[#1A1A24]/90 shadow-[0_1px_4px_rgba(0,0,0,0.08)]"
                : "text-[#6E6E78] active:text-[#1A1A24]/70"
            }`}
          >
            {c.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
