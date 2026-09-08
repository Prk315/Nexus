/**
 * The CV catalog — canonical source.
 *
 * ⚠️ **Every string in this file is lifted verbatim from
 * `JobSearch/cv_2026.tex` (1 Sep 2026).** Nothing here was written by a model,
 * summarised, re-phrased or extrapolated. That is the same rule the letter
 * modules are held to, and it matters more here rather than less: a CV is read
 * as a record of fact, so a sentence nobody wrote is not a stylistic problem but
 * a false claim with his name on it.
 *
 * The only additions are `tags`, `sort` and `pinned` — metadata *about* the
 * entries, used to decide which ones a given posting sees. Tags are derived from
 * what an entry already says. An entry is never tagged with a technology its own
 * text does not mention, because a tag is what makes the entry reachable, and a
 * tag that overstates is how an ad for something he has not done pulls up an
 * entry claiming he has.
 *
 * `cv-seed.mjs` generates the SQL for `job_cv_entries` from this file, and
 * `cv.test.js` reads it directly. One source, so the seed and the tests cannot
 * disagree about what the CV says.
 *
 * ## Where the em dashes come from
 *
 * `cv_2026.tex` writes `---`; this file stores the real character. The LaTeX
 * renderer emits it as-is and `inputenc utf8` handles it, so the typeset result
 * is identical and the HTML renderer gets correct text instead of three hyphens.
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
        { icon: "phone", text: "+45 42 66 08 98" },
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
      "Machine learning and data science student who builds systems end to end and runs them in production — on my own hardware, for myself, every day. Rust and TypeScript across a six-application ecosystem on one Postgres backend; local LLM inference as infrastructure rather than demo; reinforcement learning for game entities exported into Unreal. I care about the failure modes that only show up once something is actually running.",
    bullets: [
      "Looking for: a team to build something worth building — games, real-time systems, or applied AI",
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
      "Custom Rust simulation and training loop; quadrupedal rig learns locomotion via RL",
      "Trained policies exported into Unreal — built pipeline-first, so the crossing is reproducible",
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
      "Six interconnected desktop/mobile apps on one Postgres schema (~100 tables), one component library, one IPC layer — built solo, used daily",
      "RLS scoped to auth.uid(), forward-only migrations, trigger-maintained invariants; native iOS app with WidgetKit widgets and a background macOS daemon",
      "Real-time 3D graph view (three.js / react-three-fiber) with custom physics forces and live IPC-driven node state",
      "Local LLM pipelines (Ollama + Qwen via n8n) doing production classification and extraction; models return checkable verdicts, never final prose",
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
      "Every concept across every course topologically sorted into a dependency DAG, generating linearised learning paths and a retention schedule — targeting recall, not just first exposure",
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
      "Software and hardware augmentation, designed probabilistic-first: state is a distribution, sensor readings update belief",
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
    bullets: ["Teach performance-oriented systems programming to undergraduates"],
    tags: ["teaching", "systems", "performance", "hpc", "c"],
    sort: 10,
  },
  {
    name: "exp_armed_forces",
    section: "experience",
    title: "Engineer Company — Conscription",
    org: "Danish Armed Forces",
    dates: "2022 – 2023",
    bullets: [
      "Executed under pressure in resource-constrained environments; adapted to plans that stopped matching reality on contact",
    ],
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
