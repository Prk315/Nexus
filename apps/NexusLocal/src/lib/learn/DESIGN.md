# Learn — UI design spec

*Written by the Opus design agent before any UI slice builds. Binding for
`PathPanel.tsx`, `Player.tsx`, `ReviewPanel.tsx`, `Markdown.tsx` and `index.tsx`.
Read `LEARN_PLAN.md` first; this file answers "what does it look like", not
"what does it do".*

---

## 0. The committed direction — **The Prism Spine**

One idea, carried everywhere:

> **Colour means "which way of seeing", and the indigo→fuchsia gradient means
> "progress you earned". Nothing else gets colour.**

The three perspectives *are* the palette. Matrix takes the app's indigo, column
takes the app's fuchsia — so the Nexus Local signature gradient
`from-indigo-500 to-fuchsia-600` literally reads **matrix → column**, and a
`translate` drill is drawn as a gradient bar from its source lens colour to its
target lens colour. Row extends one notch further around the wheel into cyan.
The lens system stops being a tag and becomes the visual language of the app.

Everything else is near-monochrome ink on `#0a0a0f`. The course spine on the path
is a grey hairline that **fills with the gradient as you master units** — the
gradient physically climbs the 28-unit course. That single climbing line is the
motif the graduation ceremony pays off.

Consequences, stated as rules:

1. Never use indigo or fuchsia as decoration. If it is gradient, it is progress
   or it is a lens.
2. Never introduce a fourth hue for a *concept*. New hues only for **feedback**
   (emerald right / red wrong) and **warning** (amber = draft content).
3. Status is expressed by *fill and weight*, not by hue. Locked→mastered is a
   ramp from 8 % white to full gradient.

### Language rule (cross-agent, pinned)

App chrome is **English**, like the rest of Nexus Local: `Theory · Practice ·
Test`, `Check`, `Hint`, `Show solution`, `Continue`, `MASTERED`, `Start review`.
Content from `lr_unit_content` is **Danish** and rendered verbatim.

Three Danish strings are pinned by `LEARN_PLAN.md` and stay Danish because they
are the product's own vocabulary — plus the lens names, which are the course's:

| Danish string | Where |
|---|---|
| `Øv alligevel` | practice-anyway override on a locked path node |
| `Ingen dom endnu` | `lr_learn_state` missing (ReviewPanel) |
| `KLADDE` | draft-content badge |
| `Rækkebilledet` / `Matrixformen` / `Søjlebilledet` | lens names (short: `Række` / `Matrix` / `Søjle`) |

---

## 1. Design tokens

### 1.1 The Tailwind gotcha that decides the shape of this file

Tailwind v4 JIT scans **literal strings**. `text-${lens}-300` produces no CSS and
you get invisible text with no error. Every token below is therefore a **complete
class string in a lookup map**, never assembled. Lift these verbatim.

```ts
// tokens.ts material — copy into whichever file needs it; do not build class
// names by interpolation.
export type Lens = "row" | "matrix" | "column";

export const LENS = {
  row: {
    label: "Række",
    long: "Rækkebilledet",
    hex: "#22d3ee",                                        // cyan-400
    chip: "bg-cyan-500/12 text-cyan-300 ring-1 ring-cyan-400/25",
    chipOn: "bg-cyan-500/25 text-cyan-200 ring-1 ring-cyan-400/50",
    dot: "bg-cyan-400",
    edge: "border-l-2 border-cyan-400/50",                 // fold-out left rail
    tint: "bg-cyan-500/[0.06]",
    glow: "shadow-[0_0_0_1px_rgba(34,211,238,0.25),0_0_18px_-4px_rgba(34,211,238,0.45)]",
    from: "from-cyan-400",  to: "to-cyan-400",             // translate framing
  },
  matrix: {
    label: "Matrix",
    long: "Matrixformen",
    hex: "#818cf8",                                        // indigo-400
    chip: "bg-indigo-500/12 text-indigo-300 ring-1 ring-indigo-400/25",
    chipOn: "bg-indigo-500/25 text-indigo-200 ring-1 ring-indigo-400/50",
    dot: "bg-indigo-400",
    edge: "border-l-2 border-indigo-400/50",
    tint: "bg-indigo-500/[0.06]",
    glow: "shadow-[0_0_0_1px_rgba(129,140,248,0.25),0_0_18px_-4px_rgba(129,140,248,0.45)]",
    from: "from-indigo-400", to: "to-indigo-400",
  },
  column: {
    label: "Søjle",
    long: "Søjlebilledet",
    hex: "#e879f9",                                        // fuchsia-400
    chip: "bg-fuchsia-500/12 text-fuchsia-300 ring-1 ring-fuchsia-400/25",
    chipOn: "bg-fuchsia-500/25 text-fuchsia-200 ring-1 ring-fuchsia-400/50",
    dot: "bg-fuchsia-400",
    edge: "border-l-2 border-fuchsia-400/50",
    tint: "bg-fuchsia-500/[0.06]",
    glow: "shadow-[0_0_0_1px_rgba(232,121,249,0.25),0_0_18px_-4px_rgba(232,121,249,0.45)]",
    from: "from-fuchsia-400", to: "to-fuchsia-400",
  },
} as const;
```

A `null` / unknown perspective renders **no chip at all** — never a grey
"unknown" chip. Absence is quieter than a placeholder.

**Chip recipe** (identical geometry everywhere — perspective chip on a theory
card, lens tag on a drill, lens dot in the graduation stat line):

```html
<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5
             text-[10px] font-medium tracking-wide {LENS[l].chip}">
  <span class="w-1 h-1 rounded-full {LENS[l].dot}"></span>Række
</span>
```

**Translate framing** — the one place two lenses appear at once. A `translate`
drill card gets a 2 px gradient top edge running source → target, and the header
reads `Række → Søjle`:

```html
<div class="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
  <div class="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-cyan-400 to-fuchsia-400"></div>
  …
</div>
```

Only three ordered pairs occur in practice, so ship a literal map
`TRANSLATE_BAR[`${from}-${to}`]` of the six `from-…  to-…` combinations rather
than composing them.

### 1.2 Status tokens

Fill and weight, not hue. `mastered` is the only state that gets the gradient.

```ts
export const STATUS = {
  locked: {
    node: "bg-white/[0.04] ring-1 ring-white/10",
    text: "text-white/25",
    glyph: "◇",
  },
  available: {
    node: "bg-white/[0.06] ring-1 ring-indigo-400/40 shadow-[0_0_20px_-6px_rgba(99,102,241,0.7)]",
    text: "text-white/80",
    glyph: "◆",
  },
  in_progress: {
    node: "bg-white/[0.06] ring-1 ring-white/15",   // ring drawn separately as SVG arc
    text: "text-white",
    glyph: "◆",
  },
  mastered: {
    node: "bg-gradient-to-br from-indigo-500 to-fuchsia-600 ring-1 ring-white/20 shadow-[0_0_22px_-6px_rgba(217,70,239,0.8)]",
    text: "text-white/90",
    glyph: "✓",
  },
  no_content: {          // unit row exists, lr_unit_content has no row at all
    node: "bg-transparent ring-1 ring-dashed ring-white/10",
    text: "text-white/20",
    glyph: "·",
  },
} as const;

export const FEEDBACK = {
  correct: "bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-400/30",
  wrong:   "bg-red-500/12 text-red-300 ring-1 ring-red-400/30",
  draft:   "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/25",
} as const;
```

Reserved-hue table — do not cross these wires:

| Hue | Means | Never means |
|---|---|---|
| cyan / indigo / fuchsia | a lens, or (gradient) earned progress | success, decoration |
| emerald | this answer was correct | "unit done", "online", "nothing due" |
| red | this answer was wrong | danger, delete |
| amber | **content is a draft** (`status ≠ live`) | in-progress, warning-in-general |

### 1.3 Draft badge — sized for the reality of the data

Every unit in the DB is `status: "draft"` today. A full-width amber banner per
unit would make the whole app look broken. So:

- **Path node:** a 5 px amber dot at the node's top-right corner, nothing else.
  `absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-amber-300`
- **Player top bar:** one chip, `KLADDE`, next to the title:
  `px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-[0.12em] {FEEDBACK.draft}`
- **Approved (not yet live):** no badge. Only `draft` is badged.

### 1.4 Type, spacing, surfaces

Matches the existing panels — do not invent a second scale.

