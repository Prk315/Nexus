// Shared KaTeX macros + options for every math render surface in Vault.
// This module must stay dependency-free (no katex import) so it can be
// pulled into any lazy chunk without dragging the library along.

export const KATEX_MACROS: Record<string, string> = {
  // Number sets
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
  "\\F": "\\mathbb{F}",
  // Calculus / misc symbols
  "\\dd": "\\mathrm{d}",
  "\\e": "\\mathrm{e}",
  "\\eps": "\\varepsilon",
  // Delimiters
  "\\abs{#1}": "\\left|#1\\right|",
  "\\norm{#1}": "\\left\\lVert#1\\right\\rVert",
  "\\inner{#1}{#2}": "\\left\\langle#1,#2\\right\\rangle",
  "\\set{#1}": "\\left\\{#1\\right\\}",
  "\\ceil{#1}": "\\left\\lceil#1\\right\\rceil",
  "\\floor{#1}": "\\left\\lfloor#1\\right\\rfloor",
  // Linear algebra
  "\\T": "^{\\intercal}",
  "\\inv": "^{-1}",
  "\\rank": "\\operatorname{rank}",
  "\\tr": "\\operatorname{tr}",
  "\\diag": "\\operatorname{diag}",
  "\\Span": "\\operatorname{span}",
  "\\proj": "\\operatorname{proj}",
  // Probability / statistics
  "\\E": "\\mathbb{E}",
  "\\Var": "\\operatorname{Var}",
  "\\Cov": "\\operatorname{Cov}",
  // Optimization
  "\\argmin": "\\operatorname*{argmin}",
  "\\argmax": "\\operatorname*{argmax}",
};

export const KATEX_OPTS = {
  throwOnError: false,
  strict: "ignore",
  macros: KATEX_MACROS,
} as const;
