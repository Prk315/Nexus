# CLAUDE.md — Vault

Loaded automatically when working under this directory. Cross-cutting rules
(Supabase removal ordering, RLS posture, iOS deployment, environment gotchas)
live in the root `CLAUDE.md`.

**Vault data layer** (`apps/Vault/Vault/src/lib/`):
- `supabase.ts` — shared client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- `api.ts` — all graph operations (loadGraph, createNode, deleteNode, addEdge,
  removeEdge, tag CRUD) plus `readContent`, `saveContent`, `readJournal`,
  `saveJournal`, and `uploadAsset` (→ Supabase Storage bucket `vault-assets`).
- The `VaultGraph` structure (nodes, edges, back_edges, tag_colors) is
  assembled client-side on every mutating call via a single `loadGraph()` pass.
- PDF/Video binaries live in Storage; `vault_content` stores their public URL.
- `vault_content.node_id` has no FK so annotation keys (`{id}_annot`) work.
- Two Postgres helper functions handle bulk array operations:
  `vault_rename_tag(user_id, old, new)` and `vault_delete_tag(user_id, tag)`.

Required `.env` at `apps/Vault/Vault/.env` (gitignored):
```
VITE_SUPABASE_URL=https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

## Vault CSS: there were two palettes, not one untokenised palette

⚠️ `App.css` grew an oklch scale on `:root` AND a separate hex palette that
predates it. Measured before touching anything: of 234 colour literals outside
`:root`, **exactly one** matched a declared token. They were never untokenised
references to the scale — they were a second scale.

So "tokenise the CSS" is not a find-and-replace. The fifteen colours used three
or more times are now named (`--accent`, `--danger-solid`, `--handle`, …),
covering 104 of the 234; `lib/cssTokens.test.ts` is a ratchet that fails if any
of them is written as a hex literal again, naming the token to use instead.

**92 colours are used exactly once and are deliberately NOT tokenised.** A token
used once is a rename, not an abstraction, and naming them is a design decision
rather than a cleanup — so a dark theme (833) still needs that conversation
before it can override everything.

⚠️ `--accent`/`--accent-pdf` and `--danger-solid`/`--danger-pdf` are near
duplicates that drifted apart, not two intentional colours. They are kept
distinct because unifying them would change pixels, which is a decision rather
than a cleanup.

The rule the whole change was held to: **no rendered colour may move.** Verified
rather than asserted — expanding every new token back to its value reproduces
the original file's colour multiset exactly.

## ⚠️ Storage has its own RLS, and it excluded the signed-in user

`storage.objects` carried one policy: `anon_all`, **FOR ALL TO anon**. Vault's
web app signs in, so its client is the **authenticated** role — which had no
policy at all, and therefore could not upload. Every "Import PDF" since auth
landed was denied (migration `20260830180000` adds owner-scoped authenticated
policies; `anon_all` stays, because removals here are strictly ordered).

Same trap as the productivity tables, with Storage in place of a table: **a
policy written for one role does not merely restrict the other, it excludes
it.** The tell is in the data — every object in the bucket had `owner IS NULL`,
i.e. written as anon, and the newest predated the auth work.

New Storage policies are scoped by path prefix (`(storage.foldername(name))[1]
= auth.uid()::text`), which works because `uploadAsset` and `uploadCanvasImage`
already write `${auth.uid()}/…`. Verify one by running as the role in a
transaction that rolls back — `set_config('request.jwt.claims', …)` then
`set_config('role','authenticated')`, insert, and `raise` to abort.
`storage.protect_delete()` forbids deleting rows here, so a probe that commits
cannot be cleaned up.

**The reason it went unnoticed is the more general bug:** `uploadAsset` throws,
the import handlers had no catch, and a throw inside an async event handler goes
nowhere. The user saw a node whose viewer said "PDF not loaded" and no error
anywhere. Imports now report the failure and remove the half-created node — an
empty node is not a partial result, since nothing but the import writes its
content.

## Vault: Frontend Gotchas

These are non-obvious requirements that broke the 3D graph and PDF viewer once and will again if you regress them — keep them in `vite.config.ts` and `PdfViewer.tsx`.

**`resolve.dedupe: ["three", "react", "react-dom"]` is required.** `@nexus/core` is aliased to source and imports `three` directly (`AppGraph3D`, `Chart3D`); `react-force-graph-3d` pre-bundles its own `three`. Without dedupe you end up with two `THREE` instances and three-forcegraph's `state.layout` ends up undefined — every animation frame crashes with `Cannot read properties of undefined (reading 'tick')` inside `layoutTick`. Same logic for React (dual-React = blank screen, per the React-19 parity rule above).

**Pre-bundle the heavy deps** in `optimizeDeps.include`: `three`, `three-spritetext`, `react-force-graph-2d`, `react-force-graph-3d`, `pdfjs-dist`, `@react-three/fiber`, `@react-three/drei`, `@tiptap/react`, `@tiptap/starter-kit`. Don't include `@tiptap/pm` (no `.` exports). The pre-bundling makes failures deterministic at boot rather than mid-session when AVG quarantines a lazy chunk.

**ForceGraph3D ↔ kapsule ↔ React useEffect race.** `react-force-graph-3d`'s wrapper calls `comp(domEl)` in `useLayoutEffect` which schedules a 1ms-debounced `_updateGraph` that sets `state.layout`. React's `useEffect` (where `applyForces` lives) fires through `MessageChannel` scheduling and beats that timer. If `applyForces` calls `d3ReheatSimulation()` before the debounce, `engineRunning=true` flips while `state.layout` is still undefined → next animation frame crashes. Two-line fix in `App.tsx`:

1. Gate `<ForceGraph3D>`/`<ForceGraph2D>` mount on `filteredGraphData.nodes.length > 0` (show a "Loading…" placeholder otherwise).
2. Schedule the initial `applyForces()` via `setTimeout(applyForces, 50)` instead of calling it synchronously.

**PDF.js v5+ has four sharp edges; PdfViewer.tsx has them all wired:**

1. `page.cleanup()` returns `void`, not a `Promise`. `page.cleanup().catch(...)` throws `TypeError: page.cleanup(...).catch is not a function` and React unmounts cascade-fail across every `<PdfPage>`. Use `try { page?.cleanup() } catch {}`.
2. `page.render({ canvasContext })` is deprecated and silently produces no pixels in v5; use `page.render({ canvas })` instead.
3. v5 ships image decoders (JBig2, OpenJPEG) and color management as WASM, plus the 14 PDF base fonts as separate files. Without `wasmUrl` and `standardFontDataUrl` passed to **`getDocument`** (NOT `GlobalWorkerOptions` — those keys are ignored on the global), pages with JBig2 images render blank and the console floods with "Ensure that the `standardFontDataUrl` API parameter is provided". The asset directories are copied from `node_modules/pdfjs-dist/{wasm,standard_fonts}` into `apps/Vault/Vault/public/pdfjs-{wasm,fonts}/`.
4. Set `useSystemFonts: false` in the `getDocument` options — the Tauri WebView2 has no path to the OS font directory and pdfjs falls back to the standard fonts cleanly.

**PDF page wrappers must use block layout, not inline-block in a flex column.** `.pdf-scroll-area` cannot be `display: flex; flex-direction: column; align-items: center` if its children are inline-block: WebView2 (Chromium) collapses them to height 0 inside the `overflow: auto` container, and pages render correctly into invisible boxes. Use plain block layout on the scroll area and `display: block; width: max-content; margin: 0 auto` on the wrapper.

**CanvasEditor renders in two layers, and a block must pick exactly one.** Vector
blocks (`divider`, `draw_arrow`, `draw_ellipse`, `draw_polygon`, `ink_stroke`) draw
themselves in the SVG layer at `z-index: 1`; everything else gets a `.canvas-block`
wrapper at `z-index: 2`. That wrapper is an **opaque** card the size of the block's
bounding rect with a ≥32px header — so a vector block that is missing from the
early-return list in `blockElements` renders *twice*, with the card hiding the very
stroke it belongs to. `ink_stroke` was missing from that list, which is why every pen
stroke came out buried under a white edit box. Add new vector types to both the
early-return and the SVG layer. The corollary: with no wrapper there is no drag
header, so the shape's own hit path must arm the drag (`onInkStrokePointerDown`), and
its `strokeWidth` should be divided by `zoom` to stay finger-sized on iPad.

**Destructive actions use `useConfirm()` from `components/ConfirmDialog.tsx`, never
`window.confirm()`** — the latter is a silent no-op in iOS WKWebView, so a confirm
that "returns false" would just make deletes stop working on the iPad. Node deletion
has exactly one gate: `App.handleDeleteNode`. The tree row ×, both graph Delete
buttons and EditorPane's folder graph all route through it (EditorPane receives it as
its `deleteNode` prop), and it resolves `false` on cancel so callers skip their
post-delete cleanup. Wire new delete entry points to that function rather than to
`useGraph().deleteNode`.

### Sizing and spacing a block by dragging

`lib/blockSize.ts` holds the arithmetic; the grips are **widget decorations**
(`spacingGrips.ts`), for the reason `columnResize` already documents — a node
view means a React tree per block, re-reconciling on every keystroke inside it,
to render handles that never change.

⚠️ **Width is a percentage, height is pixels.** A note opens at 720 px, full
bleed, and on an iPad: a stored pixel *width* is wrong the moment the column
changes. Height has no such relationship, and a percentage there would make a
drawing's aspect ratio depend on the window.

**Spacing is a step on a short scale, not free pixels** — a free value lets you
reach 0 and 400 px by twitching, and both are broken states.

⚠️ **`Number("")` is `0`, which is FINITE.** `readWidthPct("")` therefore
returned the minimum rather than null — and an HTML round trip renders an unset
attribute as `width=""`, so every never-sized block would have come back 15%
wide the first time a note was pasted. Absent is not zero, in the one place the
language quietly disagrees.

**null is "never set", 0 or 100 is a choice.** Collapsing them would make simply
*opening* a note rewrite every block that had never been adjusted — and an
autosave follows. It is also what gives double-click-to-reset somewhere to go.

**Nothing dispatches until pointerup** — the same rule as the column resizer.
And a plugin must not `dispatch` from `view.update`: that is a loop waiting for
one guard to be wrong, and `decorations(state)` already has everything needed.

## Math is edited in the document, not in a dialog

Clicking an equation makes it an editable field **where it sits**, and a second
toolbar row appears under the main one with the palette. The modal it replaced
covered the page — and maths is written *about* something, so hiding the
sentence above it is the one thing the editor must not do.

⚠️ **`Mathematics.configure(...)` was replaced by `InlineMath` + `BlockMath`
extended with a node view, and the SCHEMA is unchanged by that.** `Mathematics`
is nothing but `addExtensions: () => [blockMath, inlineMath]`, so the same two
node types are registered under the same names with the same `latex` attribute.
This matters more than usual: an unknown node type **blanks a document**, so a
careless change here would risk every note containing an equation.
`extensions/math.test.ts` asserts both types still exist, that `latex` is still
their attribute, and that a pre-existing note round-trips.

**Selected IS editable — there is no separate flag.** The toolbar row derives
its visibility from the same selection the node view uses, so the two cannot
disagree; a flag would let the row show while no field exists and its buttons
would insert into nothing. It also removes Save/Cancel, which nothing else in
Vault has: every other edit is the document, undone with Cmd-Z.

⚠️ **The toolbar reaches the field through a module-scope registry that clears
BY IDENTITY** (`lib/mathToolbar.ts`). Two fields hand over on focus — the new
one registers *before* the old one's blur fires — so an unconditional clear on
blur wipes the field that just took over, and the palette inserts into nothing
while looking alive.

⚠️ **The extension's own `insertInlineMath` / `insertBlockMath` cannot be used
for this.** Both begin `if (!latex) return false`, so an EMPTY latex is refused
— and seeding `""` therefore made every insert a silent no-op: no node, no
toolbar row, no error. The node is created directly instead.

No schema test could see that: they assert node types and HTML round trips, and
the schema was never wrong; a command's runtime guard was.
`extensions/mathInsert.test.ts` drives a REAL editor, which is the only thing
that distinguishes "the node type exists" from "inserting one works". It needs
`requestAnimationFrame` in `test/domSetup.ts` — happy-dom's window has it,
`globalThis` does not, and Tiptap reaches for the global.

⚠️ **The inserted node is found by proximity to the INSERT POINT, not to the
selection afterwards.** Measured: a block equation inserted at the start of
`<p>before</p>` lands at position 0 while the caret was at 1 and the mapping
gives 2 — ProseMirror lifts a block node out of the paragraph, so there is no
fixed offset. Measuring from the post-command selection is what made the old
code select the wrong equation next to an existing one.

**Inserting creates an EMPTY node and selects it**, rather than seeding `"x"`.
A placeholder you must delete first is a worse start than an empty field with
the caret in it, and insert-then-click now reach one state rather than two.

**mathlive must stay out of the eager bundle** (~600 kB). The node view imports
`MathField`, which dynamic-imports mathlive — verified against built output.

## Vault: the note editor (Tiptap)

`NoteEditor.tsx` is the Tiptap surface for the plain **Note** kind — and the
fallback for any kind `EditorPane`'s switch doesn't special-case. Its schema is
built in exactly one place, `extensions/noteExtensions.ts`. Never inline an
extension list anywhere else: `lib/noteSchemaGuard.ts` derives the schema from
that same function to audit stored content *before* an editor is mounted, and a
second copy would make the guard validate against a schema the editor doesn't
have.

⚠️ **An unknown node type does not get dropped — it blanks the whole note.**
`@tiptap/core`'s `createNodeFromContent` catches ProseMirror's "Unknown node
type" and returns `createNodeFromContent("")`, i.e. an empty document. The first
keystroke then autosaves that blank, and the note history below is a five-minute
snapshot, not an undo log — it can get you back to the previous *iteration*, not
to the keystroke before the blank. Web,
Mac and iPad update independently, so from the moment one note holds one new
block type the race is live. That is what the guard exists for: it names the
unknown types and refuses to mount an editor. **Deploy a schema addition
everywhere — including a fresh `npm run ios:vault` — before creating content
that uses it.** `enableContentCheck` alone is not enough; `setContent` forwards
the flag and does *not* catch, so it turns a bad load into a sync throw inside a
React effect.

**A destroyed or not-yet-mounted editor is still truthy.** `if (!editor) return`
is not a sufficient guard and this white-screened production once already:
teardown only nulls the internals, so `editor.commands` reaches
`get commands() { return this.commandManager.commands }` with a null
`commandManager`. Guard with `editor.isDestroyed`, and wrap `editor.view` in a
try/catch — in v3 that getter *throws* before the view exists, which a layout
effect can hit during React's remount. Anywhere async work can outlive the
editor (a content effect, an image upload, a pointerup listener on `window`)
needs both.

**Custom nodes with keymaps need `priority: 1000`.** Tiptap sorts extensions by
priority descending and collects keymap plugins in that order, so at the default
100 StarterKit's baseKeymap claims Backspace first and a container's handlers
never run — `joinBackward` then merges across an `isolating` boundary that is
correctly set in the schema. The symptom is a callout's text silently absorbed
into the paragraph above it.

**Structural blocks are a family, not one-offs**
(`extensions/structural/`): `createContainerNode` supplies the schema flags,
serialization and shared keymap for callout, container, toggle and columns.
`isolating` is load-bearing on all of them, and because ProseMirror gives up
*politely* at an isolating boundary, each needs explicit Backspace/Enter/Mod-Enter
rescues or the keys read as a freeze. Containment is schema-enforced: `column`
and the toggle parts are deliberately **not** in `group: "block"`, which is what
makes them unplaceable anywhere else.

**Nesting was never a schema limit — the UI was refusing it.** `columnBlock` is
`column{2,}` and `column` is `block+`, so a row inside a column, or a callout
inside a column inside a row, has always been legal. What blocked it was an
`isAvailable` guard in `blockRegistry.ts` and a `return false` in the resize
plugin's `descendants` walk, both written on the belief that a row cannot
contain a row — true only because nothing could make one. Both are gone; nesting
is now offered and every nested row gets its own resize gutters.

**Inline text size is a TextStyle mark attribute, in `em`.** `@tiptap/extension-text-style`
already ships `FontSize` (and `FontFamily`), so this needed registering rather
than writing. `em` and never `px` is the design: the note has its own `textSize`
and the same note opens on an iPad, so a run pinned to 11px would ignore both.
Three sizes rather than a spectrum — this is for a caption or an aside, and
headings already exist for structure.

It is registered `surfaces: ["bubble"]` only, which also sidesteps the trap that
made card colours unreachable: the bubble menu renders every bubble action
without filtering by group, so no toolbar group list has to know about it.

**Per-note appearance lives on the DOC node: `width` and `textSize`.** Both are
properties of the NOTE rather than of a browser — a dense reference note wants
small text and a journal page wants large, and the iPad is simultaneously where
you most want bigger text and the device least likely to have set a local
preference. Text size is a scale on the editor root, never a `font-size` on the
paragraph: every heading, list and table cell is already sized in `em` relative
to it, so scaling once keeps the type hierarchy in proportion instead of growing
body text past its own H3. It is deliberately independent of `width` — coupling
them would mean choosing large text silently re-flowed the note.

⚠️ **Anything that reads doc attributes must read them ALL, not a named list.**
`width` was handled by name in three places (the `[content]` effect, the restore
handle, and the collab seed rescue), and a second attribute would have been
stale in all three without a single line changing. `applyDocAttrs` and
`readSeedDocAttrs` now iterate whatever the stored JSON carries. The collab one
matters most: ySync rebuilds the root with `topNodeType.create(null, …)`, so it
is the only thing standing between a doc-level setting and Yjs dropping it —
`textSize` needed no change there, and that property has a test.

**Three things are stored on nodes rather than as structure, and the reason is
always the same one.** The per-note width lives on the DOC node (`noteDocument.ts`),
a heading's fold state lives on the HEADING (`headingFold.ts`), and a sketch's
strokes live on the block (`SketchBlock.ts`). An attribute an older client
doesn't know is **dropped silently** — `Node.fromJSON` builds attrs by iterating
the *type's* declared attributes and never looks for extras — whereas an unknown
NODE type blanks the whole note. So an attribute can ship ahead of the Mac and
iPad builds; a node type cannot. `sketchBlock` IS a node type, so it must be
deployed everywhere (including a fresh `npm run ios:vault`) before any note
containing one is created.

Two consequences worth knowing:
- **ProseMirror never renders the TOP node**, so a doc attribute reaches no DOM
  and CSS cannot see it. `NoteDocument` runs a plugin whose `props.attributes`
  projects `data-note-width` onto the editable. Without it the setting silently
  does nothing.
- **`setContent` replaces the content RANGE, not the doc node**, so doc-level
  attributes survive it untouched. Loading a `wide` note into an editor showing
  `full` keeps `full`. The mount path is fine (`useEditor` builds the doc from
  the JSON); NoteEditor's `[content]` effect dispatches the width explicitly.

**Folding a heading hides its siblings; it does not contain them.** The document
stays flat and the fold is decorations — a class on each block the heading owns,
plus a widget for the arrow. Wrapping the section in a `toggleBlock` would make
every fold and unfold a structural edit (lose one and you have lost the section,
not its fold state), and would reshuffle the outline, which walks siblings.
Ownership is scoped to the heading's PARENT, so a heading in a column folds that
column and cannot reach across the row — that falls out of the recursion rather
than being special-cased.

Two traps it hit:
- **`display: none` on a folded block needs `!important`.** `.columns-row` is
  `display: flex` at equal specificity and declared later in App.css, so a folded
  row stayed fully visible while correctly carrying `is-folded`. Folding must beat
  every block type's own layout, including types added later.
- **Hiding the block the caret is in does not move the caret**, so typing edits
  invisible text. Collapsing parks the selection at the end of the heading.

**The inline sketch keeps its strokes in the document, unlike every other ink
surface in Vault.** PDF annotations (`{id}_annot`) and book margins
(`{id}_margins`) get their own `vault_content` row; a sketch cannot, because
`NoteEditor`'s `nodeId` is optional (WorkbookEditor passes none) and one note may
hold many sketches. In the document, copy-paste clones the drawing, Cmd-Z undoes
a stroke, and deleting the block deletes the ink. The cost is size, capped at
`SKETCH_MAX_CHARS` (400 kB) — a sketch shares the note's 2 MB `saveContent`
budget, so an unbounded one would stop the note's *text* saving too.

Two rules it depends on:
- **Coordinates are a 1000-unit logical space, not CSS pixels**, and `height` is
  in those units — an aspect ratio. Note width now spans 720 px to full-bleed and
  the same note opens on an iPad, so pixel coordinates would put a third of a
  drawing outside its box with nothing to suggest it was ever wider.
- **The eraser hit-tests SEGMENTS, not stored points.** `simplify` (RDP) exists
  to delete interior points from straight runs, so a ruled line or a box edge is
  stored as exactly two points — a point-wise eraser can only rub out its ends,
  and in a diagram that is most of the ink.

**BubbleMenu's props must be referentially stable.** `@tiptap/react`'s BubbleMenu
has an effect that DISPATCHES A TRANSACTION when any prop changes identity, and
NoteEditor's `onTransaction` calls `forceUpdate` so the toolbar refreshes. An
inline `options={{ placement: "top" }}` therefore closed the circle: render → new
identity → dispatch → forceUpdate → render, at ~130 transactions a second, with
React's "Maximum update depth exceeded" filling the console and every keystroke
competing with it. `BUBBLE_OPTIONS` and `bubbleShouldShow` are module-level
constants so there is no dependency array to get wrong.

**Costly drags dispatch nothing until pointerup.** Column resize writes
`flexGrow` straight to the DOM while the pointer moves and commits one
transaction on release; a transaction per `pointermove` would be ~60 document
rewrites a second, each waking the 400 ms autosave — the shape of the
2026-08-15 incident. Same rule for the block drag handle.

**Images go to Storage, never inline.** `allowBase64` is off and paste, drop and
the file picker all route through `api.uploadCanvasImage`. On failure they
insert *nothing* rather than falling back to a data URI.

Two dependency traps: `@tiptap/extension-drag-handle` imports
`extension-collaboration` and `y-tiptap` at the top level, so it drags the whole
yjs stack in for a grip icon — the handle here is hand-rolled instead. And every
`@tiptap/*` package peer-depends on the others at an **exact** version, so a new
one added with a caret range resolves to the newest release, fails to hoist, and
nests **a second `@tiptap/core`** under `apps/Vault/Vault/node_modules` — the
same dual-instance class as the React and three.js rules above. Pin new
`@tiptap/*` deps to the version the tree is on and check `@tiptap/core` appears
once in `package-lock.json`.

Tests live in `apps/Vault/Vault` (`npm test`, vitest + a happy-dom setup file —
vitest resolves `environment:` from its own install location, which is the repo
root, hence the setup file). The HTML round-trip cases are the highest-value
ones: a `renderHTML`/`parseHTML` mismatch is invisible to `tsc`, survives every
manual click-through, and only shows up as content quietly vanishing on paste.

## Vault: sharing, and live co-editing

A node carries `team_id` (→ `pf_teams`, the same seeded two-person team
PathFinder's Team tab uses) and additive `team_shared_*` RLS sits alongside each
`vault_*` table's `owner_all`. Sharing a **folder** is the same operation applied
to its whole reachable subtree — a folder is just a node with children, so
`shareNode` walks `graph.edges` and there is nothing folder-specific in it.
`addEdge` propagates `team_id` from parent to child, or a node dropped into a
shared folder would be invisible to the other person: `team_id` is what RLS
checks, not the edge.

**DELETE is governed only by USING, never WITH CHECK.** That is why "a teammate
may edit but not delete" is spelled as separate FOR SELECT/INSERT/UPDATE
policies, and why no `vault_*` table has a team DELETE policy. And
`vault_content` / `vault_journals` policies must strip suffix keys with
`split_part(node_id, '_', 1)`, because `<id>_hl` / `_annot` / `_textannot` /
`_bookmarks` / `_margins` share those tables — getting that wrong makes a shared
PDF's annotations invisible to the teammate, as an empty set rather than an
error.

### Live co-editing is Notes only, shared only, and behind a flag

`VITE_VAULT_COLLAB=1` turns on a Yjs CRDT for shared **Tiptap notes**. Everything
else — Canvas, PDF ink, Journal, Workbook, Bookshelf, and every private note —
keeps the sync-on-save path, where `assertContentNotConflicted` compares
`updated_at` and raises a conflict the user resolves with the Reload button.

```
vault_ydoc.state   ← base64 Y.encodeStateAsUpdate. THE TRUTH while co-editing.
vault_content.data ← JSON projection. What noteSchemaGuard audits, PDF export
                     and WorkbookEditor read, and an old client still sees.
```

Sync is a **private Supabase Realtime broadcast channel** per note
(`vault:doc:<nodeId>`) — no collaboration server, so nothing hangs on the Mac
being awake. Awareness (the carets) rides the same channel under its own event
rather than using Supabase Presence, which has a 5× smaller quota and would need
its own RLS branch; y-protocols already expires a stale caret after 30 s.

**Five traps, all of which are silent:**

- **RLS on `realtime.messages` does NOT make a channel private.** Broadcast
  routes by topic and `private` is a per-client *join flag*, so a client that
  omits it never has the policies evaluated and receives every delta. The anon
  key is committed and this repo is public. The actual enforcement is a
  project-wide dashboard setting — Realtime → Settings → **Allow public access
  off** — and it is not expressible in a migration. See `APPLY.md` §9.
- **Two clients seeding a Y.Doc from the same JSON duplicates the note.**
  `prosemirrorJSONToYDoc` mints *new* operations each call, so two "identical"
  seeds merge into two copies. Hence the election in `collab/seed.ts`: upsert
  with `ignoreDuplicates`, then re-read **unconditionally** — winner and loser
  take the same path, so there is no rarely-taken branch to rot. A client with
  empty content never enters the election. `seed.test.ts` asserts the *bug* on
  purpose; if that test ever goes green, read the header before touching
  anything.
- **Yjs drops doc-level attributes.** ySync rebuilds the root as
  `topNodeType.create(null, …)`, so `NoteDocument`'s per-note `width` resets on
  open. Which means the projection must come from `editor.getJSON()` — never
  `yDocToProsemirrorJSON`, which would write the default back and lose the
  layout for good. NoteEditor re-applies the seed width after first render.
- **An editor cannot gain Collaboration after mount.** `useEditor` builds its
  extension list once, so EditorPane renders a placeholder until the session
  resolves, and keys the editor on whether there is one. Mounting early gives a
  non-collab editor on a co-edited note that happily saves over the other person.
- ⚠️ **Anything derived from starting a session must carry the node id it was
  resolved FOR.** Starting one is async, so React state describing it lags the
  `nodeId` prop by at least one render — and in that render `nodeId` is already
  note B while `session` is still note A's. `useCollabSession` originally kept
  `session`/`status`/`loading` as three plain useStates and froze the seed on
  `session ? keep : take`, which meant **note B's CRDT got seeded from note A's
  document**: with no `vault_ydoc` row for B yet, A's text became B's
  authoritative state and the projection wrote it into B's `vault_content`. Two
  notes, one document, no undo. The same lag handed A's about-to-be-destroyed
  session to the editor mounted for B, and `loading` could not cover the gap
  because it was state too. The hook now holds **one** state — a slot stamped
  with its node id — and derives everything through `collab/slot.ts`, which is
  where the rule and its tests live. `startCollabSession` re-reads the seed from
  the server by node id as a second, independent lock on the same door: the
  caller's copy is the one input that can be about the wrong note.
- **The fragment name is `"default"`.** `Collaboration`'s `field` defaults to
  `"default"` but `prosemirrorJSONToYDoc`'s third argument defaults to
  `"prosemirror"`. Mixing them raises nothing — the note just opens blank, and
  the first keystroke's projection erases it.

`saveContentProjection` is a **separate exported function**, not a flag on
`saveContent`: a boolean is the kind of thing a refactor drops, and dropping it
would disable the conflict guard for every private note with no symptom until two
devices quietly overwrite each other. `forgetContentVersion` is its necessary
other half — a note unshared mid-session otherwise inherits a stale timestamp and
shows a permanent, unclearable conflict.

An out-of-date client is a real data-loss vector (it reads a healthy-looking
projection, edits, and saves the whole document over the CRDT), so `saveContent`
throws `CollabOnlyError` for any note that has a `vault_ydoc` row. Ship that
guard a release **before** the writer, iOS first — the iPad installs over a cable
on ~7-day certs and is the client most likely to be stale. Enable the writer in
the reverse order, web first, because web rolls back fastest.

**Yjs state grows forever** and there is no safe automatic compaction: rebuilding
a document mints fresh client ids and re-collides with any live peer, i.e. it
reintroduces the duplication bug as a scheduled job. Recovery is manual and is
what `owner_all`'s DELETE exists for — with nobody editing, the owner deletes the
`vault_ydoc` row and the next open re-seeds from the projection.

Bundle discipline: the entire stack sits behind one dynamic import
(`collab/loadCollab.ts`), and everything outside `src/collab/` uses `import type`
only — a single value import of `isChangeOrigin` would pull ~126 kB into the
eager note bundle for every private-note user and onto the iPad, which is why
`CollabSession` carries `isRemoteTransaction` as a function instead. `yjs` **must**
stay in `resolve.dedupe`: two copies make Yjs's internal `instanceof` checks fail
and `applyUpdate` silently no-ops, so the session looks connected and simply
never converges. (The `BlockHandle.ts` comment about "an app with no
collaboration" is now out of date, but its conclusion still holds — the stack is
lazy, and `@tiptap/extension-drag-handle` would import it eagerly.)

### Note history, and the second exit from a conflict

`vault_content` used to keep none, which is why several comments in this repo
warn about how much one bad write costs. `vault_content_versions`
(`20260827160000`, `APPLY.md` §10) is the other half of those fixes: they prevent
the write, this survives it.

Snapshots are taken by a **BEFORE UPDATE trigger on `vault_content`**, capturing
`OLD.data` — not by the client. Two reasons, both load-bearing:

- A client saving "a copy alongside each save" records the NEW document, so the
  state you actually want back (what it looked like when you opened it) is the
  one never recorded.
- The rule then covers every writer at once: web, Mac, iPad, the JSON projection
  written by the co-editing runtime, and anything added later.

It is rate-limited to **one snapshot per node per five minutes**, which makes it
a history rather than an undo log — and under co-editing that gate is not
optional: `vault_content` is rewritten every couple of seconds by *both* clients.
It also **skips any document over 2 MB**, the same number as `MAX_CONTENT_BYTES`:
the client refuses to write those at all, so they are frozen, and versioning
something nothing can change is pure cost.

**Retention is byte-budgeted, not count-based, and the live data is why.** A
plain "keep the newest 40" looked obvious and was wrong: measured against a 96 MB
database, 40 versions each would cost ≈3.8 MB for the 87 notes under 10 kB but
≈94 MB for the four rows between 100 kB and 2 MB — and ≈791 MB for the three
frozen Canvases. No single count serves a distribution that wide, and one low
enough for the big documents would leave the small notes (the ones actually
edited all day) with almost no history. So the prune keeps the newest entries
while their cumulative `byte_len` stays under **8 MB per node**, capped at 40 and
floored at 2. The floor is load-bearing: without it a document larger than the
whole budget would prune away the snapshot just taken.

This is the only trigger this repo puts on a hot write path, so
`vault_content_versions_node_idx` is what keeps the gate's `EXISTS` from becoming
a sequential scan on every keystroke. If note saving ever gets slow, check that
index first.

The panel (`components/VersionHistory.tsx`) **never mounts an editor on an old
version** — it renders a flat line projection and a diff (`lib/versionDiff.ts`,
pure and tested). That is a safety property, not a shortcut: an editor that
exists can emit, and one emit autosaves the old document over the current one. It
also means a version whose schema this build cannot parse is still viewable,
which is exactly when history is most needed.

Restoring goes **through the editor**, via `NoteEditor`'s `docRef` handle. Under
a CRDT a restore written straight to `vault_content` is invisible to the Y.Doc
and the next projection flush undoes it; `setContent` makes ySync turn it into
operations the other person receives. There is a direct-write fallback for when
no editor is mounted (the schema guard is showing, or a non-Tiptap kind), and it
deliberately refuses on a co-edited note rather than appearing to work.

⚠️ **`vault_content.user_id` is the OWNER, never the author.**
`vault_content_force_owner()` rewrites it to the parent node's owner on every
write — correct, and it must stay, since `owner_all` is written against that
column — so on a shared note it names the owner no matter who typed. The History
panel displayed it as a byline for one release and was therefore putting the
owner's name against versions the owner did not write. `updated_by`
(`20260827180000`, `APPLY.md` §12) is the real answer: a separate BEFORE trigger
stamps it from `auth.uid()`, SECURITY **INVOKER** so the claim resolves against
the caller. It is nullable with no backfill on purpose — rows written earlier
have an author nobody recorded, and NULL says so; backfilling from `user_id`
would manufacture exactly the false attribution it exists to remove. Render NULL
as "unknown", never as the owner.

The editor toolbar shows a **resting** "Saved · 4 min ago" line whenever nothing
transient is happening. `saveStatus` is deliberately short-lived ("Saving…",
then "Saved" for 1.5 s, then nothing), which left the pane silent about whether
the work was safe for almost all of every minute — the wrong default for a
surface whose entire failure mode is a save that quietly did not happen. The
"by whom" half appears only on a shared note: on a private one the answer is
always "you", and a byline that can only say one thing is noise.

A conflict now has three exits instead of one — **Reload**, **Keep mine**, and
**Compare**. "Keep mine" (`api.overwriteContent`) is only safe to offer because
it snapshots the server's copy first, so the person being overwritten can
recover from this same panel. Order is snapshot → refresh the guard → write, so a
failed snapshot leaves the conflict standing rather than clearing the guard for
a write with no safety net. Like `saveContentProjection`, it is a separate
exported name rather than a `force` flag — the one sanctioned way past
`assertContentNotConflicted`.

### The conflict guard, and the false alarm that trained people to ignore it

⚠️ **The conflict guard compares INSTANTS, not strings** (`lib/timestamps.ts`
`sameInstant`). It compared strings once, and every note then reported "changed
by the other user" on its second save and every save after, alone: `updated_at`
is a `timestamptz`, the client cached `new Date().toISOString()` (`…628Z`) after
a save, and PostgREST returns `…628+00:00`. The same instant, two spellings. The
first save of a session passed only because the cache had been seeded from a
READ; the first WRITE reseeded it and the formats never matched again. Parsing
also absorbs Postgres trimming trailing zeros (`.100Z` → `.1+00:00`), so
normalising the suffix alone would not have been enough. Both raw savers now
also `.select("updated_at")` and cache what the SERVER stored — `updated_at` is
written from the client's clock, so a device a few seconds off would otherwise
cache an instant the row does not hold.

The general rule: **a timestamp that crosses a serialisation boundary is a
value, not a string.**

### Two more ways a note could be written over another, both in EditorPane

Neither involved collaboration, and both had the same tell: the damage was
invisible in-session because `globalContentCache` still held the right thing.

- **A tab switch inside the autosave debounce cancelled the pending write.**
  `selectedId` is a dependency of the autosave effect, so its cleanup cleared the
  timer — the edit survived in the cache (so reopening the tab showed it) and was
  lost on reload, on closing the tab, or to any other device. The armed save now
  lives in `pendingSaveRef` and a node change **flushes** it. A flush that lands
  after the pane has moved on reports nothing into the save status: that status
  describes what is on screen, and a conflict attributed to the wrong note sends
  you to reload the wrong document.
- **Closing a tab could blank the tab it fell back to.** `closeTab` set the next
  node id next to `content = ""` and only *then* started reading, with no
  `persistedContent` entry to mark it unloaded — so the autosave effect could not
  tell that from "the user deleted everything" and wrote the empty string 400 ms
  later over a note that had never been opened. It routes through `selectNode`
  now, which sets `isLoading` and commits only once the content is in hand.
## ⚠️ The note SCHEMA path must never reach a Supabase client

`lib/noteSchemaGuard.ts` decides whether a stored note is safe to open, and it
does that by building the schema from `buildNoteExtensions()`. `lib/supabase.ts`
calls `createClient()` at MODULE SCOPE and throws "supabaseUrl is required" when
the env vars are absent — so one import anywhere in that graph makes "is this
note safe?" depend on a configured network client. Backwards: the guard exists
to run when things are broken.

This had been worked around by hand twice (`lib/taskTags.ts` and
`lib/taskFields.ts` are each "the pure half" of a module whose other half talks
to the network) and stated in a comment at the top of `PathfinderBlockLazy.tsx`
— and it was **still broken**, through
`noteExtensions → noteImage → lib/api → lib/supabase`. Nothing pointed at it:
the app runs fine, and only the guard fails, only when the env is missing.

`lib/schemaPath.test.ts` now walks the import graph from three entry points and
asserts it. It follows STATIC imports only — a dynamic `import()` is precisely
the escape hatch used to reach the data layer from a node view, so `noteImage`
defers its `lib/api` import into the upload handler, which runs on a real paste
long after any schema is built.

The test also asserts that its own walk finds a known importer, because a broken
walk would make every other assertion pass vacuously.

## Vault: runnable code cells

A `codeCell` node runs Python or SQL inside a note, notebook-style: every cell in
a note shares one namespace, Shift+Enter runs, results render underneath.
CanvasEditor has had the same thing as a `code_cell` block for far longer — the
execution model, sessions, output shapes and renderers now live in **`src/kernel/`
and `components/CellOutput.tsx`, shared by both**, because two copies would have
drifted on exactly the invisible details (how a session is keyed, what a restart
clears, whether output is bounded).

**The worker is a security boundary, not an optimisation.** `lib/formula.ts` states
the rule this feature had to answer: a note can be shared, co-edited and pasted
from elsewhere, so anything that executes its contents is *arbitrary code driven
by a document another person can edit, in a tab holding a Supabase session*.
Pyodide runs in a Web Worker with its own global scope, no DOM, no `window`, no
`localStorage` — which is where supabase-js keeps the session. That is why cells
offer **Python and SQL and never JavaScript**: a JS cell would run same-origin and
no care around it would restore that property. The `html` output chunk is rendered
in an iframe with `sandbox="allow-scripts"` and deliberately WITHOUT
`allow-same-origin` — the two together would let the frame drop its own sandbox.

**Python runs in two places, chosen at runtime.** `kernel/python.ts` calls Tauri's
`run_python` (real system interpreter, any installed package) when `isTauri()`,
and the Pyodide worker otherwise. Before this, a Python cell on the web said "not
available on this device", which is most of why cells were desktop-only. The two
sessions are necessarily separate — one is a process, one is a WASM heap.

**Outputs live in the document**, as a node attribute, for the reasons
`SketchBlock.ts` gives for strokes: `NoteEditor`'s `nodeId` is optional, one note
holds many cells, and in the document copy-paste, undo and delete all behave. The
cost is size, and three budgets apply at once — `saveContent` refuses a note over
2 MB, a shared note's outputs enter a CRDT that never shrinks, and one matplotlib
PNG is 50–150 kB of base64. Hence `CELL_OUTPUT_MAX_CHARS` in `kernel/outputs.ts`:
text truncates from the MIDDLE (a traceback's last line is the message), images
are dropped WHOLE rather than corrupted, and what was dropped is said out loud.

**Traps worth knowing:**

- **`worker.format: "es"` is required in `vite.config.ts`.** Vite defaults workers
  to `iife`, and Pyodide's dynamic imports force a code-splitting build, which
  Rollup refuses outright for IIFE. The build fails loudly, at least.
- **There is no interrupt.** Pyodide can only be interrupted through a
  SharedArrayBuffer, which needs COOP/COEP headers this app does not serve. Stop
  TERMINATES the worker, so the session's variables go with it — the UI says so
  rather than pretending to cancel.
- **Pyodide is fetched from a CDN**, pinned to the npm package's exact version
  (a mismatch between loader and assets fails confusingly). Self-hosting it the
  way pdf.js assets are copied into `public/` was rejected on size — tens of MB.
  The honest cost is that a cell cannot run offline.
- **`sessionId` is an extension OPTION, never a schema attribute.** It says where
  a cell is being rendered, not what the document holds; storing it would make a
  pasted cell drag another note's namespace along.
- ⚠️ **`codeCell` is a NEW NODE TYPE**, so a build without it cannot read a note
  containing one — the guard names it and refuses to mount rather than blanking
  the note. Web-only today means one atomic deploy; that stops being true the
  moment a Mac or iPad build is installed again.

## Vault: PathFinder task blocks

### One block, two hosts — the note and the canvas

The task block renders in a Tiptap node view AND as a canvas block, from one
implementation. Its coupling to Tiptap was always five things — `node.attrs`,
`updateAttributes`, `editor.isEditable`, `selected`, and the wrapper element —
so they are named in `PathfinderBlockHostProps` and passed in rather than
assumed. `PathfinderBlockView` is now a thin adapter over `PathfinderBlock`.

⚠️ **`NodeViewWrapper` is not optional for Tiptap and not usable off it.** It
registers the node view's DOM with ProseMirror, and it reads React context that
only a node view renderer provides — outside one it throws rather than
degrading. That is why the wrapper is a prop and why the canvas passes
`PlainBlockWrapper`. It is a component and not the string `"div"` because the
prop is typed: an intrinsic tag and `NodeViewWrapper` share no type that still
checks the props being passed, and loosening it to `ElementType` gives up the
checking entirely.

A fresh canvas block stores `spec: ""`, not a serialized default. `parseSpec`
turns an empty string into exactly `defaultSpec(view)`, so the canvas needs none
of the spec machinery imported — and cannot drift from it.

The canvas host is lazy for the same reason the note's is, and it is worth
checking after any change: the build should keep `PathfinderBlockView` as its
own chunk (~63 kB) with `CanvasEditor` unchanged. If the canvas chunk suddenly
grows by that much, a static import has crept in and every canvas now carries
the PathFinder data layer.

Wheel and pointer events stop at the block. The canvas pans and zooms on both,
so without that a scroll through a long task list drags the whole board.
### Board columns are editable on ONE axis, and only that one

`spec.statuses` overrides the built-in four, and only for `kanban_status` — the
one board axis whose values are free text on the task. Every other axis has a
closed domain (you cannot invent a priority), so offering to edit its columns
would promise something the model cannot keep. There is a test for that.

Stored **per block**, not globally: a status is not owned by anything, so one
note can track a review pipeline and another a shipping one without either
becoming the definition. Keys are lower-cased, because a key is matched against
`pf_tasks.kanban_status` by exact string equality — a column labelled "Doing"
that does not hold the "doing" tasks reads as an empty board rather than as a
mismatch. All 543 rows in the database are already lower-case.

Removing a column **does not touch the tasks in it**. They keep their status and
surface in the `__other__` bucket, which stays a non-drop-target because
dropping there would have to invent a value. A delete that silently rewrote
every card in the column would be a bulk edit disguised as a layout change.
### The board: dragging within a column writes a GLOBAL order

Cross-column drag writes the axis field; same-column drag reorders. The slot
arithmetic is `insertionIndexFromPointer` / `reorderedIds` in
`@nexus/core/pathfinder` — promoted out of PathFinder rather than copied,
because two copies of a drop rule disagree about the edges (the no-op slots
either side of the dragged card are exactly what one copy gets right and the
other does not) and only one would have had the tests.

⚠️ **`pf_tasks.sort_order` is ONE order per task, not one per view.** It is a
plain `integer` with default 0 — and today 405 of 543 tasks sit at 0, so manual
order is undefined for most of them and ties break by id. A kanban column is a
subset, so reordering inside it necessarily writes into the same order a
manually-sorted list reads. That is inherent to the column rather than to the
implementation, and it is the right meaning: "this task comes before that one"
should hold wherever the two are seen together. `reorderTasks` assigns
`sort_order = index` over precisely the ids passed, so always hand it the
COMPLETE group — a partial list renumbers a few tasks into the middle of
everyone else.

Reorder is offered **only under manual sort**. Under any other key the board
recomputes the order from the data, so the drag would write a value nothing
displays — a gesture that appears to do nothing, which is worse than one that
is visibly refused.

Geometry is read from the DOM at the moment it is needed, never cached at
pointerdown: the board reflows during a drag (a column highlights, the drop
line appears), and a cached rect lands the card in the wrong gap without ever
looking wrong on screen.

### ⚠️ The toolbar renders BY GROUP, so a group nobody lists is invisible

`NoteToolbar` holds several arrays naming which `BlockGroup`s appear where.
Anything whose group is in none of them is never drawn — no error, no warning,
no empty slot. An action can be registered, correctly gated, correctly
implemented, covered by its own tests, and completely unreachable.

That is what happened to card colours: `cardColor` declared
`surfaces: ["toolbar"]` and appeared in no array, so there was no way to change
a callout's or container's colour at all. It was found by the user asking how
to do it, which is the worst way to find it.

`components/groupCoverage.test.ts` now asserts the relationship in both
directions — every toolbar-surfaced group is rendered somewhere, and every
listed group has actions. Adding a group is easy and forgetting to render it is
easy, and both failures are silent.

The same audit found `pathfinder` declaring `["slash", "toolbar"]` while only
the slash half worked; the task blocks are now under Insert as well. `color` is
fine: it is `["bubble"]`, and the bubble menu renders every bubble action
without filtering by group.

### Dragging a task from one block into another

A cross-block drag has no common React parent to route through — the target is a
different node view, possibly in a different pane — so blocks publish themselves
in a module-scope registry (`lib/pathfinderHosts.ts`) keyed by a `data-pf-host`
attribute, and the drop resolves through `elementFromPoint`. Deliberately not
context: context reaches descendants, and two blocks in a note are siblings.

Re-registered on every render, so a drop reads the block's CURRENT filter rather
than the one it had at mount.

**"Inherits the new requirements while forgoing the old ones" needs no clearing
step.** Every inherited field is single-valued, so setting `plan_id` to the
target's plan *is* forgoing the source's.

⚠️ **`movePayload` is `creationPayload` minus `category`, and that one exclusion
is the whole difference.** `category` is the ISA discriminator: re-typing a
`task` to a sparse kind DROPS its planning row — urgency, stage, completion
mode, notes — and the demotion is lossy by construction. Creating a chore in a
chore block is a choice; dragging a planned task into one and silently deleting
its plan is not.

**The subtree comes along, but only its SCOPE** (`scopeOnly`: plan, goal, team).
Moving a branch of work into a project moves the whole branch; it does not
restate every step's status, priority, assignee or due date — those are claims
about an individual piece of work, and inheriting them would mark a dozen
subtasks "doing" or assign them all to whoever the target block is filtered to.
Descendants are patched sequentially, not with `Promise.all`: one connection per
descendant is the shape that wedged Supabase on 2026-08-15.

`descendantIds` is cycle-guarded. `parent_id` has no constraint stopping A→B→A,
and a cycle there would not be a wrong answer — it would be an infinite loop
inside a pointerup handler, which takes the tab with it.

The hovered block is marked with a `data-pf-drop` ATTRIBUTE written straight to
the DOM, not React state: the hovered block is a different tree from the dragged
one, so lifting it would re-render every block in the note sixty times a second.

List rows drag only to LEAVE the block. Re-ordering or re-parenting inside a
list is a different question — a list is a tree, so "dropped on that row" is
ambiguous between "before it" and "inside it" — and answering it by accident
would be worse than not answering it.

### Computed columns: a hand-written parser, never `new Function`

⚠️ A formula lives in the block spec, which lives in the NOTE — and a note can
be shared, co-edited and pasted from elsewhere. `new Function(src)` would be
arbitrary code execution driven by a document another person can edit, in a tab
holding a Supabase session. There is no `eval` or `new Function` anywhere in
Vault; `lib/formula.ts` does not get to be the first. It has no property access,
no globals, and no calls outside a fixed list.

⚠️ **`FUNCTIONS` is a Map, and that is not stylistic.** As an object literal,
`FUNCTIONS["constructor"]` resolves up the PROTOTYPE CHAIN to
`Object.prototype.constructor` — truthy — so `constructor(1)` sailed past the
"unknown function" check. Every inherited member was reachable as a function
name the same way. A test caught it. Field lookup uses `hasOwnProperty` for the
same reason.

**Parse once, evaluate per row.** 200 rows would otherwise be 200 tokenisations
of one string — but the real reason is that a syntax error is then known before
any row is drawn, so the column says "unknown field: estimat" instead of
rendering two hundred blanks. Fields are known at compile time precisely so a
typo is one legible error.

**Division by zero yields null, never Infinity.** An Infinity propagates into
the column sum and turns the footer into "∞", losing every other row's
contribution to one empty estimate. Same for a missing field: null, and
`aggregate` SKIPS nulls rather than counting them as zero — a task with no
estimate has no estimate, and averaging it in as 0 quietly drags every mean
down. The footer shows how many rows contributed so it never implies it measured
the whole column.

An invalid expression is **kept**, not dropped: the column shows an error, which
is recoverable, whereas discarding it loses whatever was being written with no
explanation for the disappearance.

### Sheet formulas reuse the expression parser by rewriting, not extending

A table cell starting with `=` computes, on `lib/formula.ts` — the same
hand-written parser the task blocks use, with no `eval`. That matters more here:
a table lives in a note, and a note can be shared and pasted from elsewhere, so
a formula is a string another person can put in your document.

Ranges are handled by **rewriting the source** before it reaches the parser:
`sum(A1:A3)` → `(A1 + A3)` with A2 empty, `avg` divides by the filled count,
`min`/`max` fold into nested binary calls. So the evaluator stays a pure
expression language with a fixed function list, and spreadsheet semantics stay
out of the module the task blocks also depend on.

⚠️ **An empty cell is dropped from an aggregate, never counted as zero** — the
fourth place this rule appears. Only `count` returns 0, where zero is the honest
answer. An aggregate over an entirely empty range is null.

⚠️ **Cycles.** `A1 = B1` / `B1 = A1` is one keystroke away, and unbounded
recursion inside a ProseMirror plugin is a blank white page, not an error. Two
things the tests forced: the cycle error **propagates** rather than being
swallowed into a null (swallowing flagged only one cell of a symmetric pair, so
the other rendered a bare dash with no explanation), and **a range containing its
own cell is a real cycle** — `A4: =sum(A1:A4)` is exactly how a user writes a
column total.

**References match on word boundaries.** "A1" is a substring of "A12", so a
substring test resolves A1 for a formula mentioning only A12 — and reports a
cycle through a cell nobody referenced.

**An empty cell inside the table reads as null, not an error**; only a reference
outside it is named. Otherwise half of every sheet under construction is red.

**The formula stays the document's content** and the value is a decoration —
replacing the text would mean the document no longer holds the formula, and
every sync, export and older client would see a frozen number. Same reasoning as
folding being decorations. The whole sheet re-evaluates on any doc change: a
note's table is tens of cells, and an incremental recompute is where spreadsheet
bugs live (a stale cell that is right until you delete a row).

Adds no node type and no attribute, so there is no deployment ordering.
### Canvas frame containment is geometric, and folding only hides

A frame has **no children field**, and `lib/canvasFrames.ts` deliberately does
not add one. Membership is derived from geometry every render.

⚠️ **Storing membership means every drag has to maintain it** — drop a block on
a frame, drag it out, resize the frame over it. Each is a place for the stored
answer to disagree with what the user can plainly see, and a block that *looks*
inside a frame but is not in its list is a bug with no visible cause. Deriving
it means the picture is the model.

Containment requires **full** containment, not overlap: a block half in and half
out is not "in" a frame in any sense a user would agree with, and folding would
make half a diagram vanish for no visible reason.

**Folding hides; it never moves.** `folded: true` and nothing else — contained
blocks keep their coordinates, the frame keeps its stored height, only the
rendered height shrinks. Moving or stashing the contents needs an inverse that
restores them exactly, and any bug in that inverse loses work.

Three things its tests forced:

- **Membership must be a function, not a relation.** Frames nest, so the
  innermost wins by area — otherwise a block belongs to both and folding the
  outer then the inner hides it twice.
- ⚠️ **Two coincident frames each contain the other**, so smallest-area-wins is a
  2-cycle. An antisymmetric tie-break (lower id owns higher) makes ownership a
  forest by construction.
- **Hiding is transitive**, and a blanket "un-hide every folded frame" at the end
  resurrects an inner folded frame inside a folded outer one — a stray title bar
  floating in a closed group. Top-level folded frames are simply never added.

**Arrows re-anchor to the closed group** rather than vanishing — an arrow that
disappeared would read as "this connection was deleted". Both ends in the same
folded frame means it is internal, so it goes.

### Canvas text blocks are Tiptap, and `content` changed MEANING not format

A canvas text block was a textarea holding markdown; it is now the full note
editor. The whole difficulty is that a canvas is **one JSON blob** in
`vault_content`, so the block's stored shape is read by older builds.

⚠️ **`content` must stay a readable string.** An older Mac or iPad build renders
it in a textarea *and saves it back* — raw ProseMirror JSON there is data loss on
the next save, not a display glitch. So the block gained fields instead:

| field | what |
|---|---|
| `rich` | the Tiptap document, same JSON form `vault_content` holds |
| `md` | the ORIGINAL markdown, written once at conversion, **never overwritten** |
| `content` | now a plain-text **projection** of `rich` — degraded, not corrupt |

An unknown *field* on a JSON blob is carried or dropped, never fatal — unlike an
unknown ProseMirror *node type*, which blanks a document. Same asymmetry that
made `shareId` an attribute.

**`lib/mdToHtml.ts` is deliberately partial**, and `md` is what makes that a
trade rather than a loss: an unsupported construct arrives as literal text with
the source still on the block. Two bugs its tests caught:

- It emitted `<h5>`/`<h6>`. `FoldableHeading` is configured `levels: [1,2,3,4]`
  and **`levels` is a schema option** — unrecognised tags silently become
  paragraphs, so the heading turns into body text with no error. Levels are
  clamped to `MAX_HEADING`.
- `a * b * c` in prose became italics. Guarding the character *after* the closing
  star does not help — there it is a space and passes. Emphasis may not open or
  close on whitespace, which is the actual markdown rule.

**Two canvas-specific traps.** Key events are stopped at the block: the canvas
listens on its container and Delete removes the *selected block*, so without it
Backspace in a paragraph deletes the block you are typing into. And the editor is
**uncontrolled after mount, keyed by block id** — feeding the projection back in
as `content` is a loop that moves the caret to the end on every keystroke.

### Shared containers: an attribute, not a node type

Any callout, container or toggle can carry a `shareId`, making it the **same
block** in more than one note, editable from either side. Content lives in its
own `vault_content` row, `share:{id}` — the idiom already used for `{id}_annot`
and `{id}_margins`.

⚠️ **`shareId` is an ATTRIBUTE and that is the whole design.** ProseMirror drops
an unknown attribute and *blanks the document* on an unknown node type. A
`sharedBlock` node would have required deploying Mac and iPad before anyone could
create one — and would have wiped notes if that order slipped. As an attribute, a
note holding a shared block opens fine on an older build and merely does not
sync. It also makes **copy-paste the linking mechanism**: the attribute travels
through the HTML clipboard, and the same id in two documents *is* the link. No
registry to fall out of step with the notes. The round-trip test is the
high-value one — a renderHTML/parseHTML mismatch is invisible to `tsc`.

**The blocks stay in each note as well as in the row.** That duplication is the
point: the note remains self-contained, renders offline, exports whole, and a
failed share read degrades to "you see your last copy" rather than a hole. On
open the **row wins**; a missing row is **seeded from the note**, which makes
sharing an existing block a no-op rather than a wipe.

**Live propagation is a PING, not a payload.** A save announces on a Realtime
channel per share; every other holder re-reads the row. Sending the content
would inherit Realtime's payload ceiling — the same one the CRDT provider works
around with `onReloadRequest` — and a shared block has no size limit of its own,
so sync would break silently once a block grew past the cap.

⚠️ **The sender id is explicit; `self: false` is not trusted.** Two notes side by
side in one window are one Supabase client on one socket, and `self` is
client-granular rather than per channel instance — relying on it risks
suppressing exactly the delivery the feature exists for.

⚠️ **Announce AFTER the row is written.** Announcing first races: a peer that
re-reads in between fetches the old content, records it as seen, and then
ignores the real change as "already have it".

The subscription is keyed on the SET of share ids, not the document —
re-subscribing per transaction would rebuild a channel per keystroke and leave
windows where an announcement lands on no listener.

⚠️ **The write loop.** Apply → transaction → save → write back what was just
received. Two independent guards, because either alone has a hole: the apply
path marks its transaction and the save path skips it (precise, but only knows
about transactions this code produced); and every write is gated on the payload
actually differing from what was last seen (covers unmarked transactions).

Three rules with tests named after them: `parseShare` returns **null, never
`[]`**, for an unusable read — `[]` legitimately means "the shared block is
empty", and returning it for a failure would clear every copy and save that. An
**empty block is never seeded** (`block+` cannot be childless, so empty is one
empty paragraph, and seeding from it publishes emptiness). Shares are **keyed by
id, not position** — the same share may appear twice in one note.

**Off under live co-editing.** The Y.Doc is already authoritative for the whole
document; a second mechanism replacing ranges inside it is two writers on one
buffer with no ordering between them.

`useSharedBlocks` lives in `lib/`, not `collab/`: NoteEditor imports `collab/` as
**types only** to keep yjs out of the eager note bundle, and this is a value
import. `schemaPath.test.ts` asserts it rather than trusting the comment.
### ⚠️ A colour round trip cannot be asserted in this repo

**happy-dom's `CSSStyleDeclaration` silently drops any value it cannot parse,
and it cannot parse `oklch()` or `var()`.** Hex, `rgb()` and named colours
survive; measured, with a test pinning it in `extensions/typography.test.ts`.

Tiptap's Color mark serialises to `style="color: …"` and parses back out of
`element.style.color`, so **every one of Vault's colours round-trips to `""` in
tests** while working correctly in every browser that ships oklch — which is all
of them. No production impact, but it is a blind spot in exactly the test
category that is otherwise the highest-value one here.

The direct consequence: **do not store `var(--token, …)` as a mark colour** so
that text colours follow the theme. It is untestable by the same mechanism, and
the failure mode is every coloured span silently losing its colour on reload.

**Text colours are tuned to a lightness band instead** (`TEXT_COLOR_L`, asserted).
A colour mark stores a literal in the document and cannot follow the theme, so
at L≈0.62 it sits ~0.38 from a white page and ~0.48 from the dark theme's
surface — legible against both. The band is asserted so nobody "improves" a
colour back to a light-theme-only value. Documents written before the retune keep
their old literals.

**Fonts are system stacks, never webfonts.** Vault runs in a Tauri WebView, as a
Vercel page and as an iPad PWA: a webfont is either megabytes in every build or a
CDN call the offline story dislikes. `FontFamily` is an **attribute** on the
TextStyle mark, like Color and FontSize, so a note using it opens on an older
build in the default face — a new mark type would not be safe that way.

**The bubble renders every bubble action flat in one row** and is the iPad's only
formatting surface. There is a test capping its length; adding more colours or
faces needs the bubble to group or collapse first.

### The colour scheme is derived, not stored

`lib/theme.ts` turns **six numbers** into every `:root` colour token. A theme
could have been 62 stored token values — that is what "custom colour scheme"
usually means, and it is a trap: every token added to `:root` afterwards is one
every stored theme lacks, so themes rot silently as the app grows. A derived
theme has no such surface.

It only works because the palette is **OKLCH**. Lightness there is perceptual, so
"one step darker" is a subtraction that means the same thing at every hue; the
same arithmetic in hex or HSL gives an uneven ramp whose contrast depends on hue.

⚠️ **No theme can make text unreadable, by construction.** Foregrounds move away
from the surface and the direction flips at `DARK_BELOW = 0.5`. Because that
threshold is the **midpoint** of the range, the far end is never closer than
~0.48 from either side. A user dragging a lightness slider passes through "text
the same colour as the background"; an app that renders that state has lost its
own settings panel. Tests sweep the whole range.

⚠️ **The direction flip is what makes dark mode work rather than merely be
dark.** On a dark surface "raised" must be *lighter* — otherwise every input and
border is darker than a page that is already nearly black, i.e. invisible.

**`MIN_TEXT_DL` is an assertion, not the mechanism.** Making it the mechanism put
the default theme's black body text at a mid grey: 0.34 is the floor of
legibility, nowhere near where body text sits. `TEXT_DL` is a table of distances
that reproduces the existing palette **exactly** at the default — the engine must
be a no-op against the stylesheet it replaces, or shipping it invalidates every
colour judgement made so far. Pinned by a test.

**Two things a theme may not do.** Recolour a semantic accent — a delete button
that is not red because you chose a green scheme is a theme changing what a
control *means*; only their lightness follows the surface. And touch motion,
z-index or shadow geometry, which are not colours and whose change would be a
theme that can break layout.

**130 colour literals still sit outside `:root`** and do not follow a theme —
that is where a dark scheme shows seams. `cssTokens.test.ts` ratchets the count
so it can only fall; naming them is a design decision per colour, not a cleanup.

Stored in **localStorage, per device**. A Mac in a lit room and an iPad in bed
want different schemes, so per-account would be the wrong shape, not a better one.

### One icon set, and a test that refuses the mixed state

`extensions/icons.tsx` — every icon a 24×24 path in `currentColor`, stroke 1.75,
round caps. At 14px, stroke weight is most of what the eye compares, and it is
the one property a Unicode glyph gives you no control over.

It replaced **51 distinct Unicode strings across 55 actions**: box drawing,
arrows, emoji (which render in *colour* and at a different weight), mathematical
alphanumerics (three fonts in one row), and short strings pretending to be glyphs
(`⤒row`, `−col`).

⚠️ **Three were ambiguous, not merely inconsistent** — the same symbol for two
different things, all three found by the coverage test rather than by eye:
`⌄` was both "fold this heading" and "unfold everything"; inline text size and
per-note text size shared three icons; and `unsetHighlight` shared the
highlighter with "apply this highlighter". Opposite actions on one glyph.

`iconCoverage.test.ts` fails on any two actions sharing an icon unless they are
in a **declared family** (card colours, text colours, faces, code languages —
where the swatch or the face *is* the differentiator). It also fails on a **stale
exemption**, which is the hole the next collision walks through, and it builds
the registry with **every gated action present** — `buildBlockRegistry({})` omits
link, database, image, both maths and the highlighters, and a coverage test that
skips most of what it covers is worse than none.

**`ActionIcon` is the one place any surface draws an icon.** There are four —
toolbar buttons, toolbar menus, the bubble, the slash list — and each
interpolated `a.icon` itself, which is how the set drifted: an action added with
a glyph looked fine in the one surface its author was looking at. The legacy
`icon` string is still the fallback, but the test asserts nothing reaches it: one
glyph among sixty SVGs is *more* obviously wrong than sixty inconsistent glyphs.

⚠️ **Size is a prop, never a class.** These sit in a 13px button, a menu row and
the slash list; an icon inheriting `font-size` from three places is three sizes.

### The calendar, and the tray that answers the timeline's omission

`calendar` is a fifth `view` on `pathfinderBlock`: a month grid over the same
filtered tasks. Grid maths is pure in `lib/calendarGrid.ts`, reusing
`timeline.ts`'s day arithmetic — two date implementations in one app eventually
disagree, and the disagreement shows as an entry one column out.

**The tray is the point.** The timeline must omit undated work; a footer count
is honest but not actionable. Dragging from the tray onto a day schedules the
task, and it leaves the tray because it now has a date. The two views are one
loop.

**What the gestures may and may not do:** dragging a scheduled chip MOVES its
`pf_cal_blocks` row (a second insert would leave a copy on every day the drag
visited); × deletes the calendar block and ⚠️ **never the task** — taking work
off a day is not deciding not to do it; and a **due-date chip is not draggable
at all**, because a due date is a property of the task and dragging it would
silently rewrite a deadline while looking like a reschedule.

⚠️ **Two weekday conventions live one function apart.** `pf_recurring_cal_blocks`
numbers weekdays **0=Sunday** and is explicitly not ISO; the grid draws
**Monday-first**. `weekdayOfDay` returns the database's number, `columnOfDay` the
drawing column. Using one where the other belongs shifts everything a day.

`loadScheduledBlocks` is the single loader for both time views — it carries block
ids so the calendar can edit what the timeline only reads. `scheduleTask` /
`moveBlockToDay` / `unscheduleBlock` are separate from `createBlock` /
`updateBlock`, which are the calendar editor's full form and deliberately omit
`date`.

### The timeline: dates come from data, and undated work is counted not placed

`timeline` is a fourth `view` value on `pathfinderBlock` — an attribute, so no
deploy-everywhere gate — showing dated work at month / 3-month / year zoom.
Date maths is pure in `lib/timeline.ts`.

⚠️ **A task with no date has NO POSITION.** 384 of 554 tasks are undated;
parking them at today would assert deadlines nobody set. They are partitioned
out and counted in the footer. Absent is not zero, again.

**Extent comes from data.** A bar spans real scheduled calendar days; a due date
alone is a single-day marker, drawn dashed so a point never reads as a duration.
`time_estimate` is deliberately NOT used for width — an estimate is how long the
work takes, not which days it occupies.

⚠️ **Recurring series are excluded.** `pf_recurring_cal_blocks` is open-ended, so
at year zoom every weekly series would paint a solid bar across the whole axis.

Two bugs its tests caught before anything rendered:

- **`Date.UTC(2026, 12, 1)` does not fail — it rolls over into January 2027.** So
  "2026-13-01" parsed to a finite index twelve months from where it claimed to
  be. `isIsoDate` validates by ROUND TRIP, which also catches "2026-02-30".
- **Epoch day 0 was a Thursday** and `getUTCDay()` numbers Sunday 0, so Monday is
  `(d + 4) % 7 === 1`. Writing `=== 0` put every week rule on Sunday — off by one
  column the whole way across, and it looks almost right.

**Scroll position is a DAY, not a pixel offset.** Converting pixels between
scales is how a zoom control jumps you to a different month.

### What a card's colour means is a choice, and "no value" has no colour

`spec.colorBy` — tag / priority / urgency / assignee — puts a stripe on every
board card and list row. A board already shows status as columns and order as
position; colour is the one free channel left, so what it *says* is worth
choosing rather than spending on decoration.

⚠️ **A task the dimension says nothing about gets NO stripe.** A grey "unset"
colour would read as a real category — "the grey ones" — and the board would
quietly grow a group that does not exist. Absent is not zero, again.

⚠️ **The priority/urgency scale moves in LIGHTNESS as well as hue, and a test
pins the separation.** Red / amber / green at one lightness is the classic
deuteranopia failure: first and last are the same stripe. Moving in L means the
order survives with no colour vision, and the test stops a later "nicer colours"
pass quietly undoing it.

**Assignee hues are derived from the id on the golden angle**, not configured —
a palette is one more thing to maintain, and a new teammate would have no colour
until someone assigned them one. Their lightness is asserted into the same band
the text palette uses, so a stripe reads on both themes.

Three smaller rules: **one stripe per card** (the first tag with a colour, never
a blend — a blend is a fourth colour in no legend); **`assigned_to` is
meaningless when `team_id` is null**, so a personal task gets nothing, and `all`
is the absence of an assignee rather than a person; and **every stripe carries a
title saying what it means**, because a colour cannot be read back into a label.

`lib/cardColor.ts` reaches `@nexus/core/pathfinder`, and `lib/pathfinderBlock.ts`
is on the note schema path — so only the option list and the type are imported
there. `schemaPath.test.ts` covers it.

### Summary figures share the column pipeline, deliberately

A stat card is compile-once → evaluate-per-row → aggregate, the same chain a
computed column runs, reduced to one number. Sharing it buys two things that a
separate implementation would lose:

- **A stat works in list and board view**, where there is nowhere to put a
  column. It needs no column because it is one figure.
- **A stat and a column can never disagree** about what `sum(estimate)` means.
  Two implementations of the same arithmetic drift; this one cannot.

The editor shares the vocabulary for the same reason — one formula language,
not two. `none` is the single difference: a stat IS an aggregate, so a card
carrying it would have no figure to show, and `STAT_AGGS` omits it.

⚠️ **Statistics are over the tasks the block is SHOWING**, not over everything
that matched. That is the honest reading of a figure sitting on a filtered list,
but it means tightening a filter changes every number — so each card states how
many rows contributed rather than implying it measured the whole plan.

`percent` scales its bar against 100, not the card's `max`: a percent card with
`max: 8` would otherwise read 12.5% full at 100%.

### Meters: an empty bar is not zero

A computed column can draw itself as a bar or a ring (`display`, `max`). One
mechanism covers both "custom" and "premade" measures, because a premade one —
`subtasksDone / subtasks * 100` — was always expressible; only the drawing was
missing.

⚠️ **A null value renders as a dash, never as an empty meter.** An empty bar is
indistinguishable from 0%, so a task with no estimate would read as "0% done"
rather than "not measured". This is the same rule `aggregate` follows by
skipping nulls and `coerceField` by returning null for an empty stored value —
three places now, one idea: *absent is not zero*.

**The number stays beside the meter.** A bar is a comparison and cannot say
"130% of target"; the value is clamped for drawing, so replacing the number with
the bar would silently lose the overshoot. Clamped rather than overflowing,
because a bar longer than its track escapes the cell.

**A scale of zero is "no scale", not "full".** It yields null and the cell falls
back to the number, rather than dividing into the Infinity the formula language
already refuses — same for `max: "auto"` when every visible row is null.

⚠️ **Auto scales to what is ON SCREEN**, so filtering the table changes every bar
in it. Occasionally what you want, never what you expect: 100 is the default and
auto is opt-in.

The ring's radius is `100/2π`, so its circumference is exactly 100 units and the
dash array *is* the percentage — no arithmetic to get subtly wrong at the wrap.

### Stored columns: the definition is in the note, the values are in Postgres

A custom column is two halves, and which half holds what is the whole design.
The **definition** — key, label, type — lives in the block spec, in the note.
The **values** live in `vault_task_fields`, keyed `(user_id, task_id, key)`.

That split makes the type a **lens rather than a constraint**: the value column
is `text` for every type, so changing a column from number to text and back
loses nothing, and two notes may legitimately show `budget` as a number and as
free text without either being wrong. A typed column in Postgres would have to
pick a winner and would need a data migration on every type change.

**The key IS the storage key**, so it is normalised the way tags are — a key
differing only by case or spacing would be a second column that looks exactly
like the first, with the values split silently between them. Two consequences
that are easy to get wrong:

- **The collision check must compare NORMALISED names.** `subtasksDone`
  normalises to `subtasksdone`, so checking a normalised key against the raw
  built-in list let a column named "subtasksDone" through — sitting in the
  field list one character from the built-in, with nothing to say which a
  formula meant. `RESERVED_FIELD_KEYS` is the normalised set; a test walks
  every built-in name.
- **Removing a column from a block does not delete its values.** The same key
  is very often a column in another note. Deleting everywhere is a separate,
  explicit act (`deleteTaskFieldEverywhere`), and the × is labelled "hide"
  rather than "delete" for that reason.

**A stored number column is a name a formula reads** — that is why the two
shipped together. `formulaFieldNames(fields)` extends the built-ins with the
block's numeric and check keys, so `budget * 1.25` compiles. Text columns are
deliberately **absent**: binding one would make every formula reading it
silently blank instead of failing with a named error, and renaming a column
must turn a formula into a legible error rather than an empty cell.

⚠️ **An absent value binds as `null`, never 0 or false.** A task nobody has
given a budget has no budget: `sum(budget)` over ten tasks where two have one
must be the sum of two, and `avg` must divide by two. This is the same rule
`aggregate` already implements for nulls, and the reason `coerceField` returns
null for every empty string regardless of type. A cleared cell **deletes** the
row rather than storing `""`, so the cache and the server agree on what "no
value" is — otherwise a formula reads a different number either side of a
reload.

**A missing table is a state of its own.** Before the migration is applied the
block hides its stored columns entirely rather than drawing every task blank:
"unavailable" and "nobody has filled this in" must not look the same. Same
posture as tags, and the same reason `blocking_state` is not seeded.

**`lib/taskFields.ts` is the pure half and `lib/vaultTaskFields.ts` is the
query half**, and the split is not tidiness — `lib/pathfinderBlock.ts` is on the
note SCHEMA path, and a Supabase import there would make "is this note safe to
open?" depend on a configured network client. `lib/schemaPath.test.ts` walks the
import graph and asserts it rather than trusting it.

### The table: column order is the ARRAY order

⚠️ **`parseSpec` must not sort `spec.columns`.** It used to, and that single call
is what made column placement unstorable: a hand-ordered table snapped back to
canonical order on the very next load, so the feature could be built and would
still appear not to work. `strArray` already validates and dedupes while
preserving order, so the stored array *is* the order.

The property the sort was really providing — "toggling a column off and on again
does not move it" — has not been dropped. It moved to `withColumn`, which
inserts at the canonical position **relative to the columns already shown**.
Appending instead would mean one stray double-click silently rearranged the
table. `defaultSpec` still seeds canonically; there are tests for both halves.

`spec.colWeights` are **weights**, not pixels and not percentages. Pixels are
wrong the moment the note changes width or opens on the iPad (same reasoning as
`metaPct`), and stored percentages stop summing to 100 the moment a column is
added or removed — so they would need renormalising on every toggle, and any bug
in that renormalisation is a table that slowly drifts off its container. Weights
normalise at render time. `columnWidths` folds the actions column into the same
total rather than giving it a fixed px width: mixing px and % under
`table-layout: fixed` leaves the browser to reconcile them, which is how a table
ends up wider than its scroll container on one platform only.

`table-layout: fixed` is what makes the `<colgroup>` percentages authoritative —
under `auto` a width is a suggestion and the browser sizes from content, so a
dragged column springs back as soon as a long title arrives. Fixed layout will
not grow a cell to fit, so `th`/`td` need explicit `overflow: hidden;
text-overflow: ellipsis` or text spills across the boundary.

Reorder is **pointer-based, not HTML5 drag-and-drop**: the table lives inside a
ProseMirror node view, where a native `dragstart` competes with the editor's own
drag handling — the same reason `BlockHandle` is hand-rolled. Sorting therefore
happens on pointer-*up* when the press never reached another column; an
additional `onClick` would fire after a reorder and sort by whatever was dropped.

### The list row: opt-out chips, and the title yields LAST

⚠️ **`.pf-meta` is shrinkable and `.pf-list-title` has a floor.** It was the other
way round — `title { flex: 1 1 auto; min-width: 0 }` against `meta { flex: none }`
— so the chips took whatever they wanted and the title absorbed the entire
deficit. In a note-width column that rendered "Living Room" as one letter per
line while the same plan name and the same "Unassigned" sat comfortably beside it
on all 27 rows. The title is the content; it is the last thing that gives way,
and the chips ellipsise first (`.pf-meta > * { min-width: 0 }` is what makes
`text-overflow` actually engage inside a flex row).

The list also honours `spec.columns` now, where it used to render every chip
unconditionally. `LIST_COLUMNS` is deliberately narrower than `PF_COLUMNS` —
`urgency` and `stage` have nowhere to go in a line of text, and a switch that
does nothing is worse than no switch. `tags` stays on its own `showTags` flag
rather than joining `columns`: two switches for one chip is how they end up
disagreeing. The spec is shared across views on purpose, so a table-only column
survives being invisible in the list rather than being dropped.

**Existing blocks change appearance on first load.** `DEFAULT_COLUMNS` is
`done, title, plan, priority, due`, so the assignee and estimate chips go away
until switched back on. That is the intended migration — the complaint was that
the block insisted on showing everything — and the picker is now shown for lists,
not just tables.

`spec.metaPct` is the dragged title/metadata split, **as a percentage**. Not
pixels: a note is 720 px to full-bleed depending on `NoteDocument`'s per-note
width and the same note opens on an iPad, so a pixel width would be right on the
screen it was dragged on and wrong everywhere else — the same reasoning that puts
sketch coordinates in a 1000-unit logical space. 0 means auto. The grip writes a
CSS variable straight to the DOM on pointermove and commits ONE transaction on
release; a transaction per move would be ~60 document rewrites a second, each
waking the note's 400 ms autosave.

On a coarse pointer the grip is a short handle at the TOP of the list, not a
full-height rule. Permanently visible (no hover to reveal it), a full-height
stripe would sit over every row beneath it and swallow taps meant for tasks.

The slash menu offers **three** blocks — *Task list*, *Task board*, *Task table* —
that read and write PathFinder's `pf_tasks` live, from inside a note. They are
**one** ProseMirror node type, `pathfinderBlock`, carrying a `view` attribute.

That is the data-loss rule, not tidiness. An unknown **node type** does not
degrade: `createNodeFromContent` catches ProseMirror's throw, returns an EMPTY
document, and the 400 ms autosave writes that blank over the note. An unknown
**attribute** is dropped in silence, because `Node.fromJSON` iterates the
*type's* declared attributes and never looks for extras. Three node types would
be three deploy-everywhere gates and three chances to blank a note; one means a
fourth view (timeline, gallery) later costs nothing, and switching an existing
block between views is a one-attribute edit. It is still a new node type — deploy
web, Mac and iPad (`npm run ios:vault`) before creating a note containing one.

**The data layer is `packages/nexus-core/src/pathfinder/`, reached through the
`@nexus/core/pathfinder` deep alias** (not the barrel — that pulls in three.js).
It exists because three hand-written copies of the `pf_tasks` read already
existed when it was added, and the newest of them
(`apps/NexusLocal/src/lib/pathfinder/api.ts`) had already dropped the
`pf_task_planning` embed, so every task it renders reads as default urgency and
stage. Three invariants live in application code, not the database, and each
fails silently when another app writes the tables directly:

- **`stage = 'active'` is gated on scheduled calendar minutes.** Only `setStage`
  enforces it. A card dragged to "active" with a raw UPDATE defeats the one rule
  the lifecycle exists for. The board surfaces the refusal instead of swallowing it.
- **A flat patch must be SPLIT across relations** — `urgency`/`stage` live on
  `pf_task_planning`; writing them onto `pf_tasks` does not error, it just does
  nothing.
- **`task_type` is generated and `aggregate_estimate` is trigger-maintained.**

**Team-shared tasks work**, and needed explicit support: every read is broadened
with the same `user_id.eq.…,team_id.in.(…)` `.or()` fragment PathFinder's
`getTeamOrFilter` uses, or a task a teammate shared is simply absent —
indistinguishable from not existing. `isTaskRelevantToMe` is copied verbatim
from PathFinder's `lib/team.ts`: unclaimed (`null`) and everyone-assigned
(`"all"`) team work is *mine*, and only a concrete other uid narrows it. If that
rule drifts, a Vault block and PathFinder's dashboard disagree about whose work
something is. Boards can group by assignee and reassign by drag; the
`__unassigned__` column maps to `null`, never to its own key.

Two rules the node view must keep:

- **Data never touches the document.** Refetches, checkboxes and card drags
  dispatch no transaction; only a CONFIG change calls `updateAttributes`.
  Otherwise every poll wakes the note's autosave — the 2026-08-15 incident's shape.
- **The NODE may only import something that imports nothing heavier than React
  and Tiptap.** `extensions/PathfinderBlock.ts` points at
  `components/PathfinderBlockLazy.tsx`, which dynamic-imports the real view.
  Importing it directly would drag `lib/supabase.ts` (a module-scope
  `createClient`) into the schema graph, so `noteSchemaGuard` — whose job is to
  run when things are broken — would need a configured network client.

One shared store (`lib/pathfinderStore.ts`) backs every block in the app, so N
blocks in a note make one round trip and a tick in the list moves the card on the
board above it. `signedOut`, `loading` and `error` are states distinct from
"ready with zero rows": `pf_tasks` is `auth.uid()`-scoped, so a session-less read
returns an **empty set, not an error**, and rendering that as "All done ✓" is the
same lie as an "Inbox zero" panel that has never run.

### Hierarchy: the tree is built over the MATCHED set

`pf_tasks` is recursive — a task's steps are tasks with steps of their own — and
the list and table render that with indentation, a disclosure triangle and a
`3/12` roll-up. The nesting rules are pure and live in
`packages/nexus-core/src/pathfinder/tree.ts`, tested there.

A filter and a hierarchy disagree by nature: "open tasks" matches a step whose
parent is done. So **every matched task is re-parented to its nearest matched
ancestor**, and a step whose parent was filtered out is promoted to a root rather
than vanishing. Two invariants fall out, and both have tests: every matched task
appears exactly once, and no unmatched task appears — except under `tree: "full"`,
which is the mode that asks for whole subtrees.

Four things that are easy to get wrong here:

- **The counts come from the whole dataset, not the tree.** A row saying "3/12"
  means three of the task's twelve real descendants are done, whatever the filter
  hides. Same choice `aggregate_estimate` makes server-side, for the same reason:
  a roll-up that changes when you change a view is not a roll-up.
- **The flatten is depth-first so the LIMIT is safe.** A prefix of a depth-first
  walk always contains a row's parent; slicing any other order produces an
  indented row whose parent was cut off above it.
- **Both walks are cycle-guarded.** Nothing in `pf_tasks` stops an UPDATE making
  a task its own grandparent, and a hierarchy view is where that first shows up.
  A cycle must render as a truncated branch, not a hung tab.
- **Expand/collapse is React state, never a document attribute.** It is on the
  DATA side of the "data never touches the document" line: persisting it would
  put one undo step and one autosave behind every triangle.

The board ignores `tree` entirely and shows a roll-up chip instead — a card
cannot contain a card, and honouring the axis there would make a list→board
switch silently change which tasks the block contains.

### Vault-only tags: `vault_task_tags`, and the module split that protects the schema

Tags on tasks that exist **only in Vault** — PathFinder never sees them, and on a
team-shared task each person has their own set, which falls out of the table
being keyed `(user_id, task_id, tag)` rather than being a column on `pf_tasks`.
Migration `20260827140000_vault_task_tags.sql`; `user_id` is TEXT with an
`auth.uid()::text` policy and **no anon policy**, matching `vault_tag_colors`.
Colours are shared with note tags, so one word is one colour across Vault.

⚠️ **`lib/taskTags.ts` (pure) and `lib/vaultTaskTags.ts` (queries) are two files
on purpose, and merging them breaks the schema guard.** `lib/pathfinderBlock.ts`
needs `normalizeTagList` and the `TagMode` domain to parse a block's spec, and
that file is part of the note SCHEMA — `noteSchemaGuard` builds the schema before
any editor exists. One module holding both halves puts `lib/supabase.ts`'s
module-scope `createClient` on that path, and it throws `supabaseUrl is required`
wherever Vite's env is absent. This is the `PathfinderBlockLazy` rule again,
one layer down; it was hit and fixed during the hierarchy work.

Two more, both about not lying when the table isn't there yet:

- **A missing `vault_task_tags` must not take the task blocks down with it.** The
  migration is applied by hand and separately from any deploy, so a build running
  before it lands is normal. `loadTaskTags` reports a missing relation as
  `available: false` rather than throwing, and the store catches anything else —
  a naive read inside the snapshot's `Promise.all` would reject the whole thing
  and every block would read "Couldn't load tasks". That is the `pf_reminders`
  incident with the roles reversed.
- **`activeFilterCount`/`isUnfiltered` in `@nexus/core` cannot see Vault's tags.**
  Use `specFilterCount`/`specIsUnfiltered`/`clearedSpec` from
  `lib/pathfinderBlock.ts`, or a tag-filtered block shows no badge, says "No open
  tasks", and offers a Clear button that clears everything except the thing
  actually hiding the rows.

`spec.tags`, `tagMode`, `untaggedOnly`, `tree` and `showTags` are all
**attributes**, which is why they could ship without a deploy-everywhere gate —
an older client drops what it doesn't know and the note is fine. `untaggedOnly`
is a hard gate rather than another AND-ed clause: "untagged AND tagged #reading"
matches nothing, and a filter that can be configured into matching nothing reads
as broken.

The tag filter reaches `runQuery`/`runTreeQuery` as their `extra` predicate,
which runs **before** the limit. Filtering after the cap would let a block render
an empty list while matching rows sat just past the window.

### `vitest.config.ts` REPLACES `vite.config.ts` — repeat the aliases

Vitest prefers `vitest.config.ts` when both exist and does not merge them, so
every `resolve.alias` has to be repeated there. Without them `@nexus/core/*`
falls through to Node resolution, which follows the `node_modules/@nexus/core`
workspace **symlink** — and that points at the primary checkout, not at the tree
the test is running in. A git worktree therefore tests against a different copy
of nexus-core than it compiles against, and the symptom is a resolution error
with no obvious link to the change: `Missing "./pathfinder" specifier in
"@nexus/core" package`. (Vault's `.env` is gitignored and lives only in the
primary checkout too; copy it into a worktree or every test importing
`lib/api.ts` fails with `supabaseUrl is required`.)