| Role | Classes |
|---|---|
| Panel heading | `text-xs uppercase tracking-wide text-white/40` |
| Card title | `text-[15px] font-semibold text-white/90 leading-snug` |
| Body / content prose | `text-[15px] leading-relaxed text-white/75` |
| Secondary | `text-xs text-white/45` |
| Micro / meta | `text-[10px] uppercase tracking-wide text-white/35` |
| Numerals | `font-mono tabular-nums` |
| Card surface | `rounded-xl border border-white/10 bg-white/[0.03] p-3` |
| Recessed surface | `rounded-lg bg-white/[0.02] ring-1 ring-white/[0.06] p-2.5` |
| Primary button | `w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3 text-[15px] font-semibold text-white active:scale-[0.985] transition-transform` |
| Secondary button | `rounded-lg bg-white/[0.06] px-3 py-2 text-[13px] text-white/70 active:bg-white/[0.10]` |
| Ghost/text button | `text-[12px] text-white/35 underline decoration-white/15 underline-offset-4 active:text-white/70` |

**Phone floor:** every tappable element is ≥ 44 px tall. `text-[10px]` is
label-only — never a tap target on its own.

Panels sit in `App.tsx`'s `p-6 flex-col gap-5` column, so each is
`<section className="flex flex-col gap-2">` exactly like the timetracker panels.

### 1.5 KaTeX at phone width — the four rules

The real content contains `\begin{pmatrix}` blocks 6 columns wide and
`\begin{array}{rcrcrcr}` systems. At 360 px they *will* overflow. `Markdown.tsx`
owns this:

1. **Display math scrolls, the page never does.** Wrap every `.katex-display` in
   a scroller that bleeds to the card edge so the scroll gesture is discoverable:
   `-mx-3 px-3 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]{display:none}`.
   Implement by styling `.katex-display` directly in the injected stylesheet
   (`overflow-x:auto; overflow-y:hidden; padding:2px 0; margin:0.55em 0`).
2. **Bump the base size.** KaTeX defaults to 1.21× which is too big inline and
   too small for a matrix. Pin `.katex{font-size:1.03em}` and
   `.katex-display>.katex{font-size:1.12em}`.
3. **Never let math wrap mid-token:** inline math gets `white-space: nowrap`.
4. **Bold from markdown must not leak into math.** Content mixes `**…**` and
   `$…$` in the same paragraph; `rehype-katex` output must not inherit
   `font-weight` — set `.katex{font-weight:400}`.

Long horizontal math gets a right-edge affordance instead of a scrollbar: a
6 px fade `after:` overlay only while `scrollWidth > clientWidth` is impractical
in pure CSS, so accept the bleed-to-edge cue and move on.

---

## 2. `PathPanel.tsx` — the spine

### 2.1 Shape

Single narrow column. A vertical rail at a fixed **x = 14 px** from the panel's
left edge; nodes centred on it; content to the right of the rail. 28 units in 7
chapters (`LA 0`…`LA 6`, derived from the `code` prefix — `lr_unit.title` is
**empty in the DB**, so the label is `content.title || code`).

```
┌────────────────────────────────────────────┐
│ LEARN · LINEÆR ALGEBRA          ⟳          │  header
│  ╭──╮                                       │
│  │ 7│  7 / 28 mastered · LA 2               │  ring 56px + summary
│  ╰──╯                                       │
├────────────────────────────────────────────┤
│  LA 1  ▁▁▁▁▁▁▁▂▂▂▂  2/2                    │  chapter header + 2px bar
│    ●───  Gauss-elimination, RREF og rang   │  mastered  (gradient node)
│    │      8 bokse · 14 øvelser · 95 min    │
│    ●───  Matrixregning                     │
│    ┊                                        │
│  LA 2  ▁▁▁▁▁▁▁▁▁▁  0/6                     │
│    ◆───  Vektorrum og underrum         ›   │  available (indigo halo)
│    ◇      Lineær uafhængighed              │  locked
│    ◇      …                                 │
└────────────────────────────────────────────┘
```

### 2.2 The rail, and the thing that makes it feel alive

Two absolutely-positioned rails inside a `relative` list container:

```html
<!-- track -->
<div class="pointer-events-none absolute left-[14px] top-2 bottom-2 w-px bg-white/[0.08]"></div>
<!-- earned fill: height = masteredThroughRatio * 100% -->
<div class="pointer-events-none absolute left-[14px] top-2 w-px rounded-full
            bg-gradient-to-b from-indigo-500 to-fuchsia-500
            shadow-[0_0_10px_0_rgba(168,85,247,0.55)]
            transition-[height] duration-700 ease-[cubic-bezier(.16,1,.3,1)]"
     style="height: 32%"></div>
```

`height` is the fraction of the list's pixel height up to and including the last
mastered node. When the Player closes after a graduation, this animates upward —
that 700 ms climb is the visual receipt for the ceremony. Measure with a
`ref` on the last mastered row (`offsetTop + offsetHeight/2`) so the fill ends
*at the node centre*, not at the row edge.

### 2.3 Node

28 px disc, `z-10`, centred on the rail (`ml-[14px] -translate-x-1/2`).

| Status | Node |
|---|---|
| `mastered` | `STATUS.mastered.node` + `✓` in `text-[13px] text-white` |
| `in_progress` | 28 px SVG ring, 3 px stroke, `stroke="url(#learnGrad)"`, `strokeDasharray` from drills-solved ratio, `rotate(-90)`, plus a 6 px core dot `bg-white animate-[learn-pulse_2.4s_ease-in-out_infinite]` (copy the `Ring` recipe from `PomodoroPanel.tsx`; define the `<linearGradient id="learnGrad">` once in a hidden `<svg>` at the top of the panel) |
| `available` | `STATUS.available.node`, hollow, `◆` in `text-white/70` |
| `locked` | `STATUS.locked.node`, `◇` in `text-white/20` |
| `no_content` | dashed ring, `·`, row text `text-white/20`, not tappable |

Draft dot per §1.3 sits on the node.

### 2.4 Row

```html
<button class="group flex w-full items-start gap-3 rounded-xl px-1 py-2 text-left
               active:bg-white/[0.03] transition-colors">
  <span class="{node classes} relative z-10 grid h-7 w-7 shrink-0 place-items-center
               rounded-full text-[12px]">…</span>
  <span class="min-w-0 flex-1 pt-0.5">
    <span class="block truncate text-[14px] font-medium {STATUS[s].text}">Gauss-elimination, RREF og rang</span>
    <span class="mt-0.5 block text-[10px] text-white/30">LA 1 · U1 · 8 bokse · 14 øvelser · 95 min</span>
  </span>
  <span class="pt-1 text-white/20 group-active:text-white/50">›</span>
</button>
```

The meta line is the counts pulled from the content JSON (`theory.length`,
Σ`drills`, `est_minutes`). It is the cheapest possible "this is substantial"
signal and costs no extra request — `fetchPath()` already knows which units have
content.

### 2.5 Chapter grouping

Not a heavy header — a **rail interruption**. The chapter label sits *on* the
rail line, so the spine reads as one continuous object:

```html
<div class="relative flex items-center gap-2 pl-[14px] pt-4 pb-1">
  <span class="-ml-[14px] w-7 shrink-0 text-center text-[10px] font-semibold
               tracking-wider text-white/30 bg-[#0a0a0f]">LA 2</span>
  <span class="h-[2px] flex-1 rounded-full bg-white/[0.06] overflow-hidden">
    <span class="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500
                 transition-[width] duration-500" style="width:33%"></span>
  </span>
  <span class="text-[10px] tabular-nums text-white/25">2/6</span>
</div>
```

The `bg-[#0a0a0f]` on the label is what punches the rail out behind it.

### 2.6 Header ring

56 px SVG, 5 px stroke, gradient stroke via the shared `learnGrad` def, showing
`mastered / total`. Centre holds the mastered count in `font-mono text-lg
font-semibold`. To its right: `7 / 28 mastered` (`text-xs text-white/45`) and
the current chapter (`text-[10px] uppercase tracking-wide text-white/30`).

### 2.7 `Øv alligevel` — the override, without the clutter

Do **not** put a button on 20 locked rows. The override is a *second tap*:

1. Tapping a locked row does not open the Player. It expands that row in place
   (grid-rows fold, §5) revealing a single line:

```html
<div class="ml-10 mt-1 flex items-center gap-3 text-[11px]">
  <span class="text-white/25">Låst — mestr LA 1 · U2 først.</span>
  <button class="ml-auto shrink-0 rounded-lg px-2 py-1 text-[11px] text-white/40
                 ring-1 ring-white/10 active:bg-white/[0.06] active:text-white/80">
    Øv alligevel →
  </button>
</div>
```

