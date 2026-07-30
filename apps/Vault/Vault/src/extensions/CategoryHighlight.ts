import Highlight from "@tiptap/extension-highlight";

// tiptap Highlight mark extended with a `category` attribute so a highlight
// carries which highlighter (e.g. "Definition") it belongs to, alongside the
// built-in multicolor `color`. Rendered as data-category on the <mark>.
export const CategoryHighlight = Highlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      category: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-category"),
        renderHTML: (attrs: Record<string, any>) =>
          attrs.category ? { "data-category": attrs.category } : {},
      },
    };
  },
}).configure({ multicolor: true });
