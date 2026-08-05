# Supabase migrations

Migrations for the shared **NEXUS** project (`efxmzsdisaymtpebaxlp`, `eu-north-1`).

## Naming

```
YYYYMMDDHHMMSS_short_slug.sql
```

e.g. `20260805143000_blocking_state.sql`. Timestamps order the files; keep them
unique so two branches merging don't collide.

## Rules

- **Migrations are not applied by the code that writes them.** A file landing on
  `main` changes nothing until someone runs it. This is deliberate: the project is
  shared and live, and it is the only copy — there is no staging database.
- Write forward-only. Include `IF NOT EXISTS` / `IF EXISTS` guards so re-running a
  file is harmless.
- New tables in the productivity stack are keyed `user_id TEXT DEFAULT 'default'`
  and get an anon-role RLS policy matching the existing tables
  (`time_entries`, `blocked_sites`, …). Tighten to `auth.uid()` when ecosystem
  auth reaches these tables — not before, or every existing client breaks.
- State the unique constraint any upsert path depends on. PostgREST defaults
  `on_conflict` to the primary key, and the real unique violation then surfaces
  as an opaque HTTP 409.

## Applying

```bash
supabase link --project-ref efxmzsdisaymtpebaxlp
supabase db push
```

Or paste the file into the SQL editor in the dashboard. Check the file header for
anything that must run in a specific order (e.g. a `cron.schedule` call that
references a function deployed separately).

## Related

Edge functions live in `supabase/functions/`. Deploying one is a separate step
from applying migrations:

```bash
supabase functions deploy <name> --project-ref efxmzsdisaymtpebaxlp
```