2. Only one locked row is expanded at a time (`useState<number|null>`).
3. A `no_content` row does not expand — there is nothing to open.
4. Once opened this way, the unit gets `in_progress` progress like any other, so
   it stops being locked and the affordance disappears on its own.

Zero pixels when unused; one tap away when wanted. That is the whole design.

---

## 3. `Player.tsx` — the overlay

### 3.1 Frame

```html
<div class="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]/97 backdrop-blur-xl
            animate-[learn-overlay_.22s_ease-out]">
  <header class="shrink-0 border-b border-white/[0.06] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">…</header>
  <main  class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-40">…</main>
  <footer class="pointer-events-none absolute inset-x-0 bottom-0
                 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/95 to-transparent
                 px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
    <div class="pointer-events-auto flex flex-col gap-2">…</div>
  </footer>
</div>
```

- `pb-40` on `<main>` clears the dock. Non-negotiable — content hidden behind the
  dock is the classic phone bug.
- The dock is a **scrim, not a bar**: no border, no solid fill. Content dissolves
  into the page bottom under the primary button.
- Close `✕` is **top-left** (`w-9 h-9 grid place-items-center rounded-lg
  text-white/40 active:bg-white/[0.06]`) — deliberately out of thumb range so it
  is never hit by accident mid-drill. Primary actions are bottom-dock only.

### 3.2 Header + stepper

Row 1: `✕` · title (`truncate text-[13px] font-medium text-white/85`) · `KLADDE`
chip if draft.

Row 2: the stepper — three equal segments, each a 3 px bar with a label under it.
The **bar fills with the gradient as that step is completed**, so the header is a
miniature of the spine.

```html
<div class="mt-2 flex gap-1.5">
  <!-- ×3 -->
  <button class="group flex-1 text-left" disabled={!reachable}>
    <span class="block h-[3px] w-full overflow-hidden rounded-full bg-white/[0.07]">
      <span class="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500
                   transition-[width] duration-500 ease-out" style="width:100%"></span>
    </span>
    <span class="mt-1 block text-[10px] tracking-wide
                 {active ? 'text-white/80' : reachable ? 'text-white/35' : 'text-white/15'}">
      Theory
    </span>
  </button>
</div>
```

`Test` stays `text-white/15` and non-tappable until `unlock_ratio` is met, and
carries a `🔒`-free lock cue: the segment bar renders `bg-white/[0.04]` with a
`ring-1 ring-dashed ring-white/10`.

### 3.3 Theory step

`intro_md` first, in a card with a 2 px gradient left rail — the "why you are
here" block:

```html
<div class="rounded-xl border border-white/10 bg-white/[0.03] p-3
            border-l-2 border-l-transparent
            [border-image:linear-gradient(to_bottom,#6366f1,#d946ef)_1]">
```

(if `border-image` fights the rounded corner, use an absolutely-positioned
`w-[2px] inset-y-0 left-0 bg-gradient-to-b from-indigo-500 to-fuchsia-600` inside
a `relative overflow-hidden` card — preferred, simpler.)

Then `lens_note_md` in its own card headed `The three perspectives` with all
three lens chips in a row — this is the unit's thesis statement and deserves
weight: `text-[13px]`, tinted `bg-white/[0.02]`, chips at the top.

Then one card per `theory[]` box (8 in a real unit):

```
┌───────────────────────────────────────────┐
│ DEFINITION            ● Matrix            │   kind (micro) + lens chip
│ Definition 1.2.7 — matrix, koefficient…   │   card title
│                                            │
│ En m × n-matrix er et rektangulært skema  │   statement_md (Markdown+KaTeX)
│ ┌ scrollable display math ──────────────→ │
│                                            │
│ [ Se i rækkebilledet ] [ …søjlebilledet ] │   translation fold-out triggers
│ ↳ Totalmatricen er den ene genstand …     │   connect_md, quiet
└───────────────────────────────────────────┘
```

- `kind` is a micro-label, not a chip: `text-[10px] uppercase tracking-[0.14em]
  text-white/30` — `DEFINITION` / `SÆTNING` / `BEMÆRKNING`. It is typographic,
  the lens chip is chromatic; they never compete.
- **Translation fold-outs.** One trigger per key in `translations` (the data has
  1–2 per box). Trigger = the lens chip in its `chipOn`-on-press form, full
  width-auto, ≥ 32 px tall:

```html
<button class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px]
               {open ? LENS[l].chipOn : LENS[l].chip} transition-colors">
  <span class="w-1 h-1 rounded-full {LENS[l].dot}"></span>
  Se i {LENS[l].long.toLowerCase()}
  <span class="ml-0.5 transition-transform duration-200 {open && 'rotate-90'}">›</span>
</button>
```

  The revealed panel uses the grid fold (§5) and carries the lens as a left rail
  plus a 6 % tint — so a re-reading is unmistakably *in that lens*:

```html
<div class="grid transition-[grid-template-rows] duration-200 ease-out
            {open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}">
  <div class="overflow-hidden">
    <div class="mt-2 rounded-r-lg py-2 pl-3 pr-2 {LENS[l].edge} {LENS[l].tint}">…md…</div>
  </div>
</div>
```

- `connect_md` closes the card: `mt-2 text-[12px] italic leading-relaxed
  text-white/40` prefixed by a `↳` in `text-white/20`.

Dock: `Practice →` (primary, full width). Secondary line above it, centred:
`8 boxes · 3 perspectives` in `text-[10px] text-white/25`.

### 3.4 Practice step — master demo

Real demos have **8 steps** with `{what, why, how}`. Dumping 8×3 blocks at once
is a wall. Progressive reveal, one step per tap, is the entire point.

Numbered rail identical in geometry to the path spine (rhyme, not repetition):
a 1 px track at x = 11 px with a gradient fill to the last revealed step.

Per step:

```html
<li class="relative pl-8 pb-4">
  <span class="absolute left-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full
               text-[10px] font-mono
               {isLatest ? 'bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white'
                         : 'bg-white/[0.06] text-white/40 ring-1 ring-white/10'}">3</span>

  <p class="text-[14px] font-medium leading-snug
            {isLatest ? 'text-white/90' : 'text-white/55'}">{what}</p>

  <p class="mt-1 text-[12px] leading-relaxed text-white/40">{why}</p>

  <div class="mt-2 rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] px-2.5 py-2
              text-[14px] text-white/80">{how — Markdown/KaTeX}</div>
</li>
```

- **Dim-the-past** is the mechanic: revealed steps fall to `text-white/55`, the
  newest is at `/90`. The eye always lands on the new move.
- `how` is the only place that gets a recessed panel — it is the *execution*, and
  it is where the matrices live (so it inherits the display-math scroller).
- Newly revealed step animates `learn-step-in` (§5) and is scrolled into view
  with `el.scrollIntoView({ block: "center", behavior: "smooth" })`.
- Dock: `Next step (3/8)` primary; ghost `Skip to drills` on the line above.
  At the last step the primary becomes `Start drills →`.

### 3.5 Drill card anatomy

One drill at a time, full attention. Above the card: `Drill 4 / 14` +
archetype label + a 3-dot difficulty meter.

```
┌───────────────────────────────────────────┐
│ ▔▔▔▔▔▔▔▔▔▔ 2px lens/translate gradient    │
│ COMPUTATIONAL   ● Matrix        ●●○       │
│                                            │
│ Løs ved Gauss-elimination:                │  prompt_md
│  x₁ + 2x₂ + x₃ = 4                        │  (display math, scrollable)
│                                            │
│ ┌───────────────────────────────────────┐ │
│ │ 1, -2, 3                              │ │  input (per answer_type)
│ └───────────────────────────────────────┘ │
│ ⟨-1, 2, 1⟩  3 entries                     │  live parse preview
└───────────────────────────────────────────┘
        ▼ hints / result / solution stack
────────────────────────────────────────────
 Hint 1/2          Show solution              ← ghost row (dock)
 [        Check                            ]  ← primary (dock)
```

**Inputs by `answer_type`** (all five occur in the real data):

| type | control |
|---|---|
| `numeric` | `inputMode="decimal"`, mono, `placeholder="7  ·  3/4  ·  -1.5"` |
| `vector` | single line, `placeholder="1, -2, 3"`, live preview `⟨…⟩` + entry count |
| `matrix` | `<textarea rows={3}>` mono, `placeholder="1 0 2; 0 1 -1"`, preview shows detected `m × n` |
| `choice` | stacked option buttons; **2 options renders as two side-by-side halves** (true/false — 4 of 14 drills), 3+ stacks full width |
| `text` | `<textarea rows={2}>`, self-graded — the Check button reads `Show solution` and there is no right/wrong banner, only the grade bar (6 of 14 drills are `text`; this path must feel first-class, not a fallback) |

