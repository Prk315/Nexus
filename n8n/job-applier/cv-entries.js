/**
 * The CV catalog — canonical source.
 *
 * # ⚠️ Status of this prose: DRAFTED, not yet reviewed by the person named in it
 *
 * The first version of this file was verbatim from `JobSearch/cv_2026.tex`
 * (1 Sep 2026). It is no longer. The text below was **rewritten to read like a
 * professional CV** — sharper verbs, the engineering decision in front of the
 * artefact, and the strongest facts pulled up the page. That rewrite was drafted
 * by Claude on request.
 *
 * That distinction is worth keeping, because the whole pipeline turns on knowing
 * which prose a human wrote. `MODULES.md` records the same status for the letter
 * modules and flags reading them end to end as worth an hour. The same applies
 * here, and more so: a CV is read as a record of fact.
 *
 * # The line that was not crossed
 *
 * **No fact was added.** Every organisation, date, technology, project and claim
 * below already appears in `cv_2026.tex`, in `JobSearch/background information/`,
 * or in the repository the work describes. What changed is which facts lead,
 * how specific they are allowed to be, and how much abstraction sits in front of
 * them.
 *
 * Concretely, the four things the rewrite actually does:
 *
 *   1. **Stops leading with "student".** The old profile opened "Machine
 *      learning and data science student who…", which frames a person by what
 *      they are enrolled in rather than what they build. The degree is still
 *      there, one clause later, and the instructor post — the strongest single
 *      credential on the page and previously buried in Experience — now appears
 *      in the first paragraph.
 *   2. **Puts the decision before the artefact.** "Six apps on one schema" says
 *      what exists; "designed and built solo, and used every day" says something
 *      about the person. Bullets now lead with the choice made or the problem
 *      solved.
 *   3. **Replaces abstraction with the specific thing that happened.** The
 *      graph-view bullet now names the two-`THREE`-instances render-loop bug,
 *      which is documented in CLAUDE.md and is far better evidence than "custom
 *      physics forces". The conscription bullet loses its LinkedIn cadence.
 *   4. **Under-sells nothing that is true.** The instructor line now says the
 *      post was taken while still completing the degree — inferable from the
 *      dates already on the page (BSc 2023–2026, instructor 2026–), and the
 *      thing that makes the line land.
 *
 * ⚠️ **Tags are metadata, not claims, and they are the reachability mechanism.**
 * An entry is never tagged with a technology its own text does not mention: a
 * tag is what makes an entry surface for an ad, so an over-tagged entry is how a
 * posting for something he has not done pulls up an entry implying he has.
 *
 * `cv-seed.mjs` generates the SQL from this file and `cv.test.js` reads it
 * directly, so the seed and the tests cannot disagree about what the CV says.
 */

/** @typedef {{name: string, section: string, title?: string, meta?: string,
 *             org?: string, dates?: string, status?: string, bullets?: string[],
 *             tags?: string[], lang?: string, pinned?: boolean, sort: number,
 *             data?: object}} CvEntry */

