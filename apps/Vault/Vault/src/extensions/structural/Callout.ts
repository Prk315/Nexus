// Callout / admonition box: a tinted panel with an icon, for the "note this"
// aside that every note app has and this one didn't.
//
// Rendered from `data-variant` + CSS rather than a React node view. There is
// nothing interactive inside it — the icon is a ::before, the tint is a
// variable — so a React tree per instance would buy nothing and cost a
// remount on every keystroke that touches the block.

import { createContainerNode } from "./createContainerNode";

export const CALLOUT_VARIANTS = ["note", "info", "warn", "success", "danger"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  note: "Note",
  info: "Info",
  warn: "Warning",
  success: "Success",
  danger: "Danger",
};

export const CALLOUT_ICONS: Record<CalloutVariant, string> = {
  note: "✎",
  info: "ⓘ",
  warn: "⚠",
  success: "✓",
  danger: "✕",
};

export const Callout = createContainerNode({
  name: "calloutBlock",
  content: "block+",
  dataType: "callout",
  tag: "aside",
  attrs: {
    variant: {
      default: "note" as CalloutVariant,
      parseHTML: (el) => {
        const v = el.getAttribute("data-variant");
        // An unrecognised variant must fall back rather than reach CSS as an
        // arbitrary attribute selector that matches nothing — an unstyled
        // callout is indistinguishable from a plain div.
        return (CALLOUT_VARIANTS as readonly string[]).includes(v ?? "") ? v : "note";
      },
      renderHTML: (attrs) => ({ "data-variant": attrs.variant }),
    },
  },
  className: (attrs) => `callout callout-${attrs.variant}`,
});
