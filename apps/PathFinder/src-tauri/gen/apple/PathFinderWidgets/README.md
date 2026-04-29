# PathFinder Widgets

WidgetKit extension for the PathFinder iOS app. Five home-screen widgets that display live data from Supabase.

---

## Architecture

```
iPhone Home Screen
      │
      ▼
 WidgetKit Extension (PathFinderWidgets)
      │  URLSession (HTTPS)
      ▼
 Supabase REST API
 efxmzsdisaymtpebaxlp.supabase.co
      │
      ▼
 pf_* tables (user_id = "default")
```

**Key design decisions:**
- Widgets query Supabase REST directly — no App Groups, no dependency on the main app being open
- The Supabase anon key is bundled in `Secrets.swift` (gitignored). This is safe because the key is a public "publishable" credential and all tables use permissive RLS (`USING (true)`)
- All three widgets are display-only. WidgetKit on iOS 14–16 is read-only; tapping a widget deep-links into the main app
- Timeline: 4 entries × 15 min = 1-hr window, then `.atEnd` triggers a reload. System may throttle to ~40–70 network fetches/day

---

## The Six Widgets

| Widget | Sizes | Tables queried | Notes |
|--------|-------|----------------|-------|
| **System Status** | Small, Medium, Large | `pf_daily_habits`, `pf_habit_completions`, `pf_systems` | Solo Leveling aesthetic — daily mission list (habits + due systems), done/remaining count |
| Today Focus | Small, Medium | `pf_daily_primary_goal`, `pf_daily_secondary_goals`, `pf_tasks` | |
| Habits | Medium, Large | `pf_daily_habits`, `pf_habit_completions` | |
| Systems Due | Small, Medium | `pf_systems` | |
| Goals | Small, Medium | `pf_goals` | |
| Tasks | Medium, Large | `pf_tasks` | |

### System Status — mission sources
- **Habits** (`pf_daily_habits`) — always shown, marked done when completed today via `pf_habit_completions`
- **Systems** (`pf_systems`) — shown only when `systemIsDue()` returns true (i.e. not yet handled today)

Incomplete missions sort to the top; completed missions sink to the bottom.

---

## First-time setup

1. Copy `Secrets.swift.template` → `Secrets.swift`
2. Paste your Supabase anon key (Dashboard → Project Settings → API → anon public key)
3. `cd apps/PathFinder/src-tauri/gen/apple && xcodegen generate`
4. `cd apps/PathFinder && npx tauri ios dev`
5. On iPhone: long-press home → **+** → search "PathFinder"

---

## How project.yml hooks this in

`project.yml` (XcodeGen config) declares:
- A new `PathFinderWidgets` app extension target pointing at this directory
- An `embed: true` dependency from the main `pathfinder_iOS` target so the extension is bundled into the app

If `npx tauri ios init` is ever re-run (full iOS project reset), it overwrites `project.yml`. Re-add:
1. The `PathFinderWidgets` target block at the bottom of `project.yml`
2. `- target: PathFinderWidgets / embed: true` inside `pathfinder_iOS` dependencies

The Swift source files here are **never** touched by Tauri — only `project.yml` would need patching.

---

## Potential future bugs

### 1. Secrets.swift missing after fresh clone
`Secrets.swift` is gitignored. Any new machine or CI run won't have it. The build will fail with `Cannot find type 'Secrets' in scope` across all widget files.
**Fix:** Copy from `Secrets.swift.template` and fill in the anon key.

### 2. `tauri ios init` overwrites project.yml
See above. The widget target additions disappear and the widget extension won't be included in the build.
**Fix:** Re-apply the two YAML blocks manually.

### 3. Anon key rotation
If the Supabase anon key is rotated (Dashboard → regenerate), `Secrets.swift` becomes stale. Widgets will get HTTP 401 errors and show stale/empty data silently (the `try?` swallows the error).
**Fix:** Update `Secrets.swift` with the new key and redeploy.

### 4. `user_id` hardcoded as "default"
All queries filter by `user_id = eq.default`. If multi-user auth is ever added to PathFinder (replacing the `USER_ID = "default"` constant in `api.ts`), the widgets will keep hitting the `default` user's rows.
**Fix:** Pass the real user ID into `Secrets.userID` or fetch it via a Supabase Auth session from the keychain.

### 5. Table schema changes
If a `pf_*` column is renamed or removed, the `Codable` struct in `WidgetModels.swift` will either silently ignore the new column or fail to decode. Supabase REST returns `null` for missing columns rather than an error, so this is quiet.
**Fix:** Keep `WidgetModels.swift` in sync with any `api.ts` schema changes.

### 6. WidgetKit network throttling
iOS limits widget network refreshes to roughly 40–70 per day. If the user has many widgets active simultaneously (all three PathFinder widgets + others), the system may defer refreshes further. Data can be up to a few hours stale.
**Mitigation:** Accept this — it's a system constraint. For truly time-sensitive data (e.g. overdue tasks), consider adding a `Link` deep-link so the user can tap to open the app and see live data.

### 7. `pf_habit_completions` query with large ID list
`HabitsProvider` builds `habit_id=in.(1,2,3,...)` from all habit IDs. If the user has many habits, this URL can get long. PostgREST handles this fine up to a few hundred IDs, but if it ever hits URL length limits, switch to a `POST` request with a body filter or use an RPC function.

### 8. `systemIsDue()` timezone edge case
`todayString()` uses the device's local timezone. Supabase stores `last_done` as plain `YYYY-MM-DD` with no timezone info. If the user travels across timezone boundaries, a system might appear due twice or not due when it should be. This is the same behaviour as the React app (which also uses local time).

### 9. iOS 17+ interactive widgets
Widgets on iOS 17+ can have interactive controls (buttons, toggles). Currently all three widgets are display-only. Adding a "mark done" button for habits/systems would require:
- `Button` with `.appIntent` (iOS 17 `AppIntent` framework)
- A new Supabase write call from the widget process
- This is a meaningful future upgrade but requires iOS 17 as minimum for the widget target
