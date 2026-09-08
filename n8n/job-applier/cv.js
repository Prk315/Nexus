/**
 * The modular CV — selection, ordering and rendering.
 *
 * Pure, dependency-free, and shaped like `evaluate.js` and `extract.js` so it can
 * be inlined into an n8n Code node by a build step if it ever needs to run there.
 * Today it runs from `cv-build.mjs` and from tests.
 *
 * # Why this exists
 *
 * The letter has been modular since phase 2: a human writes paragraphs, a local
 * model picks which ones fit an ad, and the edge function concatenates them
 * verbatim. The CV was not. It was one static LaTeX file behind one `cv_link`
 * URL, so a game studio and a data-engineering team received byte-identical
 * documents while the letters that travelled with them were tailored. The CV was
 * the least personalised artefact in a pipeline built entirely around
 * personalising it.
 *
 * # The rule this file is held to
 *
 * **With nothing to filter on, `assembleCv` must reproduce the existing CV
 * exactly.** Not approximately — the same entries, in the same order, with the
 * same words. Relevance may REORDER and, under an explicit budget, TRIM. It may
 * never rewrite, merge, summarise or generate. `cv.test.js` pins the full
 * rendered output against the real catalog for exactly this reason.
 *
 * That is the same discipline the Vault colour work was held to ("no rendered
 * colour may move"): a refactor that changes the artefact is not a refactor, and
 * shipping it would invalidate every judgement made about the document so far.
 *
 * # Why a CV has no gap markers, unlike a letter
 *
 * `assembleApplication` writes `[GAP: no module for 'skill']` into the body, and
 * `bodyHasUnresolvedGaps` refuses to send a letter containing one. That is right
 * for a letter: a letter is prose, it makes an argument, and a hole in the
 * argument that the reader cannot see is exactly the plausible-and-wrong failure
 * this pipeline is built against.
 *
 * A CV is a list. A section with nothing in it is a shorter CV, not a dishonest
 * one — nobody reads a CV and infers that the absent "Publications" heading was
 * suppressed. Writing `[GAP: ...]` into a CV would be absurd, and worse, the
 * marker would then travel into a PDF that goes to a company.
 *
 * So omissions are reported as DATA (`omitted` on the result) for whoever is
 * reviewing, and never as text in the document. Same principle as everywhere
 * else here — a missing thing must be visibly missing — applied to the surface
 * that can actually act on it.
 */

// MARK: - Shape

/**
 * Section order in the rendered document. Fixed, not data: "contact goes at the
 * top" and "skills go near the bottom" are properties of a CV, not of a number
 * someone typed into a row — the same argument `SLOT_RANK` makes for the letter.
 */
export const CV_SECTIONS = ["contact", "profile", "work", "experience", "education", "skills"];

/** Human headings. `contact` renders as the header block and has no heading. */
export const SECTION_HEADINGS = {
  profile: "Profile",
  work: "Current Work",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
};

/**
 * Sections whose entries are never dropped, whatever the ad says.
 *
 * A CV without contact details is not a tailored CV, it is a broken one, and a
 * degree is a fact about the person rather than a claim aimed at a posting.
 * Marking them here rather than relying on every caller passing a budget is the
 * difference between a rule and a convention.
 */
export const ALWAYS_KEPT = new Set(["contact", "profile", "education"]);

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const sectionOf = (e) => str(e?.section).toLowerCase();

/**
 * The tie-break every ordering step falls back to: `(sort, name, id)`.
 *
 * Total, not merely sorted — two entries with the same `sort` would otherwise
 * land in whatever order Postgres felt like returning them, and a CV whose
 * projects shuffle between builds is not reviewable. Same function as
 * `byAssemblyOrder` in `evaluate.js`, kept separate because this file must stay
 * import-free.
 */
