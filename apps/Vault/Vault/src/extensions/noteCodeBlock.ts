// Syntax-highlighted code blocks.
//
// The languages are registered ONE BY ONE rather than via lowlight's `all`
// bundle. `all` pulls the whole of highlight.js — 9 MB unpacked, ~1 MB
// minified, 190-odd grammars — into a note editor. This list covers what
// actually gets pasted into these notes and costs a fraction of that; adding
// one more is a two-line change.

import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";

import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const lowlight = createLowlight();

lowlight.register({
  bash,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  // `xml` is highlight.js's name for the HTML/XML/JSX grammar.
  xml,
  yaml,
});

/** Languages offered in the code block's picker, in menu order. */
export const CODE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "plaintext", label: "Plain text" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Shell" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "HTML / XML" },
  { value: "css", label: "CSS" },
  { value: "markdown", label: "Markdown" },
];

export const NoteCodeBlock = CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: null,
});

export { lowlight };
