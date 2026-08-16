# Vault Drawing — Execution Plan

Goal: bring CanvasEditor's ink layer to the standard set by GoodNotes / Notability /
Apple Notes on iPad — pressure-sensitive, low-latency Pencil feel, a real tool set
(eraser, highlighter, lasso, shape assist), and a toolbar that remembers what you
were doing. Each phase is one PR, independently shippable, ordered so the data-model
change lands first and everything else builds on it.

The real usage surface is **iPad Safari (PWA)** at `neurovias-nexus-vault.vercel.app`.
Every phase is verified two ways: the synthetic-pen browser harness (see §Verification)
and an on-device check.

## Current state (audited 2026-08-16, CanvasEditor.tsx ~3925 lines)

What exists: pen-only ink mode behind a capture layer (`.canvas-ink-layer`, z-5),
10 colors + 4 nibs, quadratic-midpoint smoothing at render time, per-stroke path
memo cache, stroke drag via a fat transparent hit path, undo/redo stacks (50),
two-finger pinch/pan, single-finger touch suppressed in ink mode.

What's missing or broken, in the order it hurts:

- **Points are bare `{x,y}`** — no pressure, tilt, or timestamps (`InkStrokeBlock`, L50).
  Every stroke is a uniform-width tube; nothing downstream can ever taper.
- **No `getCoalescedEvents`** — Pencil samples at 240 Hz, pointermove delivers ~60 Hz;
  three of every four samples are discarded, so fast strokes come out angular.
- **Live preview goes through React state** — `setInkPreview(pointsToSmoothPath(all points))`
  on *every* pointermove (L2241-2250): O(n) path rebuild + reconcile per sample. Long
  strokes visibly lag the pen tip.
- **No eraser, no highlighter, no lasso in ink mode, no shape assist.** Ink mode is
  literally one pen. (Contrast: `PdfViewer.tsx:51` already has pen/highlighter/eraser/
  lasso with pressure — the canvas is the laggard.)
- **Palm-first kills the stroke**: `if (!e.isPrimary) return` (L2055) means a palm
  that lands before the pen makes the *pen* non-primary and its stroke is dropped.
- **No point simplification or rounding** — every raw sample serializes as
  `{"x":123.45678,"y":…}`. This is the same class of bloat as the 2026-08-15 save
  incident (1.9 MB canvas autosave wedged Supabase for 2 h).
- Smaller latent bugs: recolor/re-width from the float toolbar bypasses `pushUndo`
  (L2024); the float toolbar offers only 3 of the 4 nibs (L3764 vs L3271) so 7 px
  can't be re-selected; the float toolbar is positioned in world coords so it scales
  with zoom (L3754); no `releasePointerCapture` anywhere; no resize/rotate for
  strokes; no undo gesture or on-screen undo button in ink mode.

---

## Phase 1 — Data model + capture fidelity (the foundation)

Everything else depends on richer points, so this lands first.

**1a. Point format v2.** `points: {x, y, p?}[]` → serialize as a flat
`pts: number[]` triple array `[x, y, p, x, y, p, …]`, coordinates rounded to 2
decimals, pressure to 3. Add `v: 2` to the block. `migrateBlock` (L102-112 feeds it)
up-converts v1 `{x,y}` objects on read — old canvases keep working, and re-save
writes v2. Expected: **~60-70 % smaller** stroke JSON before any simplification.

**1b. Coalesced + predicted capture.** In the ink pointermove branch:
`e.nativeEvent.getCoalescedEvents?.() ?? [e]` for the real samples,
`getPredictedEvents?.()` appended to the *preview only* (never committed) to shave
perceived latency. Record `e.pressure` per sample (Safari reports real Pencil
pressure; mouse reports 0.5 — treat 0/0.5-constant as "no pressure").

**1c. Live stroke off React.** Replace `inkPreview` state with a dedicated
`<canvas>` overlay inside `.canvas-ink-layer`, drawn imperatively in a rAF loop
from `inkActive.current` — incremental (draw only the new segment), no reconcile.
On pointerup, commit to the SVG layer exactly as today. React renders nothing per
pointermove.

**1d. Commit-time simplification.** Ramer-Douglas-Peucker with ε ≈ 0.4 / zoom on
the committed points (preview keeps every sample). Typical handwriting keeps its
shape at 30-50 % of the points.