Input shell:

```html
<input class="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3
              font-mono text-[16px] text-white/90 placeholder:text-white/20
              outline-none focus:border-indigo-400/50
              focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] transition-shadow" />
```

`text-[16px]` on inputs is load-bearing: anything smaller makes iOS Safari zoom
the viewport on focus and the overlay layout jumps.

Choice option (unanswered → answered):

```html
<button class="w-full rounded-xl border px-3 py-3 text-left text-[14px] transition-colors
               border-white/10 bg-white/[0.03] text-white/80 active:bg-white/[0.07]
               /* answered-correct  */ border-emerald-400/40 bg-emerald-500/10
               /* answered-wrong    */ border-red-400/40 bg-red-500/10
               /* answered-other    */ border-white/[0.06] bg-transparent text-white/35">
```

**Hints** — 2 per drill, sequential, never both at once. Rendered as fold-outs
below the input with the *drill's own lens colour* as the left rail (a hint is a
nudge inside that perspective):

```html
<div class="mt-2 rounded-r-lg py-2 pl-3 pr-2 text-[13px] text-white/70
            {LENS[drill.lens].edge} {LENS[drill.lens].tint}
            animate-[learn-step-in_.2s_ease-out]">
  <span class="mr-2 text-[10px] uppercase tracking-wide text-white/30">Hint 1</span>…
</div>
```

Ghost button text is stateful: `Hint (1/2)` → `Hint (2/2)` → the button
disappears.

**Result banner** — appears on Check, above the dock, inside the scroll area so
it is adjacent to the answer:

```html
<div class="mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px]
            {correct ? FEEDBACK.correct : FEEDBACK.wrong}
            animate-[learn-step-in_.18s_ease-out]">
  <span class="text-[15px]">{correct ? "✓" : "✕"}</span>
  <span>{correct ? "Correct" : "Not quite"}</span>
</div>
```

A wrong answer also runs `learn-shake` on the **input**, not on the card (a
shaking card full of matrices is nauseating). Wrong never reveals the answer —
it offers the next hint (the ghost button pulses once) and, after the second
wrong attempt, promotes `Show solution` from ghost to secondary weight.

**Solution** — full `solution_md` in a card with a gradient left rail (same
material as `intro_md`; the gradient means "the earned thing"), headed
`SOLUTION` in micro-caps.

**Grade bar 0–3** — appears only after Check/solution, replaces the primary
button in the dock. Hue-free by design (§0 rule 3): one row of 4 cells over a
single gradient, opacity ramping. This reads as "how hot did this land" without
adding a fifth and sixth colour to the app.

```html
<div class="flex gap-1.5">
  <!-- g=0 -->
  <button class="flex-1 rounded-xl py-3 text-[12px] font-medium text-white/70
                 bg-white/[0.05] ring-1 ring-red-400/25 active:scale-[0.97] transition-transform">
    <span class="block text-[10px] uppercase tracking-wide text-white/30">0</span>Again
  </button>
  <!-- g=1 --> …bg-gradient-to-br from-indigo-500/25 to-fuchsia-600/25 → "Hard"
  <!-- g=2 --> …from-indigo-500/55 to-fuchsia-600/55                  → "Good"
  <!-- g=3 --> …from-indigo-500 to-fuchsia-600 text-white             → "Easy"
</div>
```

Grading advances to the next drill immediately (`learn-step-in`), no confirm.
14 drills × one tap = the session rhythm; anything more is friction.

### 3.6 Test step

**Locked state** (before `unlock_ratio`): not a grey wall — a meter that shows
how close you are, which is itself motivating.

```html
<div class="rounded-xl border border-dashed border-white/12 bg-white/[0.02] p-4 text-center">
  <div class="text-[10px] uppercase tracking-wide text-white/30">Test locked</div>
  <div class="mt-2 font-mono text-2xl tabular-nums text-white/70">8 / 10</div>
  <div class="mx-auto mt-2 h-[3px] w-40 overflow-hidden rounded-full bg-white/[0.07]">
    <span class="block h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500
                 transition-[width] duration-500" style="width:80%"></span>
  </div>
  <p class="mt-2 text-[11px] text-white/35">Solve 2 more drills to unlock.</p>
</div>
```

**Question** (5 per unit, 4 options each): one at a time. Prompt in a card,
options as full-width buttons (§3.5 choice styling). Header shows
`Question 2 / 5` and the question's lens chip.

**Rationale reveal** — this is the pedagogically expensive part of the content
(`why_md` on *every* option, correct and distractor alike) and it must all be
shown. On answer, every option expands its `why_md` beneath itself via the grid
fold, staggered 60 ms apart so the eye follows down the list:

```html
<div class="overflow-hidden">
  <p class="px-3 pb-3 pt-0 text-[12px] leading-relaxed
            {isCorrect ? 'text-emerald-300/70' : 'text-white/40'}">{why_md}</p>
</div>
```

The chosen-wrong option keeps its red border **and** shows its `why_md` in
`text-red-300/70` — the distractor rationale is the lesson.

No score shown until the end. Final card: `4 / 5` in `font-mono text-4xl` with a
gradient-clipped fill (`bg-gradient-to-r from-indigo-400 to-fuchsia-400
bg-clip-text text-transparent`), pass threshold line at 75 %.

- **Pass** → graduation (§3.7).
- **Fail** → `Not yet — 3/5. Try again after another pass through the drills.`
  in `FEEDBACK.wrong` styling, dock offers `Back to drills`. Never punitive
  copy, never a red full-screen.

### 3.7 The graduation moment

This is the payoff of 95 minutes. It replaces the whole `<main>` — no card, no
scroll, a full-bleed ceremony. Sequence over ~1.6 s, all CSS, all staggered by
inline `animationDelay`:

```
 t=0ms    overlay body clears, background gets a radial wash:
          bg-[radial-gradient(120%_80%_at_50%_35%,rgba(99,102,241,0.18),transparent_70%)]

 t=60ms   the disc: 104px, conic gradient, one 900ms rotation + scale .82→1
          <div class="h-26 w-26 rounded-full
               bg-[conic-gradient(from_0deg,#6366f1,#d946ef,#22d3ee,#6366f1)]
               animate-[learn-grad-disc_.9s_cubic-bezier(.16,1,.3,1)_both]">
            <div class="absolute inset-[3px] rounded-full bg-[#0a0a0f] grid place-items-center">
              <span class="text-3xl">✓</span>
            </div>
          </div>

 t=120ms  12 shards burst outward: absolutely positioned 2px×10px rounded bars on a
          ring, each rotate(i*30deg) translateY(-52px), animate learn-grad-burst
          .7s with animationDelay {i*18}ms. Colours cycle the three lens hexes —
          the burst is literally made of the three perspectives.

 t=380ms  "MASTERED"  text-[11px] tracking-[0.42em] font-semibold
          bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent
          then the unit title, text-lg font-semibold text-white/90

 t=520ms  stat row, learn-step-in staggered 80ms each:
            14 drills · 4/5 test · 95 min
          then the LENS PAYOFF — three dots lighting in sequence:
            ● Række  ● Matrix  ● Søjle      (dots animate to full lens colour;
          any lens the unit never exercised stays at white/12 — visible proof
          the three-perspective system was actually used)

 t=760ms  concept chips fly into the retention space: one chip per concept in the
          unit, learn-chip-rise .35s with {i*70}ms delay, under the label
          "Added to review" (text-[10px] uppercase tracking-wide text-white/30)

 dock     [ Continue → ]  primary. On tap: close overlay, and PathPanel's rail
          fill animates up one segment (§2.2). That hand-off is what makes it
          feel like it went somewhere.
```

Rules: no confetti library, no canvas, no sound. The burst is 12 divs. If
`prefers-reduced-motion` is set, the disc and shards render in their end state
and only the text fades in.

---

## 4. `ReviewPanel.tsx`

A compact section under the path, `<section className="flex flex-col gap-2">`.

### 4.1 Verdict present

