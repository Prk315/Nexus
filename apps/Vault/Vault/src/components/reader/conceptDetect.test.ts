import { describe, it, expect } from "vitest";
import { detectConcept, conceptTitle, normaliseHeading } from "./conceptDetect";

describe("normaliseHeading", () => {
  // The whole reason the first pass over this PDF found zero definitions.
  it("expands the ligatures the typesetter actually stored", () => {
    expect(normaliseHeading("3.3.1 Deﬁnisjon")).toBe("3.3.1 Definisjon");
    expect(normaliseHeading("koeﬃsient")).toBe("koeffisient");
    expect(normaliseHeading("ﬂere")).toBe("flere");
  });

  it("settles whitespace without touching the words", () => {
    expect(normaliseHeading("  1.4.2  Binomialformelen \n")).toBe("1.4.2 Binomialformelen");
  });
});

describe("detectConcept — the book's own form: number first", () => {
  it("reads a bare label as a label, with no name", () => {
    expect(detectConcept("1.4.1 Eksempel")).toEqual({
      kind: "example", label: "Eksempel 1.4.1", name: "", number: "1.4.1",
    });
    expect(detectConcept("1.4.4 Lemma")).toEqual({
      kind: "theorem", label: "Lemma 1.4.4", name: "", number: "1.4.4",
    });
    expect(detectConcept("3.3.1 Deﬁnisjon")).toEqual({
      kind: "definition", label: "Definisjon 3.3.1", name: "", number: "3.3.1",
    });
  });

  it("maps every one of the spec's seven labels to a kind", () => {
    const kinds = [
      ["1.1.1 Definisjon", "definition"],
      ["1.1.2 Setning", "theorem"],
      ["1.1.3 Teorem", "theorem"],
      ["1.1.4 Lemma", "theorem"],
      ["1.1.5 Korollar", "theorem"],
      ["1.1.6 Eksempel", "example"],
    ] as const;
    for (const [text, kind] of kinds) expect(detectConcept(text)?.kind).toBe(kind);
    expect(detectConcept("Bevis:")?.kind).toBe("proof");
  });

  // The result the definition of done names by hand.
  it("reads a named result that carries no label at all", () => {
    expect(detectConcept("1.4.2 Binomialformelen")).toEqual({
      kind: "theorem", label: "1.4.2", name: "Binomialformelen", number: "1.4.2",
    });
    expect(detectConcept("5.2.1 Skjæringssetningen")).toEqual({
      kind: "theorem", label: "5.2.1", name: "Skjæringssetningen", number: "5.2.1",
    });
  });

  it("keeps a multi-word name whole", () => {
    expect(detectConcept("3.3.5 De Moivres formel")?.name).toBe("De Moivres formel");
    expect(detectConcept("6.3.2 L’Hôpitals regel for «0/0»")?.name)
      .toBe("L’Hôpitals regel for «0/0»");
  });

  it("takes the parenthesised name when a labelled heading has one", () => {
    expect(detectConcept("1.2.5 Setning (versjon 2)")).toEqual({
      kind: "theorem", label: "Setning 1.2.5", name: "versjon 2", number: "1.2.5",
    });
  });
});

describe("detectConcept — the spec's form: label first", () => {
  it("reads label, number and parenthesised name", () => {
    expect(detectConcept("Setning 3.2.1 (Binomialformelen)")).toEqual({
      kind: "theorem", label: "Setning 3.2.1", name: "Binomialformelen", number: "3.2.1",
    });
  });

  it("copes with the number or the name missing", () => {
    expect(detectConcept("Definisjon 2.1")).toEqual({
      kind: "definition", label: "Definisjon 2.1", name: "", number: "2.1",
    });
    expect(detectConcept("Korollar")).toEqual({
      kind: "theorem", label: "Korollar", name: "", number: "",
    });
  });
});

describe("detectConcept — proofs", () => {
  it("reads the plain opener", () => {
    expect(detectConcept("Bevis:")).toEqual({
      kind: "proof", label: "Bevis", name: "", number: "",
    });
    expect(detectConcept("Bevis")?.kind).toBe("proof");
  });

  it("keeps the subject when the book names which proof this is", () => {
    expect(detectConcept("Induksjonsbevis for binomialformelen:")).toEqual({
      kind: "proof", label: "Induksjonsbevis", name: "binomialformelen", number: "",
    });
  });
});

describe("detectConcept — what it must NOT claim", () => {
  // A rail standing where the eye goes for structure has to be quiet.
  it("ignores prose that merely mentions a label", () => {
    expect(detectConcept("Vi er nå klare for det første beviset for binomialformelen")).toBeNull();
    expect(detectConcept("Definisjonen stemmer altså overens med det vi er vant til")).toBeNull();
    expect(detectConcept("Resten av dette avsnittet skal vi bruke til å bevise")).toBeNull();
  });

  it("ignores headings, exercises and empty text", () => {
    expect(detectConcept("Oppgaver i seksjon 1.4")).toBeNull();
    expect(detectConcept("1.4 Pascals trekant og binomialformelen")).toBeNull();
    expect(detectConcept("17. (UiO) Gitt to komplekse tall")).toBeNull();
    expect(detectConcept("")).toBeNull();
    expect(detectConcept("   ")).toBeNull();
  });

  // "1.4" is a section number, not an environment number: two components.
  it("does not treat a two-part number as an environment", () => {
    expect(detectConcept("1.4 Polarform")).toBeNull();
  });
});

describe("conceptTitle", () => {
  it("prefers the name and falls back to the label", () => {
    expect(conceptTitle(detectConcept("1.4.2 Binomialformelen")!)).toBe("Binomialformelen");
    expect(conceptTitle(detectConcept("1.4.4 Lemma")!)).toBe("Lemma 1.4.4");
  });
});