**1e. Palm-first fix.** Drop the `isPrimary` gate for pens: route on
`pointerType === "pen"` and track the active pen `pointerId` explicitly; ignore
touches while a pen is within `pointerover` range. Add `releasePointerCapture` on
up/cancel.

*Files: CanvasEditor.tsx (types L21-73, factories L177-206, capture L2054-2250,
commit L2391-2402, render L3573-3605). No new deps.*

## Phase 2 — Pressure rendering: the pen becomes a pen

**2a. Variable-width strokes** via `perfect-freehand` (~3 kB, zero deps — the
library behind tldraw/Excalidraw). It turns `[x,y,p]` samples into a closed filled
outline polygon: real tapering, pressure response, clean joins. Rendered as one
`<path fill>` instead of today's stroked polyline — drop-in for the existing SVG
layer and the `inkPathCache` memo (key on points identity, as now).

**2b. Nib profiles.** Pen = pressure-tapered (perfect-freehand `thinning: 0.6`);
fallback for pressureless input = simulated-pressure mode (speed-based, built into
the library). Keep the stored points renderer-agnostic — the outline is computed at
render time, never persisted.

**2c. Hit-testing stays on the polyline.** Selection/eraser math uses the raw
points + width, not the outline polygon.

*Files: CanvasEditor.tsx render + cache (L2894-2905, L3573-3605), package.json.
Risk: visual change to existing strokes (v1 points have no pressure → they render
in uniform-width mode, i.e. unchanged).*

## Phase 3 — Core tools: eraser, highlighter, lasso, undo gestures

The parity phase — this is what "GoodNotes-class" means day-to-day.

**3a. Eraser.** New ink tool. v1 = **stroke eraser**: pen-drag sweeps a circle
(diameter ≈ 20 / zoom); any ink stroke whose polyline passes within
`width/2 + radius` of the sweep is deleted (segment-to-point distance, cheap at
this scale). One `pushUndo` per eraser *gesture*, not per stroke. v2 (same PR if
cheap, else follow-up) = **partial eraser**: split the stroke's point array at the
erased span into two strokes. Eraser only ever touches `ink_stroke` blocks.

**3b. Highlighter.** Second nib: `opacity: 0.4`, `mix-blend-mode: multiply`,
wide nibs (8/14/20), square caps, and **snap-to-straight** when the stroke's
bounding box is flatter than 1:8 (the Notability trick that makes highlighting
text feel effortless). Stored as `ink_stroke` with `nib: "highlighter"` — one new
optional field, still v2 points.

**3c. Lasso in ink mode.** Third tool: freehand lasso (drawn dashed), selects
strokes by testing their *points* against the lasso polygon (point-in-polygon —
not the AABB the build-mode lasso uses, L2403-2420). Selected set gets the
existing move path plus **scale**: a single corner handle on the selection bbox
scales points about the bbox origin (uniform, no rotation in v1).

**3d. Undo ergonomics.** Two-finger *tap* = undo, three-finger tap = redo
(tap = touchstart→touchend < 250 ms, < 8 px movement — disambiguated from pinch by
the movement threshold; pinch handlers L2476-2519 already own two-finger *drag*).
Plus visible ↶ ↷ buttons in the ink toolbar. Fix `updateBlock` recolor/re-width to
snapshot first (L2024, L3760, L3766).

*Files: CanvasEditor.tsx tools + gestures, App.css. No new deps.*

## Phase 4 — Toolbar UX: options, memory, reach