```html
<div class="flex items-stretch gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
  <!-- streak -->
  <div class="flex flex-col justify-between">
    <div class="font-mono text-3xl font-semibold leading-none tabular-nums
                bg-gradient-to-br from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">12</div>
    <div class="text-[10px] uppercase tracking-wide text-white/35">day streak</div>
  </div>

  <!-- 7-day strip: today is the last dot -->
  <div class="flex items-end gap-1 self-center">
    <!-- ×7 -->
    <span class="h-2 w-2 rounded-full
                 {done ? 'bg-gradient-to-br from-indigo-400 to-fuchsia-500' : 'bg-white/[0.08]'}
                 {isToday && 'ring-2 ring-white/20 ring-offset-2 ring-offset-[#0a0a0f]'}"></span>
  </div>

  <!-- due -->
  <div class="ml-auto text-right">
    <div class="font-mono text-3xl font-semibold leading-none tabular-nums text-white/90">23</div>
    <div class="text-[10px] uppercase tracking-wide text-white/35">concepts due</div>
  </div>
</div>

<button class="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-3
               text-[15px] font-semibold text-white active:scale-[0.985] transition-transform">
  Start review · 23
</button>
```

Streak `0` renders the number in `text-white/30` with no gradient — the gradient
is earned. `due = 0` with a valid verdict → the button becomes a calm
`All caught up` in secondary weight (this is the *only* legitimate "nothing due"
state, and it requires `computed_at`).

Under the card, always: `computed 4 min ago` in `text-[10px] text-white/25`.
Provenance is what lets the next state be trusted.

### 4.2 `Ingen dom endnu` — the unknown state

**Must not look like "nothing due".** No emerald, no check, no zero. Unknown has
its own visual grammar: dashed, dim, question glyph, pulsing.

```html
<div class="flex items-center gap-3 rounded-xl border border-dashed border-white/12
            bg-white/[0.02] p-3">
  <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full
               bg-white/[0.04] text-white/30
               animate-[learn-pulse_2.6s_ease-in-out_infinite]">?</span>
  <div class="min-w-0">
    <div class="text-[13px] text-white/50">Ingen dom endnu</div>
    <p class="mt-0.5 text-[11px] leading-relaxed text-white/30">
      The server hasn’t computed a review verdict yet. This does <em class="not-italic text-white/45">not</em>
      mean nothing is due.
    </p>
  </div>
</div>
```

If a previously fetched verdict is in memory (or `localStorage`), render §4.1
**dimmed to `opacity-50`** with a `last known` chip instead of hiding it —
`blocking_state` doctrine: keep showing the last known state, label it clearly,
never fall back to zero.

The `Start review` button stays enabled in the unknown state — the client can
still drill concepts from `lr_retained_concept` locally. It just cannot claim a
count, so it reads `Start review` with no number.

---

## 5. Motion

CSS only. Keyframes live in **one `<style>` element rendered once at the top of
`Player.tsx`'s overlay** (`PathPanel` and `ReviewPanel` use only `transition-*`
and the two shared keyframes, so `Player` mounting is not a prerequisite — put
`learn-pulse` and `learn-step-in` in the same string and export it from
`Markdown.tsx` alongside the KaTeX rules, which already needs an injected
stylesheet). No CSS files, per the house rule.

```css
@keyframes learn-overlay   { from { opacity:0; transform:translateY(8px) scale(.99) } to { opacity:1; transform:none } }
@keyframes learn-step-in   { from { opacity:0; transform:translateY(6px) }            to { opacity:1; transform:none } }
@keyframes learn-chip-rise { from { opacity:0; transform:translateY(10px) scale(.9) } to { opacity:1; transform:none } }
@keyframes learn-pulse     { 0%,100% { opacity:.45 } 50% { opacity:1 } }
@keyframes learn-shake     { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
@keyframes learn-grad-disc { from { opacity:0; transform:rotate(-140deg) scale(.82) } to { opacity:1; transform:rotate(0) scale(1) } }
@keyframes learn-grad-burst{ from { opacity:0; transform:rotate(var(--a)) translateY(-14px) scaleY(.4) }
                             60%  { opacity:1 }
                             to   { opacity:0; transform:rotate(var(--a)) translateY(-64px) scaleY(1) } }

@media (prefers-reduced-motion: reduce) {
  *[class*="learn-"] { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
```

### The five transitions that carry the product

| # | Moment | Recipe | Why it matters |
|---|---|---|---|
| 1 | **Fold-out** (translations, hints, MCQ rationale) | `grid transition-[grid-template-rows] duration-200 ease-out` toggling `grid-rows-[0fr] ↔ grid-rows-[1fr]`, child `overflow-hidden` | The only way to animate auto height without JS measurement. Used ~6 places; get it right once. |
| 2 | **Step advance** (next drill, next demo step, next question) | key the content on the step id so React remounts it, `animate-[learn-step-in_.18s_ease-out]` | 6 px + fade. Anything longer than 200 ms makes a 14-drill session feel sluggish. |
| 3 | **Wrong answer** | `learn-shake .34s` on the input only | Physical "no" that doesn't move the math. |
| 4 | **Graduation** | §3.7, ~1.6 s staggered | The one place slow is correct. |
| 5 | **Rail fill** | `transition-[height] duration-700 ease-[cubic-bezier(.16,1,.3,1)]` | The gradient climbing the spine after a graduation. This is the app's signature move — do not shorten it. |

Everything else uses `transition-colors duration-150` or nothing. Never animate
`box-shadow` on a list of 28 nodes; never animate `filter`/`backdrop-filter` on
the overlay after mount (the iOS WebView drops frames badly).

`active:scale-[0.985]` on primary buttons, `active:` not `hover:` throughout —
this is a touch surface first; hover states that light up under a Mac cursor are
fine as an extra, but no affordance may depend on hover.

---

## 6. Checklist for the implementing agents

- [ ] No class name is built by string interpolation (§1.1).
- [ ] `<main>` has bottom padding ≥ `pb-40` so the dock never covers content.
- [ ] Every input is `text-[16px]` (no iOS focus zoom).
- [ ] Display math is inside a horizontal scroller; the page body never scrolls sideways.
- [ ] Every tap target ≥ 44 px.
- [ ] `pb-[max(1rem,env(safe-area-inset-bottom))]` on the dock, `pt-[max(.75rem,env(safe-area-inset-top))]` on the header.
- [ ] Missing `lr_learn_state` renders §4.2, never a zero.
- [ ] Draft content is one chip and one dot — not a banner (§1.3).
- [ ] Unit label falls back to `code` (`lr_unit.title` is empty in the DB today).
- [ ] `text` drills are self-graded and get no right/wrong banner — 6 of 14 drills take this path.

---

## 7. Soft-white theme (v2) — 2026-08-07

Learn became its own page (`App.tsx` grew a lightweight `"node" | "learn"`
page switcher — two tab buttons under the shared header, no router lib) and
moved off the dark `#0a0a0f` "Prism Spine" palette above onto a soft-white
"paper" surface. **Everything in §0–§6 above still describes the shape,
motion and lens/status *logic* correctly — the hue and opacity recipes in
§1.1–§1.4 are superseded for the Learn surface.** The node dashboard
(`App.tsx`'s "Node" tab: status fields, modules, TimeTracker panels,
KeychainDebug, BleScan) is unaffected and stays on the original dark tokens.

Why: Learn is meant to feel like *paper and ink* — a study surface, closer to
Brilliant/a printed textbook than a dark control panel. The indigo→fuchsia
"earned progress" identity and the three lens hues carry over unchanged in
*meaning*; only their concrete Tailwind classes change so they read on white
instead of on `#0a0a0f`.

### 7.1 Paper / ink / surfaces

| Role | v1 (dark) | v2 (soft-white) |
|---|---|---|
| Page background | `#0a0a0f` | `#F6F5F1` ("paper") — painted by `LearnPage` in `index.tsx`, full-bleed via `-mx-6 -mb-6 flex-1` inside `App.tsx`'s padded column |
| Card surface | `border-white/10 bg-white/[0.03]` | `border border-black/[0.06] bg-white shadow-[0_1px_8px_rgba(0,0,0,0.05)]` |
| Recessed/inset surface | `bg-white/[0.02] ring-1 ring-white/[0.06]` | `bg-black/[0.02–0.03] ring-1 ring-black/[0.06]` |
| Hairline / divider | `border-white/[0.06]` | `border-black/[0.08]` |
| Rail / track (unfilled) | `bg-white/[0.08]` | `bg-black/[0.08]` |
| Dashed outline (locked, test-locked meter) | `ring-white/10` / `border-white/12` dashed | `ring-black/10` / `border-black/[0.12]` dashed |
| Ghost hover fill | `active:bg-white/[0.06]` | `active:bg-black/[0.04–0.05]` |
| Overlay backdrop (`Player.tsx`) | `bg-[#0a0a0f]/97` | `bg-[#F6F5F1]/97` |
| Dock scrim (footer gradient) | `from-[#0a0a0f] via-[#0a0a0f]/95 to-transparent` | `from-[#F6F5F1] via-[#F6F5F1]/95 to-transparent` |
| Chapter-label "punch" bg | `bg-[#0a0a0f]` | `bg-[#F6F5F1]` (must match whatever surface the rail sits on) |

