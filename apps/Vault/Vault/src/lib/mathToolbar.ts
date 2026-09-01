// The math toolbar's vocabulary, and the handle it needs to reach the field.
//
// Pure except for the registry, which is deliberately module-scope for the same
// reason `pathfinderHosts.ts` is: the toolbar and the node view are in different
// React trees — the toolbar sits above the editor, the field lives inside a node
// view — so there is no common ancestor to hang context on without lifting the
// whole editor's state up.
//
// ── Why a toolbar row replaced a dialog ────────────────────────────────────
//
// Editing used to open a modal over the page. That is wrong for a document
// editor in a way that is easy to state: you cannot see the sentence the
// equation belongs to while you write it. Maths is written *about* something,
// and a modal hides the something. The row costs one strip of vertical space
// and keeps the page underneath exactly as it was.

/** What the toolbar can put into a field. `latex` is inserted at the caret;
 *  `#?` is MathLive's placeholder, so the caret lands inside the first hole. */
export interface MathSymbol {
  /** Rendered on the button. LaTeX, drawn with KaTeX. */
  preview: string;
  latex: string;
  label: string;
}

export interface MathGroup {
  id: string;
  label: string;
  items: MathSymbol[];
}

/**
 * Grouped so the row can show one group at a time rather than eighty buttons.
 *
 * The contents are the constructs that are genuinely awkward to type and
 * common in this vault's notes (linear algebra, probability, analysis) — not a
 * complete symbol table. A palette nobody can scan is the same failure as the
 * bubble menu's flat row, and a complete one would be exactly that.
 */
export const MATH_GROUPS: MathGroup[] = [
  {
    id: "basic",
    label: "Basic",
    items: [
      { preview: "\\frac{a}{b}", latex: "\\frac{#?}{#?}", label: "Fraction" },
      { preview: "x^{n}", latex: "^{#?}", label: "Superscript" },
      { preview: "x_{n}", latex: "_{#?}", label: "Subscript" },
      { preview: "\\sqrt{x}", latex: "\\sqrt{#?}", label: "Square root" },
      { preview: "\\sqrt[n]{x}", latex: "\\sqrt[#?]{#?}", label: "Nth root" },
      { preview: "\\left(x\\right)", latex: "\\left(#?\\right)", label: "Parentheses" },
      { preview: "\\left|x\\right|", latex: "\\left|#?\\right|", label: "Absolute value" },
      { preview: "\\pm", latex: "\\pm", label: "Plus-minus" },
      { preview: "\\cdot", latex: "\\cdot", label: "Dot product" },
      { preview: "\\times", latex: "\\times", label: "Times" },
    ],
  },
  {
    id: "relations",
    label: "Relations",
    items: [
      { preview: "\\neq", latex: "\\neq", label: "Not equal" },
      { preview: "\\leq", latex: "\\leq", label: "Less or equal" },
      { preview: "\\geq", latex: "\\geq", label: "Greater or equal" },
      { preview: "\\approx", latex: "\\approx", label: "Approximately" },
      { preview: "\\equiv", latex: "\\equiv", label: "Equivalent" },
      { preview: "\\propto", latex: "\\propto", label: "Proportional" },
      { preview: "\\in", latex: "\\in", label: "Element of" },
      { preview: "\\subseteq", latex: "\\subseteq", label: "Subset" },
      { preview: "\\to", latex: "\\to", label: "To" },
      { preview: "\\mapsto", latex: "\\mapsto", label: "Maps to" },
    ],
  },
  {
    id: "greek",
    label: "Greek",
    items: [
      { preview: "\\alpha", latex: "\\alpha", label: "alpha" },
      { preview: "\\beta", latex: "\\beta", label: "beta" },
      { preview: "\\gamma", latex: "\\gamma", label: "gamma" },
      { preview: "\\delta", latex: "\\delta", label: "delta" },
      { preview: "\\varepsilon", latex: "\\varepsilon", label: "epsilon" },
      { preview: "\\theta", latex: "\\theta", label: "theta" },
      { preview: "\\lambda", latex: "\\lambda", label: "lambda" },
      { preview: "\\mu", latex: "\\mu", label: "mu" },
      { preview: "\\sigma", latex: "\\sigma", label: "sigma" },
      { preview: "\\varphi", latex: "\\varphi", label: "phi" },
      { preview: "\\omega", latex: "\\omega", label: "omega" },
      { preview: "\\Sigma", latex: "\\Sigma", label: "Sigma" },
      { preview: "\\Delta", latex: "\\Delta", label: "Delta" },
      { preview: "\\Omega", latex: "\\Omega", label: "Omega" },
    ],
  },
  {
    id: "calculus",
    label: "Calculus",
    items: [
      { preview: "\\sum_{i}^{n}", latex: "\\sum_{#?}^{#?}", label: "Sum" },
      { preview: "\\prod_{i}^{n}", latex: "\\prod_{#?}^{#?}", label: "Product" },
      { preview: "\\int_{a}^{b}", latex: "\\int_{#?}^{#?}", label: "Integral" },
      { preview: "\\lim_{x\\to a}", latex: "\\lim_{#?\\to #?}", label: "Limit" },
      { preview: "\\frac{d}{dx}", latex: "\\frac{d}{d#?}", label: "Derivative" },
      { preview: "\\partial", latex: "\\partial", label: "Partial" },
      { preview: "\\nabla", latex: "\\nabla", label: "Nabla" },
      { preview: "\\infty", latex: "\\infty", label: "Infinity" },
    ],
  },
  {
    id: "linalg",
    label: "Matrices",
    items: [
      { preview: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
        latex: "\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}", label: "2×2 matrix" },
      { preview: "\\begin{bmatrix}a\\\\b\\end{bmatrix}",
        latex: "\\begin{bmatrix}#?\\\\#?\\end{bmatrix}", label: "Column vector" },
      { preview: "\\begin{cases}a\\\\b\\end{cases}",
        latex: "\\begin{cases}#?\\\\#?\\end{cases}", label: "Cases" },
      { preview: "A^{T}", latex: "^{T}", label: "Transpose" },
      { preview: "A^{-1}", latex: "^{-1}", label: "Inverse" },
      { preview: "\\vec{v}", latex: "\\vec{#?}", label: "Vector" },
      { preview: "\\hat{x}", latex: "\\hat{#?}", label: "Hat" },
      { preview: "\\overline{z}", latex: "\\overline{#?}", label: "Conjugate" },
    ],
  },
];