**4a. Ink toolbar redesign.** One compact tool row: Pen · Highlighter · Eraser ·
Lasso · ↶ ↷ · ⨉. Tap the *active* tool again → popover with nib sizes and the
color grid (the GoodNotes pattern; replaces today's always-open 14-button strip).
All 4 nibs everywhere (fixes the missing 7 px in the float toolbar, L3764).

**4b. Per-tool memory.** Each tool remembers its own color + nib
(`localStorage: vault.ink.prefs`). Switching pen→highlighter→pen restores exactly
what you had. Custom color: a 12-swatch grid + recent-colors row (last 6 picked via
a native `<input type="color">`).

**4c. Float toolbar in screen space.** Position the selected-stroke toolbar via
`world → screen` conversion (`x * zoom + vp.x`) in a fixed-size layer so it stops
scaling with zoom (L3754). Same fix for the selection bbox handles from 3c.

**4d. Pencil hover preview** *(progressive enhancement)*: on hardware that reports
hover (M2+ iPads, Safari 16.4+ fires pointermove with `buttons === 0` for a hovering
Pencil), show a nib-sized ghost dot at the tip position. Feature-detected; no-op
elsewhere.

*Files: CanvasEditor.tsx toolbar JSX (L3230-3350, L3754-3773), App.css.*

## Phase 5 — Shape assist + save hygiene

**5a. Draw-and-hold shape snap** (the Apple Notes gesture): if the pen stays
within 4 px for 600 ms at the end of a stroke *without lifting*, run the
recognizer on the buffered points — line / rectangle / ellipse / arrow / triangle
by closure + corner-count heuristics — and morph the live preview into the ideal
shape. Lift = commit as the corresponding existing block type (`draw_ellipse`,
`draw_polygon`, `draw_arrow`); keep drawing = cancel the snap. This reuses the
shape blocks that already exist instead of inventing new ones.

**5b. Save hygiene.** The canvas already double-debounces (300 ms component +
400 ms EditorPane) but has no in-flight guard: add save coalescing in EditorPane
(skip if a save is in flight, re-fire after) and a soft size telemetry log when a
canvas JSON exceeds 500 kB — early warning for the next save-incident class of
problem. With v2 points + RDP this should be rare.

*Files: CanvasEditor.tsx, EditorPane.tsx (L215-226).*

---

## Sequencing & effort

| PR | Phase | Ships user-visible | Size |
|----|-------|--------------------|------|
| 1 | Data model, coalesced capture, canvas preview, RDP, palm fix | Smoother, lower-latency strokes | M-L |
| 2 | perfect-freehand pressure rendering | Ink that tapers like ink | M |
| 3 | Eraser, highlighter, lasso, undo gestures | The tool set | L |
| 4 | Toolbar redesign, per-tool memory, hover | The polish | M |
| 5 | Shape snap, save hygiene | The delight | M |

Phases 1→2 are strictly ordered (2 needs pressure in the points). 3, 4, 5 can
reorder if priorities shift, but 3 before 4 avoids designing a toolbar around
tools that don't exist yet.

## Verification (every phase)

1. **Browser harness** (established pattern from the ink-mode work): serve the
   built bundle locally, drive synthetic `PointerEvent`s with `pointerType: "pen"`
   and scripted `pressure`/coalesced batches, stub `setPointerCapture`, wait out
   the 300+400 ms debounces before asserting on committed JSON. New assertions per
   phase: point-count reduction (1d), outline path present (2a), stroke count
   after eraser sweep (3a), localStorage round-trip (4b).
2. **On-device iPad**: the harness cannot measure feel. Each merged phase gets a
   hard-refresh check on the PWA before starting the next.
3. **Regression pins**: v1 canvases render unchanged (migration test with a saved
   pre-v2 JSON fixture); two-finger pinch still pans/zooms; single-finger still
   inert in ink mode; delete confirmation flow untouched.

## Risks & decisions taken

- **`perfect-freehand` is the one new dependency.** Tiny, MIT, battle-tested in
  tldraw/Excalidraw. Writing our own variable-width outline math is the classic
  trap — don't.
- **Point format v2 is a real migration.** Guarded by `migrateBlock`, which is the
  existing seam for exactly this; parse failures already fail soft (L102-112).
  Re-save upgrades lazily — no bulk migration job needed.
- **Two-finger tap vs pinch**: disambiguation by movement/time threshold. If it
  misfires in practice, fall back to buttons-only undo (the gesture is sugar).
- **Partial eraser** is the only genuinely fiddly algorithm (stroke splitting +
  width-aware distance). It's staged as the last step of Phase 3 so a cut there
  doesn't block the rest.
- **Not doing**: layers, infinite-canvas paper templates, audio-synced notes
  (Notability's moat, out of scope), Scribble handwriting-to-text (OS-level,
  unavailable in WKWebView), stroke rotation (scale-only in v1).