export function byCvOrder(a, b) {
  const sa = Number.isFinite(Number(a?.sort)) ? Number(a.sort) : 0;
  const sb = Number.isFinite(Number(b?.sort)) ? Number(b.sort) : 0;
  if (sa !== sb) return sa - sb;
  const na = str(a?.name);
  const nb = str(b?.name);
  if (na !== nb) return na < nb ? -1 : 1;
  const ia = str(a?.id);
  const ib = str(b?.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Split skills into comparable tokens. Whole tokens, never substrings.
 *
 * Identical rule to `skillTokens` in `evaluate.js` and `logic.ts`, and for the
 * identical reason: phase 1 shipped a gate that matched `ai` inside "available"
 * and passed a chef as an AI engineer. `\b` does not help, because it fails
 * immediately after `+` and `#`, which `c++` and `c#` both end with.
 */
export function cvTokens(values) {
  const out = new Set();
  for (const v of arr(values)) {
    for (const t of str(v)
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .trim()
      .split(/\s+/)) {
      if (t) out.add(t);
    }
  }
  return out;
}

/** How many of an entry's tags are evidenced by the posting's skills. */
export function cvTagOverlap(entry, tokens) {
  let hits = 0;
  for (const tag of arr(entry?.tags)) {
    const parts = str(tag)
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length > 0 && parts.every((p) => tokens.has(p))) hits++;
  }
  return hits;
}

// MARK: - Assembly

/**
 * Build the CV for one posting.
 *
 * @param {Array<object>} entries  the catalog, as stored in `job_cv_entries`
 * @param {object} opts
 * @param {Array<string>} [opts.skills]  matched + required skills from the verdict
 * @param {string} [opts.lang]           'en' | 'da'
 * @param {Record<string, number>} [opts.budget]  max entries per section
 * @returns {{sections: Array<{section: string, heading: string, entries: object[]}>,
 *            included: string[], omitted: Array<{section: string, name: string, reason: string}>,
 *            ranked: boolean}}
 *
 * ## Ordering
 *
 * Within a section, entries sort by relevance descending and then by
 * `(sort, name, id)`. With no tokens every overlap is 0, so the comparison
 * collapses to `(sort, name, id)` alone and the catalog's own order survives
 * untouched — which is what makes "reproduces the current CV exactly" a
 * property that falls out of the design rather than a special case in it.
 *
 * ## Trimming
 *
 * Only under an explicit `budget`, and never for a section in `ALWAYS_KEPT`.
 * The default is no budget: a CV that already fits on a page should not start
 * losing entries because a model returned a short skills list. Whatever a budget
 * removes is reported in `omitted`, so the reviewer sees what this build chose
 * not to show rather than wondering what happened to a project.
 */
export function assembleCv(entries, opts = {}) {
  const tokens = cvTokens(opts.skills);
  const lang = opts.lang ? str(opts.lang).toLowerCase() : null;
  const budget = opts.budget && typeof opts.budget === "object" ? opts.budget : {};

  const usable = arr(entries).filter((e) => e && e.enabled !== false && sectionOf(e));

  const sections = [];
  const included = [];
  const omitted = [];

  for (const section of CV_SECTIONS) {
    let pool = usable.filter((e) => sectionOf(e) === section);

    // Language, on the same rule the letter's framing uses: prefer the ad's
    // language, else English, else take whatever exists. An entry with no `lang`
    // counts as English.
    const inLang = (want) => pool.filter((e) => str(e?.lang || "en").toLowerCase() === want);
    if (pool.length > 0) {
      const wanted = lang ? inLang(lang) : [];
      const english = inLang("en");
      pool = wanted.length > 0 ? wanted : english.length > 0 ? english : pool;
    }

    const ranked = pool.slice().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const oa = cvTagOverlap(a, tokens);
      const ob = cvTagOverlap(b, tokens);
      if (oa !== ob) return ob - oa;
      return byCvOrder(a, b);
    });

    const cap = Number.isFinite(Number(budget[section])) ? Number(budget[section]) : Infinity;
    const keep = ALWAYS_KEPT.has(section) ? ranked : ranked.slice(0, Math.max(0, cap));

    for (const e of ranked.slice(keep.length)) {
      omitted.push({ section, name: str(e.name), reason: "budget" });
    }
    if (keep.length === 0) continue;

    sections.push({ section, heading: SECTION_HEADINGS[section] ?? "", entries: keep });
    for (const e of keep) included.push(str(e.name));
  }

  return { sections, included, omitted, ranked: tokens.size > 0 };
}

// MARK: - Rendering
//
// Two renderers over one assembled structure. LaTeX is what produces the PDF a
// company receives; HTML is what makes a build reviewable without a TeX
// toolchain, and is what can be hosted. They must agree on CONTENT — the tests
// assert that every included entry's text appears in both — but not on layout.

/**
 * Escape a string for LaTeX.
 *
 * ⚠️ Every value here originates in a database row that a human typed, and one
 * of the real entries genuinely contains `F#`. An unescaped `#` is a macro
 * parameter and `_` is a subscript: both fail the build with an error pointing
 * at a line that looks fine. Backslash must be replaced first, or the
 * replacements would escape each other's output.
 */
export function escapeLatex(value) {
  // ⚠️ The backslash cannot simply be replaced first. Its replacement
  // (`\textbackslash{}`) CONTAINS braces, and the brace pass that follows would
  // escape them — turning one backslash into `\textbackslash\{\}`, which
  // typesets as literal text. It goes to a sentinel and comes back last.
  return str(value)
    .replace(/\\/g, " BS ")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/ BS /g, "\\textbackslash{}");
}

