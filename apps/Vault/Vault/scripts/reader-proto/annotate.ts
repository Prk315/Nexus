// Stage 2 of the reader pipeline: read the raw blocks extract.py produced and
// fill in `label`, `name` and `concept` on every concept block.
//
// This runs under vite-node so that it imports the SAME detectConcept the
// reader imports. That is the whole point of splitting the pipeline in two:
// concept detection is one tested function in one language, and reader.json can
// never disagree with the rail that renders it. Re-implementing the parser in
// Python next to the extractor would have been fewer moving parts and a
// guaranteed drift.
//
// Run it through ./run.sh. Directly, from apps/Vault/Vault:
//
//   npx vite-node scripts/reader-proto/annotate.ts -- \
//     scripts/reader-proto/.cache/reader.raw.json \
//     public/reader-proto/kalkulus/reader.json

import { readFileSync, writeFileSync } from "node:fs";
import { detectConcept } from "../../src/components/reader/conceptDetect";
import type { ReaderDoc } from "../../src/components/reader/readerTypes";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: annotate.ts <raw.json> <reader.json>");
  process.exit(1);
}

const doc = JSON.parse(readFileSync(input, "utf8")) as ReaderDoc;

let concepts = 0;
let dropped = 0;

for (const page of doc.pages) {
  for (const block of page.blocks) {
    // `fontSize: null` is how Python spells "no glyphs measured". Drop the key
    // rather than ship a null the TypeScript type would have to allow.
    if (block.fontSize == null) delete block.fontSize;

    if (block.type !== "concept") continue;
    const parsed = detectConcept(block.heading ?? block.text);
    if (!parsed) {
      // The font said "environment heading" and the text did not parse as one.
      // Demote to a paragraph rather than leave a concept the rail cannot
      // label — an unlabelled entry in the rail is worse than no entry.
      block.type = "paragraph";
      dropped++;
      continue;
    }
    block.concept = parsed.kind;
    block.label = parsed.label;
    if (parsed.name) block.name = parsed.name;
    concepts++;
  }
}

writeFileSync(output, JSON.stringify(doc, null, 1), "utf8");

const byKind = new Map<string, number>();
for (const page of doc.pages) {
  for (const b of page.blocks) {
    if (b.concept) byKind.set(b.concept, (byKind.get(b.concept) ?? 0) + 1);
  }
}
console.log(`  ${concepts} concepts`, Object.fromEntries(byKind), dropped ? `(${dropped} demoted)` : "");
for (const page of doc.pages) {
  const named = page.blocks.filter((b) => b.concept).map((b) => b.name || b.label);
  if (named.length) console.log(`  p${page.printedPage}: ${named.join(", ")}`);
}
console.log(`reader -> ${output}`);