### 7.2 Ink (text) — direct analog of the old `white/NN` ladder

The old dark theme used `text-white/NN` as an emphasis ladder (higher N =
brighter = stronger). The light theme keeps the *same ladder logic* on two
base colours instead of one, so hierarchy reasoning carries over 1:1 — only
the base hex and which of the two colours to use change:

- **Ink** `#1A1A24` — headings, numerals, primary/strong body. Used with
  opacity modifiers: `text-[#1A1A24]` (strongest) → `/90` → `/85` → `/80` →
  `/75` → `/70` → `/60` → `/55` (down to "still legible, softly de-emphasized").
- **Muted** `#6E6E78` — secondary labels, meta descriptions, panel headings
  (uppercase tracking-wide labels). Used at full strength for anything that
  should actually be read, and with `/70`, `/60`, `/55`, `/45` for
  progressively quieter meta/glyph/decoration tiers (mirrors the old
  `white/35` → `white/20` "barely there" tail).

| Old (dark) | New (light) | Typical use |
|---|---|---|
| `text-white` / `/90` | `text-[#1A1A24]` / `/90` | big numerals, mastered/in-progress row titles |
| `/85` `/80` | `text-[#1A1A24]/85` `/80` | card titles, drill prompts |
| `/75` `/70` | `text-[#1A1A24]/75` `/70` | body prose, theory statements |
| `/50` `/45` | `text-[#1A1A24]/55–70` or `text-[#6E6E78]` | secondary numerals, "Secondary" role labels |
| `/40` `/35` | `text-[#6E6E78]` / `/70` | panel headings, meta descriptions |
| `/30` `/25` | `text-[#6E6E78]/70` / `/55–60` | chapter counts, row meta lines |
| `/20` `/15` | `text-[#6E6E78]/45` / `decoration-black/15` | locked glyphs, ghost underlines, disabled decoration |

Contrast was checked at each tier against both `#FFFFFF` (card) and
`#F6F5F1` (paper): ink ≥ `/55` clears ~3.5:1 (fine for 13px+ labels), ink at
`/70`+ clears ~4.5:1 (AA body text), muted `#6E6E78` alone is ~4.6:1 on
white. The lowest tiers (`/45` muted, `/15` decoration) are deliberately
quiet — same design intent as the old `white/20` tail — reserved for
decorative glyphs and disabled affordances, never for content that must be
read.

**Buttons:** primary buttons keep the saturated `from-indigo-500
to-fuchsia-600` gradient with `text-white` unchanged — white reads fine on a
saturated gradient regardless of page theme. Secondary/ghost buttons flip to
`bg-black/[0.05] text-[#1A1A24]/70` / `text-[#6E6E78] underline
decoration-black/15`.

**Gradient-clipped text** (streak numbers, "MASTERED", test score) darkens
from the `-300`/`-400` shades used on dark (`#818cf8`/`#e879f9`,
`from-indigo-300 to-fuchsia-300`) to **`from-indigo-600 to-fuchsia-600`**
(`#4f46e5`/`#c026d3`) — light shades on white are close to invisible;
saturated-dark shades hold contrast.

### 7.3 Lens tokens (light)

Same hue identity (row=cyan, matrix=indigo, column=fuchsia), re-derived for
white backgrounds: pale `-50` chip fill with a `-700`/`-800` text colour and
a `-600/25–40%` ring, instead of the dark theme's `-500/12%` fill with
`-300` text.

```ts
row:    { chip: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-600/25", chipOn: "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-600/40", dot: "bg-cyan-500", edge: "border-l-2 border-cyan-500/60", tint: "bg-cyan-50" }
matrix: { chip: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/25", chipOn: "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-600/40", dot: "bg-indigo-500", edge: "border-l-2 border-indigo-500/60", tint: "bg-indigo-50" }
column: { chip: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-600/25", chipOn: "bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-600/40", dot: "bg-fuchsia-500", edge: "border-l-2 border-fuchsia-500/60", tint: "bg-fuchsia-50" }
```

`SOLID_BAR` (drill top-edge, single lens) and `TRANSLATE_BAR` (two-lens
gradient) switch from `-400 @ 60% opacity` to solid `-500` shades — the soft
dark-theme mix reads as barely-there on white.

### 7.4 Status tokens (light)

| Status | Node | Row text |
|---|---|---|
| `locked` | `bg-black/[0.04] ring-1 ring-black/10`, glyph `text-[#6E6E78]/45` | `text-[#6E6E78]/55` |
| `available` | `bg-indigo-50 ring-1 ring-indigo-400/60 shadow-[0_0_16px_-6px_rgba(99,102,241,0.4)]`, glyph `text-indigo-600` | `text-[#1A1A24]/85` |
| `in_progress` | `bg-white ring-1 ring-black/10` + SVG progress ring; core dot is now a small solid `from-indigo-500 to-fuchsia-600` gradient dot (a plain white dot would vanish on the now-white node) | `text-[#1A1A24]` |
| `mastered` | unchanged gradient node, glyph stays `text-white` (on the saturated gradient) | `text-[#1A1A24]/90` |
| `no_content` | `ring-1 ring-black/10 ring-dashed`, glyph `text-[#6E6E78]/45` | `text-[#6E6E78]/45` |

`FEEDBACK` (correct/wrong/draft) moves from `-500/12% + -300 text` to
`-50 bg + -700 text + -500/25–30% ring` — same three reserved hues (emerald/
red/amber), same "never means anything but this" rule from §1.2, just
re-mixed for white. The **grade bar** (0–3, DESIGN.md §3.5) needed a real
rethink, not just recolouring: white text over a 25–55%-opacity gradient
blended onto a *white* card is illegible, so v2 keeps `text-[#1A1A24]/70–90`
ink text on the three lower steps (`Again`/`Hard`/`Good`, tinted at
`15–40%` gradient opacity) and reserves white text for the one fully
saturated step (`Easy`).

### 7.5 Player overlay, drills, KaTeX

- Overlay background, header border, dock scrim: per §7.1.
- Drill/MCQ inputs: `border border-black/15 bg-white text-[#1A1A24]
  placeholder:text-[#6E6E78]/60 focus:border-indigo-500/50` — white fill
  with a genuinely visible border, per the "white, visible border, ink text"
  brief (the dark theme's `bg-white/[0.04]` recessed-fill trick doesn't
  exist in reverse; a light theme needs an explicit border to read as an
  input at all).
- Choice/MCQ option states (unanswered/selected/correct/wrong/other): ink
  text throughout, tinted `emerald-50`/`red-50`/`black-[0.04]` backgrounds
  instead of the dark theme's saturated-at-10% fills.
- Graduation ceremony disc stays fully saturated (conic gradient, shard
  hexes) — celebratory moments are the one place allowed to stay loud
  regardless of page theme. Only the inner hole (`bg-[#F6F5F1]`, was
  `bg-[#0a0a0f]`) and the surrounding text (ink, and the darkened
  `indigo-600→fuchsia-600` "MASTERED" gradient-clip) changed.
- KaTeX: `Markdown.tsx` sets no text colour itself, so KaTeX output inherits
  `color` from whatever ink class the caller's wrapper sets — as long as
  every `Markdown` call site passes an ink/muted class (it does, throughout
  this pass) there is nothing dark-theme left to leak. `PLAYER_STYLE` (size/
  weight/whitespace rules) is colour-agnostic and needed no v2 change.
  `LearnPage`'s outer wrapper also sets `text-[#1A1A24]` explicitly so any
  element that forgets an explicit colour (e.g. an unstyled `<span>`) falls
  back to ink rather than inheriting the app body's dark-theme
  `color: #e5e7eb` from `index.css`.

---

## 8. Desktop reading layout — 2026-08-10

Learn was designed phone-first and then reviewed on a ~2000 px Mac window,
where it fell apart in six specific ways: prose at a ~300-character measure,
an intro that read as one undifferentiated slab, GFM tables rendering with no
borders/padding at all, theory cards whose lens chip was flung to the far edge
away from its kind label, a "Practice →" button and a 3-segment stepper
stretched edge-to-edge, and display math crammed against the card's left edge.