export const MATH_GROUP_IDS = MATH_GROUPS.map((g) => g.id);

// ── The active field ────────────────────────────────────────────────────────

/** The subset of MathfieldElement this module needs. Typed structurally so the
 *  registry does not drag mathlive's types into every importer. */
export interface MathFieldHandle {
  insert(latex: string, options?: Record<string, unknown>): void;
  focus(): void;
  getValue(): string;
}

let active: MathFieldHandle | null = null;

/**
 * ⚠️ Registration is by IDENTITY, not a flag.
 *
 * `clearActiveMathField(f)` only clears when `f` is still the current one. Two
 * fields hand over on focus — the new one registers before the old one's blur
 * fires — so a blur handler that cleared unconditionally would wipe the field
 * that had just taken over, and the toolbar would insert into nothing while
 * looking perfectly alive.
 */
export function setActiveMathField(f: MathFieldHandle): void {
  active = f;
}

export function clearActiveMathField(f: MathFieldHandle): void {
  if (active === f) active = null;
}

export function getActiveMathField(): MathFieldHandle | null {
  return active;
}

/**
 * Put a symbol into whichever field is focused.
 *
 * Returns false when there is none, so the caller can leave the button
 * disabled rather than silently doing nothing — a palette that looks live and
 * is not is worse than one that is visibly unavailable.
 */
export function insertMathSymbol(latex: string): boolean {
  const f = active;
  if (!f) return false;
  // `focus()` first: clicking a toolbar button moves focus out of the field in
  // browsers that don't honour preventDefault on mousedown, and MathLive
  // inserts at the caret it currently has.
  f.focus();
  f.insert(latex, { focus: true, selectionMode: "placeholder" });
  return true;
}
