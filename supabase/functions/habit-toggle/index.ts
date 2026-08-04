import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * habit-toggle — the ONLY write path the Nexus Local iOS widget has.
 *
 * Why this exists: a widget extension on a free-tier sideloaded install cannot
 * receive the user's JWT (App Groups need paid provisioning — see commit
 * bbf60f1), so it has no way to authenticate as the user. The previous approach
 * granted the *public* anon key INSERT/DELETE on protocol_habit_completions,
 * which made every habit row world-writable to anyone holding a key that ships
 * in every web bundle.
 *
 * Instead the widget holds a dedicated secret that is good for exactly one
 * operation: toggling one user's habit completion. It is not the anon key, it
 * grants no read access to anything, and it is revoked by rotating a single
 * env var (`supabase secrets set WIDGET_HABIT_KEY=...`) plus rebuilding.
 *
 * The residual risk is unavoidable and worth stating plainly: the secret ships
 * inside a distributed binary, so it is extractable. What this design buys is a
 * blast radius of "can toggle this user's habit completions" instead of "can
 * read and write everything the anon role can reach".
 */

const OWNER_UID = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

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

  const expected = Deno.env.get("WIDGET_HABIT_KEY") ?? "";
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

  const { habitId, date, done } = body as {
    habitId?: unknown;
    date?: unknown;
    done?: unknown;
  };

  if (typeof habitId !== "string" || !UUID_RE.test(habitId)) {
    return json({ error: "invalid_habitId" }, 400);
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return json({ error: "invalid_date" }, 400);
  }
  if (typeof done !== "boolean") return json({ error: "invalid_done" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Defence in depth: the service role bypasses RLS, so ownership is enforced
  // here. This is what stops a leaked widget key from touching anyone else's
  // rows even if a habit id from another account were guessed.
  const { data: habit, error: lookupError } = await supabase
    .from("protocol_habits")
    .select("id")
    .eq("id", habitId)
    .eq("user_id", OWNER_UID)
    .maybeSingle();

  if (lookupError) return json({ error: "lookup_failed" }, 500);
  if (!habit) return json({ error: "unknown_habit" }, 404);

  // Always clear first: protocol_habit_completions has no unique constraint, so
  // this makes the toggle idempotent and self-healing against duplicate rows
  // (a double-tap previously risked inserting two).
  const { error: deleteError } = await supabase
    .from("protocol_habit_completions")
    .delete()
    .eq("habit_id", habitId)
    .eq("user_id", OWNER_UID)
    .eq("date", date);

  if (deleteError) return json({ error: "delete_failed" }, 500);

  if (done) {
    const { error: insertError } = await supabase
      .from("protocol_habit_completions")
      .insert({ habit_id: habitId, user_id: OWNER_UID, date });
    if (insertError) return json({ error: "insert_failed" }, 500);
  }

  return json({ ok: true, done });
});
