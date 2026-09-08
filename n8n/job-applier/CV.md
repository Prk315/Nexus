# The modular CV

The letter has been modular since phase 2. The CV was not: one static
`cv_2026.tex` behind one `cv_link` URL, so a game studio and a data team
received byte-identical documents while the letters travelling with them were
tailored to the ad. The CV was the least personalised artefact in a pipeline
built entirely around personalising things.

```
job_cv_entries ──> assembleCv(entries, {skills, lang, budget}) ──> renderLatex ──> pdflatex ──> cv.pdf
                                                              └──> renderHtml  ──> cv.html
```

| File | What |
|---|---|
| `cv-entries.js` | **the catalog — source of truth.** Verbatim from `JobSearch/cv_2026.tex` |
| `cv.js` | selection, ordering, LaTeX and HTML renderers — pure, 22 tests |
| `cv.test.js` | `node --test cv.test.js` |
| `cv-build.mjs` | CLI: writes a tailored `.tex` / `.html`, and `--pdf` compiles it |
| `cv-seed.mjs` | generates `cv-entries.seed.sql`; `--check` fails if it is stale |
| `cv-entries.seed.sql` | **generated — do not hand-edit** |
| `../../supabase/migrations/20260908120000_job_cv_entries.sql` | the table |

```bash
node --test cv.test.js && node cv-seed.mjs --check

node cv-build.mjs                                        # unranked — the base CV
node cv-build.mjs --skills "unreal,gamedev,c++" --pdf    # a game studio
node cv-build.mjs --skills "postgres,etl,sql" --budget work=2
```

## The rule this is held to

**With nothing to rank on, the assembled CV is the existing CV.** The same
entries, in the same order, with the same words. Relevance may REORDER and,
under an explicit budget, TRIM. It may never rewrite, merge, summarise or
generate a single word.

