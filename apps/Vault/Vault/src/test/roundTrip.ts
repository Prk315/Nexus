// Shared helper for the HTML round-trip tests.
//
// `generateJSON` fills in every attribute a node type declares, so a fixture
// written without them never compares equal even when nothing was lost. The
// naive fix — drop attrs that are `null` — worked only while every default
// happened to be null, and broke the moment the doc node gained
// `width: "auto"`. Dropping attributes that equal their SCHEMA DEFAULT is the
// rule that actually expresses the intent: an attribute carrying its default
// says nothing, so its presence or absence must not decide identity.
//
// Attributes that carry meaning (a callout's variant, a toggle's open, a
// highlight's category) are non-default in these fixtures and so survive —
// which is exactly what the round-trip tests are there to check.

import type { Schema } from "@tiptap/pm/model";

export function stripDefaults(value: any, schema: Schema): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;

    const out: any = {};
    for (const [key, val] of Object.entries(node)) {
      if (key !== "attrs") {
        out[key] = walk(val);
        continue;
      }
      const typeName = node.type === schema.topNodeType.name ? schema.topNodeType.name : node.type;
      const spec = schema.nodes[typeName]?.spec?.attrs ?? {};
      const kept = Object.fromEntries(
        Object.entries((val ?? {}) as Record<string, unknown>).filter(
          ([k, v]) => !(k in spec) || v !== spec[k]?.default
        )
      );
      if (Object.keys(kept).length) out.attrs = kept;
    }
    return out;
  };
  return walk(value);
}
