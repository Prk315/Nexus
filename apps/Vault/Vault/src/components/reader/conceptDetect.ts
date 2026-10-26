// Reads a Kalkulus environment heading and says what it is.
//
// Pure, and the single source of truth: the extraction script does NOT parse
// labels. It types a block as `concept` from the font alone (10pt bold sans, or
// 9pt bold italic for a proof) and hands the bold run over verbatim; stage 2 of
// the pipeline runs this same function to fill `label`/`name`/`concept` into
// reader.json, and the reader re-runs it on anything that arrives without them.
// One implementation, one set of tests, and the JSON on disk can never disagree
// with the rail rendering it.
//
// ── What Lindstrøm actually writes ───────────────────────────────────────────
// The spec assumed `Setning 3.2.1 (Binomialformelen)` — label, then number,
// then a parenthesised name. Kalkulus does not do that. It numbers FIRST, and
// then writes either a label or a name, never both:
//
//     1.4.1 Eksempel                 ← number + label, no name
//     1.4.4 Lemma                    ← number + label, no name
//     3.3.1 Definisjon               ← number + label, no name
//     1.4.2 Binomialformelen         ← number + NAME, and no label at all
//     5.2.1 Skjæringssetningen       ← same
//     Bevis:                         ← unnumbered
//
// Under the spec's rule literally, `1.4.2 Binomialformelen` matches nothing —
// which would have left the binomial theorem, the one result the definition of
// done names, out of the concept rail. So this handles the book's form as the
// primary case and the spec's form as an equally supported alternative, since
// the Danish-spelling ingest the spec refers to really does emit it.
//
// A numbered heading whose first word is not one of the seven labels is a named
// result: Kalkulus only ever names theorems, principles and rules that way. It
// is classified `theorem` and its name is kept, rather than being guessed at a
// finer grain than the source supports.

export type ConceptKind = "definition" | "theorem" | "example" | "proof";

export interface Concept {
  kind: ConceptKind;
  /** What to show when there is no name: "Definisjon 3.3.1", "1.4.2", "Bevis". */
  label: string;
  /** "Binomialformelen"; empty when the heading is a bare label. */
  name: string;
  /** "1.4.2"; empty for an unnumbered proof. */
  number: string;
}

/** The seven Norwegian labels from the spec, and what each one is. */
const LABELS: ReadonlyArray<readonly [string, ConceptKind]> = [
  ["Definisjon", "definition"],
  ["Setning", "theorem"],
  ["Teorem", "theorem"],
  ["Lemma", "theorem"],
  ["Korollar", "theorem"],
  ["Eksempel", "example"],
  ["Bevis", "proof"],
];

const LIGATURES: Record<string, string> = {
  "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
};

/**
 * Undo the typesetter's ligatures and settle the whitespace.
 *
 * This is not cosmetic. The PDF stores "Definisjon" with a real U+FB01, so the
 * string that comes out of any text layer is `Deﬁnisjon` and a plain
 * `startsWith("Defi")` finds nothing. The extraction script normalises too; this
 * runs again because the reader also parses documents that script never saw.
 */
export function normaliseHeading(raw: string): string {
  let out = "";
  for (const ch of raw) out += LIGATURES[ch] ?? ch;
  return out.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
}

function labelFor(word: string): ConceptKind | null {
  const lower = word.toLowerCase();
  for (const [label, kind] of LABELS) {
    if (label.toLowerCase() === lower) return kind;
  }
  return null;
}

/** Strip the punctuation a heading trails, without eating a name's own full stop. */
function tidyName(s: string): string {
  return s.replace(/[\s:.,;–—-]+$/, "").trim();
}

/**
 * Parse one environment heading. Returns null when the text is not one.
 *
 * Deliberately strict about where it looks: the label has to open the string.
 * A paragraph that merely mentions "beviset" or "en definisjon av" is prose,
 * and a rail that listed those would be noise standing exactly where the eye
 * goes for structure.
 */
export function detectConcept(raw: string): Concept | null {
  const text = normaliseHeading(raw);
  if (!text) return null;

  // ── The book's form: "1.4.2 Binomialformelen", "3.3.1 Definisjon" ──────────
  // Three components at minimum — chapter.section.item. Two is a SECTION
  // number, and "1.4 Pascals trekant og binomialformelen" is a heading for the
  // outline, not a concept for the rail; a looser pattern put every section
  // heading in the book into the concept rail as a nameless theorem.
  const numbered = /^(\d+\.\d+\.\d+(?:\.\d+)*)\s+(.+)$/.exec(text);
  if (numbered) {
    const [, number, rest] = numbered;
    const firstWord = rest.split(/[\s.:,(]/, 1)[0];
    const kind = labelFor(firstWord);
    if (kind) {
      // "1.4.1 Eksempel", and the rare "1.2.5 Setning (versjon 2)".
      const paren = /\(([^)]+)\)/.exec(rest);
      return {
        kind,
        label: `${firstWord} ${number}`,
        name: paren ? tidyName(paren[1]) : "",
        number,
      };
    }
    // A named result. Kalkulus names nothing but results this way.
    return { kind: "theorem", label: number, name: tidyName(rest), number };
  }

  // ── Proofs, which carry no number ─────────────────────────────────────────
  // "Bevis:", and also "Induksjonsbevis for binomialformelen:" — the book gives
  // a proof a subject of its own whenever a result has more than one.
  const proof = /^([A-Za-zÆØÅæøå]*bevis)\b\s*(?:for\s+(.+?))?\s*[:.]?$/i.exec(text);
  if (proof) {
    const subject = proof[2] ? tidyName(proof[2]) : "";
    return { kind: "proof", label: tidyName(proof[1]), name: subject, number: "" };
  }

  // ── The spec's form: "Setning 3.2.1 (Binomialformelen)" ───────────────────
  // What the Danish-spelling ingest emits, and what a hand-written note would
  // look like. Supported on equal terms, not as a fallback.
  const labelFirst = /^([A-Za-zÆØÅæøå]+)\b\s*(\d+(?:\.\d+)*)?\s*(?:\(([^)]+)\))?/.exec(text);
  if (labelFirst) {
    const kind = labelFor(labelFirst[1]);
    if (kind) {
      const number = labelFirst[2] ?? "";
      return {
        kind,
        label: number ? `${labelFirst[1]} ${number}` : labelFirst[1],
        name: labelFirst[3] ? tidyName(labelFirst[3]) : "",
        number,
      };
    }
  }

  return null;
}

/** What the rail puts on the line. Spec §4: the name, or the label when there is none. */
export function conceptTitle(c: Concept): string {
  return c.name || c.label;
}
