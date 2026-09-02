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

// A LIVE editor needs a little more than a document.
//
// ProseMirror's EditorView schedules DOM reads through requestAnimationFrame,
// which happy-dom's window has but `globalThis` does not — and Tiptap reaches
// for the global. Without these, constructing an `Editor` throws
// "requestAnimationFrame is not defined" and every test that drives a real
// editor fails for a reason that has nothing to do with what it is testing.
//
// Immediate rather than timed: a test wants the frame to have happened by the
// time the next line runs, and 16 ms of real latency in a unit test buys
// nothing but flakiness.
g.requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
g.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
g.MutationObserver ??= win.MutationObserver;
g.DOMRect ??= (win as any).DOMRect;
