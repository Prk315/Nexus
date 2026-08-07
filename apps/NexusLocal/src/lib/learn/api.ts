/**
 * Supabase access for the Learn feature. All `lr_*` tables are anon-keyed
 * (`user_id = "default"`, permissive `anon_all` RLS) — same posture as the
 * productivity stack, so every call here goes through `supabasePublic`, never
 * `supabase`. Reading these tables with the authenticated JWT returns an
 * empty set, not an error (see CLAUDE.md's "Conventions that fail silently").
 */

import { supabasePublic } from "../supabase";
import type {
  ContentStatus,
  Grade,
  Lens,
  LrLearnState,
  LrMemoryState,
  LrUnit,
  LrUnitContentRow,
  LrUnitProgress,
  PathUnit,
  UnitProgressStatus,
} from "./types";

const USER_ID = "default";

// Content status preference when several rows exist for the same unit_id:
// live beats approved beats draft. The app never renders a plain "draft" as
// if it were finished content — see Player.tsx's "KLADDE" badge.
const STATUS_RANK: Record<ContentStatus, number> = {
  live: 2,
  approved: 1,
  draft: 0,
};

function bestContentRow(rows: LrUnitContentRow[]): LrUnitContentRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    const rankDiff = STATUS_RANK[row.status] - STATUS_RANK[best.status];
    if (rankDiff > 0) return row;
    if (rankDiff < 0) return best;
    return row.version > best.version ? row : best;
  });
}

/**
 * The path spine: every unit, this user's progress on it (defaulting to
 * "locked"), and whether it has any content to show — one round trip per
 * table, joined client-side.
 */
export async function fetchPath(): Promise<PathUnit[]> {
  const [unitsRes, progressRes, contentRes] = await Promise.all([
    supabasePublic.from("lr_unit").select("*").order("idx", { ascending: true }),
    supabasePublic.from("lr_unit_progress").select("*").eq("user_id", USER_ID),
    supabasePublic.from("lr_unit_content").select("unit_id, version, status"),
  ]);

  if (unitsRes.error) throw unitsRes.error;
  if (progressRes.error) throw progressRes.error;
  if (contentRes.error) throw contentRes.error;

  const units = (unitsRes.data ?? []) as LrUnit[];
  const progressByUnit = new Map<number, UnitProgressStatus>();
  for (const p of (progressRes.data ?? []) as LrUnitProgress[]) {
    progressByUnit.set(p.unit_id, p.status);
  }

  const contentByUnit = new Map<number, ContentStatus[]>();
  for (const row of (contentRes.data ?? []) as Array<Pick<LrUnitContentRow, "unit_id" | "version" | "status">>) {
    const list = contentByUnit.get(row.unit_id) ?? [];
    list.push(row.status);
    contentByUnit.set(row.unit_id, list);
  }

  return units.map((unit) => {
    const statuses = contentByUnit.get(unit.unit_id) ?? [];
    const best = statuses.reduce<ContentStatus | null>((acc, s) => {
      if (acc === null || STATUS_RANK[s] > STATUS_RANK[acc]) return s;
      return acc;
    }, null);
    return {
      unit,
      progress: progressByUnit.get(unit.unit_id) ?? "locked",
      hasContent: statuses.length > 0,
      contentStatus: best,
    };
  });
}

/**
 * Best available content for one unit: prefer status live > approved > draft,
 * then the highest version within that status. Returns null if the unit has
 * no content rows at all.
 */
export async function fetchUnitContent(unitId: number): Promise<LrUnitContentRow | null> {
  const { data, error } = await supabasePublic
    .from("lr_unit_content")
    .select("*")
    .eq("unit_id", unitId);
  if (error) throw error;
  return bestContentRow((data ?? []) as LrUnitContentRow[]);
}

/** Record one graded attempt (drill or test question). */
export async function logAttempt(params: {
  itemRef: string;
  lens: Lens | null;
  grade: Grade;
}): Promise<void> {
  const { error } = await supabasePublic.from("lr_attempt_log").insert({
    user_id: USER_ID,
    item_ref: params.itemRef,
    lens: params.lens,
    grade: params.grade,
  });
  if (error) throw error;
}

/** Fetch current memory state for a set of concepts (missing = never bootstrapped). */
export async function fetchMemoryStates(
  conceptIds: string[]
): Promise<Record<string, LrMemoryState>> {
  if (conceptIds.length === 0) return {};
  const { data, error } = await supabasePublic
    .from("lr_memory_state")
    .select("*")
    .eq("user_id", USER_ID)
    .in("concept_id", conceptIds);
  if (error) throw error;
  const out: Record<string, LrMemoryState> = {};
  for (const row of (data ?? []) as LrMemoryState[]) {
    out[row.concept_id] = row;
  }
  return out;
}

/** Upsert a full memory-state row (alpha/beta/heat/lens_counts already computed by memory.ts). */
export async function upsertMemory(state: LrMemoryState): Promise<void> {
  const { error } = await supabasePublic
    .from("lr_memory_state")
    .upsert({ ...state, user_id: USER_ID }, { onConflict: "user_id,concept_id" });
  if (error) throw error;
}

/** Flip a unit's progress status. Pass `masteredAt` when status transitions to "mastered". */
export async function setUnitProgress(
  unitId: number,
  status: UnitProgressStatus,
  masteredAt?: string
): Promise<void> {
  const { error } = await supabasePublic.from("lr_unit_progress").upsert(
    {
      user_id: USER_ID,
      unit_id: unitId,
      status,
      ...(masteredAt ? { mastered_at: masteredAt } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,unit_id" }
  );
  if (error) throw error;
}

/**
 * The server-computed verdict row (blocking_state pattern). A missing row
 * means "no verdict has ever been computed" — NEVER "nothing due". Callers
 * must render that as "ingen dom endnu", not as an empty due queue.
 */
export async function fetchLearnState(): Promise<LrLearnState | null> {
  const { data, error } = await supabasePublic
    .from("lr_learn_state")
    .select("*")
    .eq("user_id", USER_ID)
    .maybeSingle();
  if (error) throw error;
  return (data as LrLearnState | null) ?? null;
}