**§0–§7 are unchanged.** This section is purely additive: everything below
`md` (768 px) renders byte-identical to v2 with two deliberate exceptions,
called out as such below. Every desktop change is an `md:`/`lg:` enhancement
layered over the existing phone-first classes.

### 8.1 The measure, and the three column widths

There are exactly **three** widths in the Learn surface. Do not invent a
fourth.

| Column | Width | What sits in it |
|---|---|---|
| **Reading column** | `max-w-[46rem]` (736 px ≈ 72 ch at 15–16 px) | Everything inside the Player's `<main>` — and the Player's own `<header>`, so the chrome tracks the content and the overlay reads as one sheet of paper rather than a phone layout stretched wide. |
| **Action column** | `md:max-w-[26rem]` (416 px) | The dock's contents: primary button, ghost row, the 0–3 grade bar, the test-locked meter. Full-width on phone. |
| **Answer column** | `md:max-w-[34rem]` (544 px) | Inputs, MCQ options, tiles, the result banner. A text field or an option button stretched to 736 px reads as a *form*, not as a question. |

The paper background (`#F6F5F1`) and the dock scrim stay **full-bleed** — only
their contents are columnar. A scrim that stops at 736 px would draw a visible
seam across the window.

Shared literals live in `player/tokens.tsx` (complete class strings, §1.1):

```ts
READING_COL = "mx-auto w-full max-w-[46rem]"
MAIN_SHELL  = "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 md:px-8 md:pt-8"
DOCK_SHELL  = "…absolute inset-x-0 bottom-0 …px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8"
DOCK_STACK  = "pointer-events-auto mx-auto flex w-full max-w-[46rem] flex-col gap-2 md:max-w-[26rem]"
CARD        = "rounded-xl border border-black/[0.06] bg-white shadow-[0_1px_8px_rgba(0,0,0,0.05)] md:rounded-2xl"
ANSWER_COL  = "md:max-w-[34rem]"
```

`MAIN_SHELL` deliberately omits bottom padding — call sites append their own
(`pb-40` normally, `pb-48` on `DrillCard`, which has a two-row dock). The §6
checklist item "`<main>` has `pb-40`" still holds.

### 8.2 Spacing scale

One step up at `md`, never two. Card padding `p-3 → md:p-8` (`md:p-7` where the
card is a nested/recessed surface). Gap between theory cards `gap-3 → md:gap-8`.
Section rhythm inside a card: title `md:mt-3`, statement `md:mt-4`,
translations `md:mt-5`, `connect_md` `md:mt-6` behind a `md:border-t
md:border-black/[0.06] md:pt-5` hairline — on a tall card the closing aside
needs a rule to stop reading as another paragraph of the statement.

Body type steps once too: `text-[15px] → md:text-[16.5px]` for statements,
prompts and solutions; `text-[13px] → md:text-[15.5px]` for the quieter
translation/lens-note tier. Card titles go `text-[15px] → md:text-xl`.

### 8.3 `Markdown.tsx` is now the typographic layer

This was the actual root cause of "wall of text" and "tables are broken", and
it is fixed in exactly one place so every consumer inherits it.

`react-markdown` emits bare `<p>/<ul>/<table>` with **no classes**, and
Tailwind's preflight strips list markers, table borders and cell padding. The
result was unstyled HTML everywhere: paragraphs with no rhythm and GFM tables
whose cells fused together (the three-perspectives translation table was the
visible casualty).

**Mechanism.** One stylesheet scoped under `.learn-md`, injected **once** into
`document.head` by a module-level side effect, and a `learn-md` class added to
every `Markdown` wrapper. Two non-obvious choices:

- *Imperative head injection, not `<style>` in the JSX* — `Markdown` renders
  dozens of times per screen (every statement, tile, MCQ option); a `<style>`
  per instance would duplicate the sheet that many times.
- *Unlayered CSS* — Tailwind v4 puts preflight in `@layer base`, and an
  unlayered rule beats a layered one regardless of source order. That is
  exactly what's needed to undo preflight's resets without an `!important` per
  property. It also means `.learn-md` wins over a `leading-relaxed` on the same
  wrapper, which is intended: **body line-height is 1.7**, set once.

**Prose recipe:** `p` margin `0.85em 0`; first/last child margins zeroed;
`strong` → `600` weight at full ink `#1A1A24` (callers render body at `/75`, so
bold actually reads as emphasis); `ul`/`ol` markers restored with `1.4em`
indent and `#6E6E78` markers; `h1–h4` at `1.32/1.18/1.06/1em` with
`1.5em 0 0.5em` margins; `code`/`pre` on a `rgba(0,0,0,0.045)` chip;
`blockquote` on a 2 px hairline rail.

**Table recipe** (`.learn-md-table`, the wrapper div comes from a `components`
override on `table` so the scroller exists at every width):

| Part | Rule |
|---|---|
| Wrapper | `overflow-x: auto; overscroll-behavior-x: contain; margin: 1.25em 0` (`1.5em` at `md`) |
| Table | `width: 100%; border-collapse: collapse; text-align: left; font-size: 0.94em; line-height: 1.55` |
| Header | `0.45rem 0.75rem` padding, `0.76em` uppercase `0.08em`-tracked semibold in `#6E6E78`, `nowrap`, `1px` bottom rule at `rgba(0,0,0,0.16)` |
| Cell | `0.55rem 0.75rem` padding, `vertical-align: top`, `1px` top hairline at `rgba(0,0,0,0.07)`, none on the first row |
| First column | `font-weight: 600; color: #1A1A24` — it is the row's key (the lens name, the object being translated) |
| Edges | first/last cell drop their outer padding so the table's ink aligns with the prose measure |
| Math in cells | `.learn-md-table .katex { white-space: nowrap }` |

**Display math is left-aligned, not centred** — this is a bug fix, not taste,
and it is the *first* of the two changes that also lands on phone. KaTeX
centres `.katex-display`; content wider than an `overflow-x: auto` box then
places its own left edge at negative scroll, i.e. permanently unreachable in
LTR. A wide `\begin{array}{rcrcrcr}` system was literally missing its first
column with no way to scroll to it. Left alignment makes the scroll gesture
recover the whole expression. Margins go `1.15em → md:1.4em`, and
`.katex-display > .katex` steps to `1.18em` at `md`.

`player/tokens.tsx`'s `PLAYER_STYLE` keeps only the §1.5 size/weight/whitespace
trio; `Markdown.tsx` owns display-math *layout* under the
higher-specificity `.learn-md .katex-display` selector.

`.learn-md-lead > p:first-child` gets one size step (`1.06em`) at full ink —
used by the unit intro. `.learn-md.inline > p` collapses to
`display: inline; margin: 0` so MCQ options and tiles don't gain block rhythm.

### 8.4 Theory step: a real header, and card anatomy

The unit now opens with a **header block** instead of cold prose: the unit
title as a display heading (`text-[22px] → md:text-[34px]`, `leading-[1.15]`,
`tracking-[-0.015em]`), then a meta row of `unit_code · est_minutes min ·
N boxes · M drills` plus the unit's lens chips. The overlay's chrome title is
a 13 px truncated label — it was never a page title, and the intro was
carrying that job with no typography to do it.

`intro_md` keeps its gradient-left-rail card (`p-3 pl-4 → md:p-8 md:pl-10`) and
picks up `.learn-md-lead`, so the opening sentence sets up the unit at one size
step above the rest. **Long intros are not truncated** — measure and rhythm
were the problem, not length.

Theory card header: kind label and lens chip are now **adjacent**
(`flex flex-wrap items-center gap-x-2.5`), not at opposite card edges. This is
the *second* change that also lands on phone, and it is intentional: they are
the typographic and chromatic halves of one "what is this box" statement, and
at any width above a phone `justify-between` orphaned the chip. Then the title
at `md:text-xl`, then the statement.

### 8.5 The lens-note card is not a theory card

The three-perspectives note is the unit's thesis, so it inverts the theory
card's material: **recessed, not raised** — `bg-black/[0.025]` with a
`border-black/[0.05]` hairline and no shadow, against the white raised cards
around it — and carries a 2 px top bar
`bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500` that literally
*is* row → matrix → column. Its heading steps to `md:text-[18px]` and the three
lens chips moved from a right-floated cluster to a row **under** the heading.
This does not violate §0 rule 1: the bar is three lenses, not decoration.

