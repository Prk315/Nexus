import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * task-quick — the quick-task widget's only write path into `pf_tasks`.
 *
 * Same shape and rationale as `habit-toggle`: the widget extension on a
 * free-tier sideloaded install cannot hold the user's JWT, so it carries a
 * dedicated single-purpose secret (`WIDGET_TASK_KEY`) that this function — and
 * nothing else — accepts. The anon key has no write policy on pf_tasks.
 *
 * Two operations, both bounded to the owner's rows:
 *   { action: "toggle", taskId, done }         — complete / reopen a task
 *   { action: "create", title, category? }     — capture a quick task
 *
 * Create exists for Shortcuts/Siri-style capture (widgets themselves can't
 * take text input); category defaults to "reminder" — the capture bucket.
 */

const OWNER_UID = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

const CATEGORIES = ["reminder", "chore", "shopping"] as const;

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

  const expected = Deno.env.get("WIDGET_TASK_KEY") ?? "";
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
    const { taskId, done } = body as { taskId?: unknown; done?: unknown };
    if (typeof taskId !== "number" || !Number.isInteger(taskId)) {
      return json({ error: "invalid_taskId" }, 400);
    }
    if (typeof done !== "boolean") return json({ error: "invalid_done" }, 400);

    // Service role bypasses RLS, so ownership is enforced here: the update is
    // keyed on (id, owner) and a foreign id simply matches nothing.
    const { data, error } = await supabase
      .from("pf_tasks")
      .update({ done })
      .eq("id", taskId)
      .eq("user_id", OWNER_UID)
      .select("id")
      .maybeSingle();

    if (error) return json({ error: "update_failed" }, 500);
    if (!data) return json({ error: "unknown_task" }, 404);
    return json({ ok: true, done });
  }

  if (action === "create") {
    const { title, category } = body as { title?: unknown; category?: unknown };
    if (typeof title !== "string" || title.trim().length === 0 || title.length > 500) {
      return json({ error: "invalid_title" }, 400);
    }
    const cat = category ?? "reminder";
    if (typeof cat !== "string" || !CATEGORIES.includes(cat as (typeof CATEGORIES)[number])) {
      return json({ error: "invalid_category" }, 400);
    }

    const { data, error } = await supabase
      .from("pf_tasks")
      .insert({
        user_id: OWNER_UID,
        plan_id: null,
        title: title.trim(),
        category: cat,
      })
      .select("id")
      .single();

    if (error) return json({ error: "insert_failed" }, 500);
    return json({ ok: true, id: data.id });
  }

  return json({ error: "invalid_action" }, 400);
});