/** Escape a string for HTML. */
export function escapeHtml(value) {
  return str(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const links = (entry) => arr(entry?.data?.links).filter((l) => l && str(l.label));

/**
 * The contact line, as `{icon, label, url}` cells.
 *
 * Reads `data.items` when present and otherwise falls back to the flat
 * `org`/`meta`/`status` columns, so a row written before icons existed still
 * renders its details rather than dropping them.
 */
const contactItems = (entry) => {
  const items = arr(entry?.data?.items)
    .filter((i) => i && str(i.text))
    .map((i) => ({ icon: i.icon, label: i.text, url: i.url }));
  if (items.length > 0) return items;
  return [entry?.org, entry?.meta, entry?.status]
    .map(str)
    .filter(Boolean)
    .map((text) => ({ label: text }));
};

/**
 * The LaTeX preamble.
 *
 * Copied verbatim from `JobSearch/cv_2026.tex` rather than rewritten, so a
 * generated CV is typographically identical to the one that already exists —
 * same class, same geometry, same rules under the headings, same macros. If the
 * document should look different, that is a change to make deliberately and
 * once, here.
 */
export const LATEX_PREAMBLE = String.raw`\documentclass[10pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{charter}
\usepackage[top=0.4in, bottom=0.4in, left=0.5in, right=0.5in]{geometry}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{xcolor}
\usepackage{fontawesome5}
\usepackage{parskip}

\definecolor{primary}{RGB}{26,26,26}
\definecolor{accent}{RGB}{64,64,64}
\definecolor{subtle}{RGB}{100,100,100}

\hypersetup{
    colorlinks=true,
    linkcolor=primary,
    urlcolor=accent
}

\titleformat{\section}{\normalsize\bfseries\color{primary}}{}{0em}{\uppercase}[\vspace{-0.6em}\textcolor{accent}{\rule{\linewidth}{0.4pt}}]
\titlespacing*{\section}{0pt}{6pt}{3pt}

\pagenumbering{gobble}

\setlist[itemize]{leftmargin=1.2em, nosep, topsep=1pt, itemsep=0pt}

\newcommand{\cventry}[4]{
    \textbf{#1} \hfill \textcolor{subtle}{#2} \\[-2pt]
    \textit{\textcolor{accent}{#3}} \hfill \textit{\textcolor{subtle}{#4}}
}

\newcommand{\projectentry}[2]{
    \textbf{#1} \hfill \textcolor{subtle}{\small #2}
}
`;

const latexBullets = (entry) => {
  const bullets = arr(entry?.bullets).map((b) => str(b)).filter(Boolean);
  if (bullets.length === 0) return "";
  const items = bullets.map((b) => `    \\item ${escapeLatex(b)}`).join("\n");
  return `\\begin{itemize}\n${items}\n\\end{itemize}\n`;
};

/** Render one assembled CV as a complete LaTeX document. */
export function renderLatex(cv, opts = {}) {
  const out = [LATEX_PREAMBLE, "\\begin{document}\n"];

  for (const { section, heading, entries } of cv.sections) {
    if (section === "contact") {
      for (const e of entries) {
        const parts = [
          "\\begin{center}",
          `    {\\LARGE\\bfseries ${escapeLatex(e.title)}}`,
          "    \\vspace{3pt}\n",
        ];
        const row = (cells) =>
          cells
            .map((c) => {
              const label = escapeLatex(c.label);
              const body = str(c.url) ? `\\href{${str(c.url)}}{${label}}` : label;
              return str(c.icon) ? `\\faIcon{${str(c.icon)}} ${body}` : body;
            })
            .join(" \\quad ");

        const items = contactItems(e);
        if (items.length > 0) {
          parts.push(`    \\textcolor{accent}{${row(items)}}`);
          parts.push("    \\vspace{1pt}\n");
        }
        const ls = links(e);
        if (ls.length > 0) parts.push(`    \\textcolor{accent}{${row(ls)}}`);
        parts.push("\\end{center}\n");
        out.push(parts.join("\n"));
      }
      continue;
    }

    out.push(`%${"-".repeat(70)}\n\\section{${heading}}`);

    // Prose sections are one block of lines, not a sequence of entries. They are
    // joined with `\\` and the LAST line carries none: a `\\` immediately before
    // `\section` is the classic "There's no line here to end" error, and it
    // would only appear once a build happened to put such a section last.
    if (section === "profile" || section === "skills") {
      const lines = [];
      for (const e of entries) {
        const head = [];
        if (str(e.title)) head.push(`\\textbf{${escapeLatex(e.title)}:} `);
        if (str(e.meta)) head.push(escapeLatex(e.meta));
        if (head.length > 0) lines.push(head.join(""));
        for (const b of arr(e.bullets)) {
          if (str(b)) lines.push(`\\textcolor{subtle}{\\small ${escapeLatex(b)}}`);
        }
      }
      if (lines.length > 0) out.push(`${lines.join(" \\\\\n")}\n`);
      continue;
    }

    entries.forEach((e, i) => {
      if (i > 0) out.push("\\vspace{2pt}\n");
      const title = escapeLatex(e.title);

      if (section === "work") {
        out.push(`\\projectentry{${title}}{${escapeLatex(e.meta)}}`);
      } else {
        out.push(
          `\\cventry{${title}}{${escapeLatex(e.dates)}}{${escapeLatex(e.org)}}{${escapeLatex(e.status)}}`,
        );
      }
      const b = latexBullets(e);
      if (b) out.push(b);
    });
  }

  if (str(opts.footer)) {
    out.push(
      `\\vspace{2pt}\n\\begin{center}\n\\textcolor{subtle}{\\small ${escapeLatex(opts.footer)}}\n\\end{center}\n`,
    );
  }

  out.push("\\end{document}");
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/**
 * Render one assembled CV as a self-contained HTML page.
 *
 * Self-contained on purpose: no stylesheet link, no font host, no script. This
 * file is what gets opened for review and what could be hosted next to the PDF,
 * and a CV that depends on a CDN is a CV that renders wrong the first time it is
 * opened somewhere without one.
 */
export function renderHtml(cv, opts = {}) {
  const title = escapeHtml(opts.title ?? "CV");
  const body = [];

  for (const { section, heading, entries } of cv.sections) {
    if (section === "contact") {
      for (const e of entries) {
        // The icon names are fontawesome identifiers. This page is deliberately
        // self-contained, so it renders the labels alone rather than pulling in
        // an icon font from a CDN for decoration.
        const row = (cells) =>
          cells
            .map((c) =>
              str(c.url)
                ? `<a href="${escapeHtml(c.url)}">${escapeHtml(c.label)}</a>`
                : escapeHtml(c.label),
            )
            .join(" &middot; ");

        body.push(`<header>`);
        body.push(`<h1>${escapeHtml(e.title)}</h1>`);
        const items = contactItems(e);
        if (items.length > 0) body.push(`<p class="meta">${row(items)}</p>`);
        const ls = links(e);
        if (ls.length > 0) body.push(`<p class="meta">${row(ls)}</p>`);
        body.push(`</header>`);
      }
      continue;
    }

    body.push(`<section><h2>${escapeHtml(heading)}</h2>`);
    for (const e of entries) {
      body.push(`<article>`);
      const head = [];
      if (str(e.title)) head.push(`<strong>${escapeHtml(e.title)}</strong>`);
      if (str(e.dates)) head.push(`<span class="dates">${escapeHtml(e.dates)}</span>`);
      if (head.length > 0) body.push(`<p class="row">${head.join("")}</p>`);
      const sub = [e.org, e.meta, e.status].map(str).filter(Boolean);
      if (sub.length > 0) body.push(`<p class="sub">${sub.map(escapeHtml).join(" &middot; ")}</p>`);
      const bullets = arr(e.bullets).map(str).filter(Boolean);
      if (bullets.length > 0) {
        body.push(`<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`);
      }
      body.push(`</article>`);
    }
    body.push(`</section>`);
  }

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --ink:#1a1a1a; --accent:#404040; --subtle:#646464; --rule:#d8d8d8; }
  * { box-sizing: border-box; }
  body { margin:0 auto; padding:2.5rem 1.5rem; max-width:52rem; color:var(--ink);
         background:#fff; font:15px/1.5 Charter, Georgia, "Times New Roman", serif; }
  header { text-align:center; margin-bottom:1.25rem; }
  h1 { font-size:1.9rem; margin:0 0 .35rem; letter-spacing:.01em; }
  h2 { font-size:.95rem; text-transform:uppercase; letter-spacing:.06em;
       margin:1.5rem 0 .1rem; padding-bottom:.25rem; border-bottom:1px solid var(--rule); }
  p { margin:.15rem 0; }
  .meta { color:var(--accent); font-size:.9rem; }
  .row { display:flex; justify-content:space-between; gap:1rem; align-items:baseline; }
  .dates { color:var(--subtle); font-size:.85rem; white-space:nowrap; }
  .sub { color:var(--accent); font-style:italic; font-size:.9rem; }
  article { margin:.6rem 0; }
  ul { margin:.2rem 0 0; padding-left:1.1rem; }
  li { margin:.1rem 0; }
  a { color:var(--accent); }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e8e8e8; --accent:#b4b4b4; --subtle:#8c8c8c; --rule:#3a3a3a; }
    body { background:#141414; }
  }
  @media print { body { padding:0; max-width:none; } }
</style>
${body.join("\n")}
</html>
`;
}