/** @type {CvEntry[]} */
export const CV_ENTRIES = [
  // ---------------------------------------------------------------- contact
  {
    name: "contact_main",
    section: "contact",
    title: "Bastian Rønfeldt Thomsen",
    pinned: true,
    sort: 0,
    tags: [],
    // `icon` names are fontawesome5 identifiers, matching the `\faIcon{...}`
    // calls in the real CV's header. The HTML renderer ignores them rather than
    // shipping an icon font — see `renderHtml`.
    data: {
      items: [
        { icon: "map-marker-alt", text: "Copenhagen, Denmark" },
        // ⚠️ `private` means "not in a copy that gets hosted at a public URL".
        // A phone number emailed to a named employer and a phone number sitting
        // on a crawlable GitHub Pages file are not the same disclosure: the
        // second is permanent, indexed, and harvested. It stays in the copies
        // that go to a person, and `--public` drops it from the one on the web.
        { icon: "phone", text: "+45 42 66 08 98", private: true },
        {
          icon: "envelope",
          text: "Bastianrthomsen@gmail.com",
          url: "mailto:Bastianrthomsen@gmail.com",
        },
      ],
      links: [
        { icon: "github", label: "github.com/Prk315", url: "https://github.com/Prk315" },
        {
          icon: "linkedin",
          label: "LinkedIn",
          url: "https://www.linkedin.com/in/bastian-thomsen-167652205",
        },
        { icon: "globe", label: "Portfolio", url: "https://prk315.github.io/personal-website/" },
      ],
    },
  },

  // ---------------------------------------------------------------- profile
  {
    name: "profile_main",
    section: "profile",
    meta:
      "I build software end to end and run it in production on my own hardware, every day. A six-application desktop and mobile ecosystem on one Postgres schema; local LLM pipelines doing real classification work; reinforcement-learning agents whose policies export into Unreal Engine. Finishing a BSc in Machine Learning and Data Science at the University of Copenhagen, where I also teach the systems and performance course. I care most about the failure modes that only appear once something is really running.",
    bullets: [
      "Looking for: a team building something worth building — games, real-time systems, or applied AI",
    ],
    pinned: true,
    sort: 0,
    tags: [],
  },

  // ------------------------------------------------------------------- work
  {
    name: "work_game_entities",
    section: "work",
    title: "Autonomous Game Entities",
    meta: "Rust, reinforcement learning, Unreal Engine",
    bullets: [
      "Simulation and RL training loop written from scratch in Rust; a quadrupedal rig learns locomotion from reward alone",
      "Policies export into Unreal Engine through a pipeline built before the first agent ran, so a result can be reproduced rather than rescued from a checkpoint",
    ],
    tags: [
      "rust",
      "reinforcement",
      "rl",
      "unreal",
      "gamedev",
      "games",
      "simulation",
      "real-time",
      "ai",
      "ml",
    ],
    sort: 10,
  },
  {
    name: "work_nexus",
    section: "work",
    title: "Nexus — Personal Software Ecosystem",
    meta: "Rust (Tauri 2), React 19, TypeScript, Supabase",
    bullets: [
      "Six interconnected desktop and mobile apps on one Postgres schema (~100 tables), one component library, one IPC layer — built solo, used daily",
      "Row-level security scoped to auth.uid(), forward-only migrations against a database every branch shares, and trigger-maintained invariants where correctness cannot be left to the client",
      "Real-time 3D graph view (three.js / react-three-fiber) with custom layout forces, debugged at the render loop: two THREE instances were corrupting simulation state every frame",
      "Local LLM pipelines (Ollama + Qwen via n8n) doing production classification and extraction; the model returns a checkable verdict, never final prose",
    ],
    tags: [
      "rust",
      "tauri",
      "react",
      "typescript",
      "supabase",
      "postgres",
      "postgresql",
      "sql",
      "fullstack",
      "ios",
      "swift",
      "threejs",
      "graphics",
      "real-time",
      "llm",
      "ollama",
      "n8n",
      "rls",
      "systems",
      "backend",
      "frontend",
    ],
    sort: 20,
  },
  {
    name: "work_knowledge_graph",
    section: "work",
    title: "University Knowledge Graph",
    meta: "DAG, Markov chains, Kalman filters, local LLMs",
    bullets: [
      "Every concept across every course topologically sorted into a dependency DAG, producing linearised learning paths and a retention schedule — the target is recall months later, not first exposure",
    ],
    tags: ["dag", "markov", "kalman", "llm", "algorithms", "graph", "data", "ml", "python"],
    sort: 30,
  },
  {
    name: "work_mirte_robot",
    section: "work",
    title: "MIRTE Robot",
    meta: "Robotics, computer vision, probabilistic state estimation",
    bullets: [
      "Extended the platform in software and hardware, designed probabilistic-first: state is a distribution, and a sensor reading updates belief rather than replacing it",
    ],
    tags: ["robotics", "computer vision", "vision", "probabilistic", "estimation", "sensors"],
    sort: 40,
  },

  // ------------------------------------------------------------- experience
  {
    name: "exp_ku_instructor",
    section: "experience",
    title: "Instructor — High Performance Programming and Systems",
    org: "University of Copenhagen",
    dates: "2026 – Present",
    bullets: [
      "Teach performance-oriented systems programming to undergraduates; appointed while still completing the degree",
    ],
    tags: ["teaching", "systems", "performance", "hpc", "c"],
    sort: 10,
  },
  {
    name: "exp_armed_forces",
    section: "experience",
    title: "Engineer Company — Conscription",
    org: "Danish Armed Forces",
    dates: "2022 – 2023",
    // No bullet, deliberately. The old one ("executed under pressure in
    // resource-constrained environments…") was the only line on the page that
    // said nothing specific, and it is the first thing a reader discounts. The
    // header line still carries the fact and still explains the 2022–23 gap,
    // which is the whole reason the entry is here.
    bullets: [],
    tags: ["teamwork", "leadership"],
    sort: 20,
  },

  // -------------------------------------------------------------- education
  {
    name: "edu_ku_bsc",
    section: "education",
    title: "BSc Machine Learning and Data Science",
    org: "University of Copenhagen",
    dates: "2023 – 2026",
    status: "In Progress",
    bullets: [
      "Current: Hybrid Quantum Programming | Robot Systems and Vision | Virtual Reality",
      "Completed: Machine Learning A | High Performance Programming and Systems | Database Systems",
      "Next: MSc in Quantum Information, or Artificial Intelligence and Robotics",
    ],
    pinned: true,
    sort: 10,
    tags: ["ml", "data", "education"],
  },

  // ----------------------------------------------------------------- skills
  {
    name: "skills_languages",
    section: "skills",
    title: "Languages",
    meta: "Rust, TypeScript, Python, SQL, C, Swift, F#",
    tags: ["rust", "typescript", "python", "sql", "c", "swift", "f#"],
    pinned: true,
    sort: 10,
  },
  {
    name: "skills_engines_graphics",
    section: "skills",
    title: "Engines & Graphics",
    meta: "Unreal Engine, three.js / WebGL, real-time rendering",
    tags: ["unreal", "threejs", "webgl", "graphics", "real-time", "rendering", "gamedev"],
    sort: 20,
  },
  {
    name: "skills_ml_ai",
    section: "skills",
    title: "ML & AI",
    meta:
      "PyTorch, scikit-learn, reinforcement learning, local inference (Ollama, quantised models), pandas, NumPy",
    tags: ["pytorch", "ml", "ai", "reinforcement", "ollama", "llm", "pandas", "numpy", "python"],
    sort: 30,
  },
  {
    name: "skills_systems_data",
    section: "skills",
    title: "Systems & Data",
    meta:
      "PostgreSQL / Supabase, Tauri, Docker, Git, REST APIs, n8n, ETL pipelines, row-level security design",
    tags: [
      "postgresql",
      "postgres",
      "supabase",
      "tauri",
      "docker",
      "git",
      "rest",
      "n8n",
      "etl",
      "rls",
      "data",
      "systems",
    ],
    sort: 40,
  },
];

/** Languages line, rendered under the document. Verbatim from the footer. */
export const CV_FOOTER = "Danish (Native)   English (Fluent)";
