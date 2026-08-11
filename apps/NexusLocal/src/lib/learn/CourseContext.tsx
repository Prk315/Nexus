/**
 * The active-course context — LEARN_PLAN.md "App course support". Wraps the
 * whole `LearnPage` tree (`index.tsx`) so every panel and every `player/`
 * primitive can resolve "which course, which lenses" via `useCourse()`
 * without prop-drilling a `course` object through `Player.tsx` -> `LayerStep`
 * -> `DrillCard` -> `TheoryCard` -> `LensChip`, five components deep for a
 * value that never changes mid-session.
 *
 * Persisted to `localStorage` (`learn:activeCourse`) so the choice survives a
 * reload — same pattern `ReviewPanel.tsx` already uses for its "last known
 * verdict" cache.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { COURSES, DEFAULT_COURSE_KEY, isCourseKey, type CourseDef, type CourseKey } from "./courses";

const STORAGE_KEY = "learn:activeCourse";

interface CourseContextValue {
  course: CourseDef;
  courseKey: CourseKey;
  setCourseKey: (key: CourseKey) => void;
}

const CourseContext = createContext<CourseContextValue | null>(null);

function readStoredCourseKey(): CourseKey {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isCourseKey(raw)) return raw;
  } catch {
    // localStorage unavailable (private mode, iOS webview quirk) — fall
    // through to the default rather than throwing on mount.
  }
  return DEFAULT_COURSE_KEY;
}

export function CourseProvider({ children }: { children: ReactNode }) {
  const [courseKey, setCourseKeyState] = useState<CourseKey>(readStoredCourseKey);

  const setCourseKey = useCallback((key: CourseKey) => {
    setCourseKeyState(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Best-effort persistence only — the in-memory switch above already
      // took effect for this session.
    }
  }, []);

  const value = useMemo<CourseContextValue>(
    () => ({ course: COURSES[courseKey], courseKey, setCourseKey }),
    [courseKey, setCourseKey]
  );

  return <CourseContext.Provider value={value}>{children}</CourseContext.Provider>;
}

export function useCourse(): CourseContextValue {
  const ctx = useContext(CourseContext);
  if (!ctx) throw new Error("useCourse() must be called within <CourseProvider>");
  return ctx;
}
