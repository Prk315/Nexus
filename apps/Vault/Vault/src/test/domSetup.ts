// Installs a DOM for the schema tests.
//
// Why not `environment: "happy-dom"` in vitest.config.ts: vitest resolves the
// environment package from its OWN install location, which in this npm
// workspace is the repo-root node_modules. Importing it from a setup file
// resolves relative to this file instead, which is what we want — the DOM is a
// test-only concern of this app and shouldn't have to be hoisted to the root
// to be usable.
//
// ProseMirror needs very little of it: `window.DOMParser` (Tiptap's
// elementFromString) and `document.implementation.createHTMLDocument` (the
// DOMSerializer behind generateHTML). Everything else is incidental.

import { Window } from "happy-dom";

const win = new Window({ url: "https://vault.test" });

const g = globalThis as any;
g.window ??= win;
g.document ??= win.document;
g.navigator ??= win.navigator;
g.DOMParser ??= win.DOMParser;
g.Node ??= win.Node;
g.Element ??= win.Element;
g.HTMLElement ??= win.HTMLElement;
g.Text ??= win.Text;
g.DocumentFragment ??= win.DocumentFragment;
g.getComputedStyle ??= win.getComputedStyle.bind(win);