### 8.6 Path and Review: one column, not two

`LearnPage` keeps **one centred column at every width** — `max-w-xl` →
`md:max-w-2xl` (672 px), `md:gap-10 md:pt-10 md:pb-24`. A `lg:` side-by-side
spine + review was considered and rejected: the spine is the hero and the
review card is its footer stat, so splitting them at 2000 px leaves both
floating in the middle of nowhere. **Wide windows buy margin, not more
columns.** If a second column is ever added it should carry genuinely new
content (a unit preview pane), not re-flow what's already there.

Within that column, `md:` steps only: panel headings `text-xs →
md:text-[13px]` at `tracking-[0.14em]`; the header-ring and streak cards
`p-3 → md:p-5`, `rounded-xl → md:rounded-2xl`; the two big numerals
`text-3xl → md:text-4xl`; unit rows `md:py-2.5` with `md:text-[15px]` titles
and a `md:hover:bg-black/[0.025]` cursor affordance (hover as an extra only —
§5's rule that no affordance may *depend* on hover still holds); chapter
headers `md:pt-7`. Review CTAs are capped at `md:max-w-[26rem]`, matching the
action column, so a page-level button is never 672 px wide.

### 8.7 Checklist addendum

- [ ] New content inside the Player goes in a `READING_COL` wrapper — never
      straight into `<main>`.
- [ ] New dock content goes in `DOCK_STACK`, not a bare `pointer-events-auto` div.
- [ ] New interactive answer surfaces get `ANSWER_COL`.
- [ ] Anything rendering authored markdown goes through `Markdown` — never a
      hand-rolled `<div dangerouslySetInnerHTML>`, or it loses the whole §8.3
      prose/table layer.
- [ ] Phone rendering is unchanged unless the change is one of the two
      deliberate exceptions above (display-math alignment, kind-label/chip
      adjacency).

---

## 9. The layered unit flow — 2026-08-10

The Player used to be three blocked steps: **all** theory, then **all**
practice, then the test. Read on a real unit that means opening with six to
nine theory cards in one scroll before a single question — which is exactly
the "handed everything at once" feeling the product is supposed to avoid.

The unit is now consumed as **interleaved layers**
(`LEARN_PLAN.md`, "Layered unit flow (pinned, 2026-08-10)"):

```
Layer 1:  theory chunk  →  worked example  →  that chunk's drills
Layer 2:  theory chunk  →  worked example  →  that chunk's drills
   …
Rapid round:  the archetype:"tiles" groups, whole-unit mix, no theory
Test:         unchanged — graduate iff ≥ 75 %
```

**§0–§8 are unchanged.** Every card, token, column width and motion rule below
`md` and above it is exactly as specified there; this section only says how
they are now *sequenced*. Nothing in this section changes the DB — layers are
derived client-side by `layers.ts` from the existing v1 content.

### 9.1 Stepper anatomy

Three fixed segments become **N**: one per layer, one for the rapid round if
the unit has any tiles group, and the test. Real content runs 4 layers + round
+ test = **6 segments**, and that is the width budget the design has to hold at
360 px.

| Segment | Inactive | Active |
|---|---|---|
| Layer | the layer **number**, `1`–`N` | `Layer 3` |
| Rapid round | a **2×2 dot glyph** (`bg-current`, inherits the tone ladder) — the tap/tile concept, never the word | `Rapid round` |
| Test | `T` | `Test` |

Rules that make six segments legible on a phone:

- Inactive segments spend no horizontal space on words. **Numbers and glyphs
  only.** Only the active segment renders its label, and it buys the room with
  `flex-[1.7]` against its neighbours' `flex-1` rather than wrapping —
  `whitespace-nowrap` + `truncate` are the backstop.
- Every layer/round segment carries its **solved count** (`2/4`) in
  `text-[9px] tabular-nums opacity-65`, next to the number. This is what makes
  a soft gate honest: you can walk past unsolved drills, and the segment says
  so.
- The full string (`Layer 3 — 2/4 drills solved`) lives in `aria-label` and
  `title`; nothing readable is glyph-only for a screen reader.

The bar keeps §3.2's language exactly — a 3 px track filling with
`from-indigo-500 to-fuchsia-500`. What the fill *means* is now per segment:

- **Layer / rapid round** — the step's **solved-drill ratio**. A step you
  walked through without solving anything reads as an empty bar, which is the
  truth. (Steps with no drills fall back to visited = 100 %, active = 60 %.)
- **Test** — 0, `50 %` while active, `100 %` after graduation.
- The active segment's *track* darkens to `bg-black/[0.12]` (from
  `bg-black/[0.07]`) so a 0 %-filled active segment is still identifiable.
- The locked test keeps §3.2's cue verbatim: `bg-black/[0.04]` +
  `ring-1 ring-dashed ring-black/10`, tone `text-[#6E6E78]/40`, non-tappable.

Everything stays inside §8.1's reading column — the stepper lives in the
Player's columnar `<header>`, untouched.

### 9.2 Layer screen order

One layer is a three-beat mini-sequence, each beat a full screen with its own
dock (`player/LayerStep.tsx`):

1. **Theory** — an eyebrow `LAYER 2 / 4` (`text-[10px]`, `uppercase`,
   `tracking-[0.14em]`, `#6E6E78/70` — the same eyebrow as `DEFINITION` on a
   card), then this layer's `TheoryCard`s, identical to §8.4. Layer 1 *only*
   also carries `UnitOpening` — the display title, meta row, `intro_md` rail
   card and the recessed lens-note card of §8.4–8.5 — above the eyebrow,
   because those introduce the unit, not the layer. Dock: `Example →`, or
   `Practice →` when the group has no `master_demo`.
2. **Example** — `MasterDemoView`, the §3.4 progressive `{what/why/how}`
   reveal, verbatim, with the eyebrow `LAYER 2 / 4 · Example`. Dock:
   `Next step (n/m)` → `Start drills →`, ghost `Skip to drills`.
3. **Drills** — `DrillCard` per §3.5, verbatim, index label
   `Layer 2 · Drill 3 / 4`. A layer with no theory boxes (common: `translate`
   and `truefalse` groups usually re-use concepts an earlier layer taught)
   simply opens at beat 2.

Then a small **layer-complete** card: `Layer complete — 3/4 drills solved`,
ghost `Go through this layer again`, primary = the next step, named
(`Layer 3 →`, `Rapid round →`, `Take the test →`).

The **rapid round** (`player/FinalRound.tsx`) has no theory and no example by
construction — tiles groups may omit `master_demo` per schema, and the point is
speed over a whole-unit mix after the layers taught each piece in isolation.
Its drills are `DrillCard`s labelled `Rapid round · 3 / 5`; the round header
lives in the index label rather than a gate screen, so entering it costs zero
taps. It closes on the same completion-card shape, with `Take the test →`.

### 9.3 Continuity rules

- **Solved is persistent.** The solved set is seeded from `lr_attempt_log`
  (`api.fetchSolvedDrillIds`) — a drill counts as solved once it has been
  graded, at any grade, which is exactly the in-session definition. A failed
  lookup resolves to the empty set: "no evidence of solving" keeps the test
  gate *shut*, never opens it.
- **Resume forward.** Entering a unit lands on the first layer that still owes
  drills (then the rapid round, then the test if everything is solved). Within
  a layer, the drill cursor starts at that layer's first unsolved drill.
  Failing the test returns you to the same computed resume point, not to
  layer 1.
- **Back-nav always works.** Any visited segment is tappable, so the theory of
  a completed layer is always one tap away.
- **Forward is soft, not gated.** The *next* segment is tappable too
  (`i <= maxVisited + 1`), and the layer's primary button advances whether or
  not its drills are solved. The unit has exactly **one** real gate: the test's
  `unlock_ratio`, counted across **all** the unit's drills (layers + rapid
  round), never per layer. When the next step is a locked test, the layer's
  advance button is disabled and the dock line says how many drills are still
  needed — the same wording the locked-test meter uses.
- Grading, memory writes, the `KLADDE` draft badge and the graduation ceremony
  are untouched by any of this.

### 9.4 Checklist addendum

- [ ] A new step kind adds a `StepSegment` — number-or-glyph when inactive, a
      label only when active. Never a word on an inactive segment.
- [ ] Anything that gates forward motion must be the test, or it is a bug:
      layers are soft.
- [ ] `deriveLayers` is pure and must stay so — no fetching, no dates, no
      `Math.random`. It is the one piece of this flow that is unit-testable.
