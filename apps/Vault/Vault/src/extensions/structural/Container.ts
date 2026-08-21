// Generic grouping container — the plain <div> of the note editor.
//
// Distinct from Callout on purpose: a callout *says something* (this is a
// warning), a container only groups. Conflating them would mean every visual
// grouping had to borrow a semantic it didn't mean.

import { createContainerNode } from "./createContainerNode";

export const CONTAINER_STYLES = ["plain", "card", "outline", "muted"] as const;
export type ContainerStyle = (typeof CONTAINER_STYLES)[number];

export const CONTAINER_LABELS: Record<ContainerStyle, string> = {
  plain: "Group",
  card: "Card",
  outline: "Outlined box",
  muted: "Muted panel",
};

export const Container = createContainerNode({
  name: "containerBlock",
  content: "block+",
  dataType: "container",
  attrs: {
    style: {
      default: "card" as ContainerStyle,
      parseHTML: (el) => {
        const v = el.getAttribute("data-style");
        return (CONTAINER_STYLES as readonly string[]).includes(v ?? "") ? v : "card";
      },
      renderHTML: (attrs) => ({ "data-style": attrs.style }),
    },
  },
  className: (attrs) => `container-block container-${attrs.style}`,
});