That is the same discipline the Vault colour work was held to ("no rendered
colour may move"): a refactor that changes the artefact is not a refactor, and
shipping one would invalidate every judgement made about the document so far.

It is verified rather than asserted. `cv.test.js` carries a list of facts copied
by hand out of `cv_2026.tex` — deliberately not derived from `cv-entries.js`,
which would make the test circular — and asserts each appears in both rendered
formats. Against `pdflatex` the generated CV is **1 page, no warnings, no
overfull boxes, 92,995 bytes** where the original is 95,657.

## Why not more rows in `job_app_modules`

It is the obvious first idea and it is wrong twice, both times silently.

- **The letter would eat them.** `assembleApplication` concatenates the
  `content` of every chosen module into the draft body. `KNOWN_SLOTS` bounds the
  vocabulary, but `knownSlotsOnly` deliberately unions it with *whatever slots
  the catalog actually uses* — so the moment a `cv_experience` row exists,
  `cv_experience` is a slot the model may ask for, and a CV line could be pasted
  into the middle of a cover letter. Nothing would error.
- **The prompt would grow.** `action: "pending"` returns every enabled module to
  the model and `MAX_CATALOG` is 60. CV entries would crowd the catalog the
  model chooses body paragraphs from — the same crowding-out that `KNOWN_SLOTS`
  was introduced to stop.

And a CV entry wants structure where a letter module wants prose. "Instructor —
High Performance Programming and Systems, University of Copenhagen, 2026 –
Present" stored as one string means every renderer re-parses it, and they will
eventually disagree.

## Two deliberate departures from the letter's design

### A CV has no gap markers

`assembleApplication` writes `[GAP: no module for 'skill']` into a letter, and
`bodyHasUnresolvedGaps` refuses to send one containing it. That is right for a
letter: a letter is prose making an argument, and a hole the reader cannot see
is exactly the plausible-and-wrong failure this pipeline is built against.

A CV is a list. A section with nothing in it is a shorter CV, not a dishonest
one — nobody reads a CV and infers that an absent "Publications" heading was
suppressed. Writing `[GAP: …]` into one would be absurd, and it would travel
into a PDF that reaches a company.

So omissions are returned as **data** (`omitted` on the result, printed by
`cv-build.mjs`) and never as text in the document.

### Contact, profile and education survive every budget

`ALWAYS_KEPT`. A CV that loses its degree to a tag-overlap heuristic is worse
than one that was never tailored. Contact details and a degree are facts about
the person, not claims aimed at an ad.

`pinned` is the finer-grained version for entries inside an otherwise rankable
section — `skills_languages` carries it, so a graphics-heavy ad cannot push the
languages line below the engines line.

## Tags

`tags` is the only thing relevance matches on, using the same whole-token rule
as the letter (`cvTagOverlap` / `cvTokens`) — the rule that stops `ai` matching
inside "available", and that keeps `c++` and `c#` intact.

⚠️ **An entry is never tagged with a technology its own text does not mention.**
A tag is what makes an entry reachable, so a tag that overstates is precisely
how an ad for something he has not done surfaces an entry implying he has. The
tags in `cv-entries.js` were each derived from the entry's own words.

A multi-word tag is all-or-nothing: `computer vision` needs both tokens present.

## Editing

`cv-entries.js` is the source of truth, unlike `MODULES.md`, whose header
explains at length that the *database* became authoritative for letter modules
and the committed seed rotted into a historical document.

That is why this seed is `on conflict … do update` where `modules.seed.sql` is
`do nothing`: these rows are generated from a committed file, so re-running must
reconcile the table with the repo rather than silently no-op.

```bash
# edit cv-entries.js, then:
node --test cv.test.js && node cv-seed.mjs
# apply the migration once, then the seed, via supabase/migrations/APPLY.md
```

⚠️ `cv-seed.mjs` **refuses to generate** if any value contains the `$cv$`
dollar-quote delimiter. That failure would not be a syntax error — the string
would end early and the remainder would parse as SQL.

## Publishing — this is what actually unblocks sending

Generating a CV does not host one, and hosting is the live blocker.

`cvGateReady` is guard 4 of `planApplyQueue`: while no **enabled** `cv_link`
module holds content that is not a `[TODO` stub, every application is skipped
with `cv_missing`. The `cv_link` text points at
`prk315.github.io/personal-website/cv.pdf`.

⚠️ **That URL already resolves.** Checked live on 2026-09-08: HTTP 200,
`application/pdf`, 85,693 bytes, `last-modified` 7 Sep — added to the site repo
by commit `0e8da61` and printed from a browser rather than typeset. Earlier
notes in this repo (including a previous version of this section) said it 404s.
They were reading a **stale local checkout** of `personal-website` whose `main`
was one commit behind origin, which is exactly the shape of mistake that ends in
overwriting somebody's file.

Two consequences worth being explicit about:

- **The hosting blocker is already gone.** Enabling `cv_link` no longer waits on
  anything being published. It waits only on the decision to open the send path.
- **Publishing is now a REPLACEMENT.** Check what is live before pushing over it.

So the order is:

1. `curl -I https://prk315.github.io/personal-website/cv.pdf` — see what is
   there now, and when it changed.
2. `git -C ~/Repositories/personal-website fetch` **before branching.** The
   local checkout goes stale, and a branch cut from a stale `main` turns a
   replacement into an apparent addition.
3. Build the copy that goes on the web:
   `node cv-build.mjs --public --out cv --pdf` — see §The public copy.
4. Copy it in as `cv.pdf`, commit on a branch, open a PR, merge, and **wait for
   Pages to deploy**.
5. Open the URL and confirm it resolves to the document you meant.
6. Only then enable the `cv_link` module.

## The public copy

`--public` drops every contact detail marked `private` in the catalog. Today
that is the phone number, and the reason is a real distinction rather than
squeamishness: a number emailed to a named employer is a disclosure to one
company, and a number on a GitHub Pages file is permanent, indexed and
harvested. The direct builds — the ones a human attaches to an application or
uploads to an ATS — keep it.

⚠️ The filter **clones** rather than mutating: `CV_ENTRIES` is a module-level
constant shared by every build in the process, so filtering it in place would
strip the phone from the *next* build too, and only on runs where a public build
happened to come first. There is a test named after that.

⚠️ **Step 4 is the act that opens the send path**, and step 3 is not optional.
A live gate pointing at a 404 is worse than a closed one: the letter quotes the
URL, so an employer follows a dead link in an application that presents it as
the candidate's CV.

⚠️ **A per-posting CV cannot go in `cv_link` as things stand.** That module holds
one URL for every application. Serving a different CV per posting needs a
per-application URL — a storage bucket with public read, or a file per
application in the site repo — and neither exists yet. Until it does, the
tailored builds are for the ATS lane, where a human uploads the file by hand and
`notify.js` already lays the decision email out as an apply kit.
