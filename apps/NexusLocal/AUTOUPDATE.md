# Nexus Local — auto-update via SideStore + GitHub

How a new build of Nexus Local reaches the iPhone without plugging into a Mac.

## The two layers

1. **Auto-refresh** (already set up in SideStore): re-signs installed apps every
   few days so the free-tier 7-day certificate never expires. Keeps what's
   installed *working* — it does not change the version.
2. **Auto-update** (this pipeline): SideStore polls a **source** (`apps.json`).
   When the source advertises a higher `version` than what's installed, SideStore
   offers/installs the update and re-signs it on-device. Keeps the app *current*.

Because SideStore re-signs on-device with your own Apple ID, CI ships an
**unsigned** IPA — no Apple account or certificate lives in GitHub.

## Pipeline

```
bump version in tauri.conf.json
        │
        ▼
git tag nexuslocal-v<version>  ──push──►  GitHub Actions (macos-15)
        │                                   │
        │                                   ├─ tauri ios build --no-sign  → unsigned .ipa
        │                                   ├─ GitHub Release  (asset: NexusLocal-<v>.ipa)
        │                                   └─ gen-source.mjs → apps.json → GitHub Pages
        ▼
SideStore polls  https://prk315.github.io/Nexus/apps.json
        │
        └─ sees new version → downloads IPA → re-signs on device → installs
```

Workflow: `.github/workflows/nexuslocal-ios.yml`. Helpers live in
`apps/NexusLocal/ci/` (`collect-ipa.sh`, `gen-source.mjs`, `source.base.json`).

## One-time setup

- **Repo secrets** (Settings → Secrets and variables → Actions):
  - `SUPABASE_ANON_KEY` — the Supabase anon/publishable key (frontend + widget).
  - `SUPABASE_USER_ID` — your Supabase auth uid (widget data scope).
  - `WIDGET_HABIT_KEY` — the widget's dedicated habit-toggle credential. Must
    match the Supabase function secret of the same name
    (`supabase secrets set WIDGET_HABIT_KEY=… --project-ref efxmzsdisaymtpebaxlp`).
    The build fails fast if it's missing, since an empty value compiles cleanly
    but makes every habit tap 401.
  - Optional var `SUPABASE_URL` (defaults to the NEXUS project URL if unset).
- **GitHub Pages**: Settings → Pages → Source = *GitHub Actions*.
- **SideStore** (on the phone): Sources → **+** →
  `https://prk315.github.io/Nexus/apps.json` → add Nexus Local.

## Shipping an update

```bash
# 1. bump the version
#    apps/NexusLocal/src-tauri/tauri.conf.json  →  "version": "0.2.0"
# 2. tag + push
git tag nexuslocal-v0.2.0
git push origin nexuslocal-v0.2.0
```

CI builds, releases, and refreshes the source. SideStore picks it up on its next
poll (or pull-to-refresh in the app).

### Test the build without releasing

Actions → **Nexus Local — iOS (SideStore)** → Run workflow → `publish: false`.
Builds the unsigned IPA and uploads it as a run artifact only — no release, no
Pages change. Flip `publish: true` to cut a real release from a manual run.

## Adding another app later (PathFinder, TimeTracker, …)

The source is built to grow:

1. Add an entry to `apps[]` in `ci/source.base.json` (name, bundle id, icon).
2. Give that app its own build workflow (copy this one; swap the app dir,
   secrets, and tag prefix), calling `gen-source.mjs` with
   `TARGET_BUNDLE=<that app's bundle id>`.
3. Both apps then live under the **same** SideStore source URL.

## Caveats

- Free tier allows **3 sideloaded apps** total — Nexus Local consolidates the
  native pieces precisely to stay under that cap.
- Separately from the 3-app cap, a free Apple ID may register **10 App IDs per
  rolling 7 days**, and *every embedded extension is its own App ID*. Nexus Local
  currently ships three: the app, `NexusLocalWidgets`, and
  `nexus-local_SafariBlocker` (the Safari content blocker — restored to the build
  deliberately, since without it in the IPA `reloadContentBlocker` fails silently
  and nothing is ever blocked). That is **3 of 10** per re-sign; adding further
  extensions eats the same budget, and a burst of re-signs in one week can hit it.
- CI is **free**: this repo is public, and GitHub-hosted *standard* runners
  (including `macos-15`) are unlimited and unbilled on public repos. The oft-cited
  **10×** macOS multiplier applies only to *private* repos, where it drains an
  included-minutes allowance — there is no such allowance here. A build is ~7-8 min.
  (This would change if the repo were made private, or if it moved to a "larger
  runner", which is billed even on public repos.)
- Updates are **one tap** in SideStore (iOS gives no true silent background
  install for sideloaded apps) — SideStore can notify + auto-download, but the
  install confirmation is manual.
- The unsigned IPA embeds the Supabase **anon** key (same key the web apps ship;
  tables are RLS-protected) — acceptable for a public repo, same posture as any
  client app.
