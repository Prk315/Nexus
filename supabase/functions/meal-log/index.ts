import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * meal-log — the meal widget's only write path into
 * `protocol_meal_plan_entries`.
 *
 * Same shape and rationale as `habit-toggle` / `task-quick`: the widget holds
 * a dedicated secret (`WIDGET_MEAL_KEY`) good for exactly this. The anon key
 * can *read* the owner's plan entries (widget_anon_read) but write nothing.
 *
 * Two operations:
 *   { action: "toggle", entryId, logged }              — mark a planned meal
 *                                                        eaten / not eaten
 *   { action: "log", date, slot, mealId? | foodId? }   — quick-log something
 *                                                        unplanned, already
 *                                                        marked logged
 *
 * `date` comes from the device: the widget knows the user's local day, this
 * function does not — server-side "today" would flip meals across midnight UTC.
 */

const OWNER_UID = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Length-independent comparison so a wrong key can't be recovered by timing. */
function secretMatches(candidate: string, expected: string): boolean {
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("WIDGET_MEAL_KEY") ?? "";
  // Fail closed: an unset secret must never mean "allow everyone".
  if (expected.length < 32) return json({ error: "server_misconfigured" }, 500);

  if (!secretMatches(req.headers.get("x-widget-key") ?? "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const action = body.action;

  if (action === "toggle") {
    const { entryId, logged } = body as { entryId?: unknown; logged?: unknown };
    if (typeof entryId !== "string" || !UUID_RE.test(entryId)) {
      return json({ error: "invalid_entryId" }, 400);
    }
    if (typeof logged !== "boolean") return json({ error: "invalid_logged" }, 400);

    // Service role bypasses RLS; keying the update on (id, owner) is the
    // ownership check — a foreign id matches nothing.
    const { data, error } = await supabase
      .from("protocol_meal_plan_entries")
      .update({ logged })
      .eq("id", entryId)
      .eq("user_id", OWNER_UID)
      .select("id")
      .maybeSingle();

    if (error) return json({ error: "update_failed" }, 500);
    if (!data) return json({ error: "unknown_entry" }, 404);
    return json({ ok: true, logged });
  }

  if (action === "log") {
    const { date, slot, mealId, foodId } = body as {
      date?: unknown;
      slot?: unknown;
      mealId?: unknown;
      foodId?: unknown;
    };
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return json({ error: "invalid_date" }, 400);
    }
    if (typeof slot !== "string" || !SLOTS.includes(slot as (typeof SLOTS)[number])) {
      return json({ error: "invalid_slot" }, 400);
    }
    const hasMeal = typeof mealId === "string";
    const hasFood = typeof foodId === "string";
    if (hasMeal === hasFood) return json({ error: "need_exactly_one_of_mealId_foodId" }, 400);
    const refId = (hasMeal ? mealId : foodId) as string;
    if (!UUID_RE.test(refId)) return json({ error: "invalid_ref" }, 400);

    // The referenced meal/food must exist. Meals are a shared library
    // (read-all, so any user's saved meal is loggable — matching the apps);
    // the FK would reject a bogus id anyway, this just returns a clean 404.
    const refTable = hasMeal ? "protocol_meals" : "protocol_foods";
    const { data: ref, error: refError } = await supabase
      .from(refTable)
      .select("id")
      .eq("id", refId)
      .maybeSingle();
    if (refError) return json({ error: "lookup_failed" }, 500);
    if (!ref) return json({ error: "unknown_ref" }, 404);

    const { data, error } = await supabase
      .from("protocol_meal_plan_entries")
      .insert({
        user_id: OWNER_UID,
        date,
        slot,
        meal_id: hasMeal ? refId : null,
        food_id: hasFood ? refId : null,
        quantity: 1,
        logged: true,
      })
      .select("id")
      .single();

    if (error) return json({ error: "insert_failed" }, 500);
    return json({ ok: true, id: data.id });
  }

  return json({ error: "invalid_action" }, 400);
});
