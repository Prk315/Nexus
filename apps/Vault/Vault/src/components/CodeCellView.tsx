import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { CellOutput } from "./CellOutput";
import { CODE_CELL_LANGUAGES } from "../extensions/CodeCellBlock";
import type { CellLanguage, OutputChunk } from "../kernel/types";

// The kernel is loaded on FIRST RUN, never on render. A note full of cells that
// nobody has run costs nothing, and Pyodide (tens of megabytes) is not fetched
// until someone actually asks for Python. Everything outside this dynamic
// import uses `import type` only.
const loadKernel = () => import("../kernel");

export function CodeCellView({ node, updateAttributes, extension, editor }: NodeViewProps) {
  const code: string = node.attrs.code ?? "";
  const language: CellLanguage = node.attrs.language === "sql" ? "sql" : "python";
  const outputs: OutputChunk[] = node.attrs.outputs ?? [];

  const [running, setRunning] = useState(false);
  const [booting, setBooting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Survives the run so a late result cannot write into a cell that has since
  // been deleted — updateAttributes on a removed node throws inside a promise,
  // where nothing catches it.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const sessionId: string = extension.options.sessionId ?? "vault-note";

  // Grow the textarea with its content. A code cell that scrolls internally at
  // four lines is unusable next to prose, and a fixed height would waste the
  // page for a one-liner.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 22)}px`;
  }, [code]);

  const run = useCallback(async () => {
    if (running || !code.trim()) return;
    setRunning(true);
    // Pyodide's first load is slow enough (tens of MB) that a plain spinner
    // reads as a hang. Say what is happening instead.
    const kernelPromise = loadKernel();
    const bootTimer = setTimeout(() => setBooting(true), 400);
    try {
      const kernel = await kernelPromise;
      const chunks = await kernel.runCell(sessionId, language, code);
      if (aliveRef.current) updateAttributes({ outputs: chunks });
    } finally {
      clearTimeout(bootTimer);
      if (aliveRef.current) {
        setRunning(false);
        setBooting(false);
      }
    }
  }, [running, code, language, sessionId, updateAttributes]);

  const stop = useCallback(async () => {
    const kernel = await loadKernel();
    kernel.killPythonSession(sessionId);
    if (aliveRef.current) {
      setRunning(false);
      setBooting(false);
      updateAttributes({
        outputs: [{ type: "error", content: "Stopped. The kernel's variables were cleared." }],
      });
    }
  }, [sessionId, updateAttributes]);

  const restart = useCallback(async () => {
    const kernel = await loadKernel();
    await kernel.resetSession(sessionId);
    if (aliveRef.current) updateAttributes({ outputs: [] });
  }, [sessionId, updateAttributes]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Every key typed into a cell must stop here. Without this the editor's own
    // keymaps see them — Enter splits the surrounding block, Backspace at
    // offset 0 joins into the previous node, and Mod-z undoes the DOCUMENT
    // rather than the code being written.
    e.stopPropagation();

    if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "Tab") {
      // Tab must indent, not leave the cell. Python is the default language;
      // losing focus mid-block is the fastest way to make a cell feel broken.
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: t } = ta;
      const next = code.slice(0, s) + "    " + code.slice(t);
      updateAttributes({ code: next });
      requestAnimationFrame(() => ta.setSelectionRange(s + 4, s + 4));
    }
  }

  return (
    <NodeViewWrapper className="code-cell-block" data-language={language}>
      <div className="code-cell-bar" contentEditable={false}>
        <button
          type="button"
          className="code-cell-btn code-cell-run"
          onClick={() => (running ? void stop() : void run())}
          title={running ? "Stop — clears the kernel's variables" : "Run (Shift+Enter)"}
          disabled={!running && !code.trim()}
        >
          {running ? "■" : "▶"}
        </button>
        <select
          className="code-cell-lang"
          value={language}
          // Results from another language are not results for this one, so they
          // go rather than sitting there looking current.
          onChange={(e) => updateAttributes({ language: e.target.value as CellLanguage, outputs: [] })}
          title="Cells in a note share one namespace, like a notebook"
        >
          {CODE_CELL_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
        <span className="code-cell-status">
          {booting ? "Starting Python…" : running ? "Running…" : ""}
        </span>
        <button
          type="button"
          className="code-cell-btn code-cell-restart"
          onClick={() => void restart()}
          title="Restart kernel — forgets every variable in this note"
        >
          ↺
        </button>
      </div>

      <textarea
        ref={taRef}
        className="code-cell-input"
        value={code}
        spellCheck={false}
        placeholder={language === "sql" ? "-- SQL…  Shift+Enter to run" : "# Python…  Shift+Enter to run"}
        onChange={(e) => updateAttributes({ code: e.target.value })}
        onKeyDown={onKeyDown}
        // The node is an atom, so a click landing here would otherwise select
        // the whole cell instead of placing the caret in the code.
        onPointerDown={(e) => e.stopPropagation()}
        readOnly={!editor.isEditable}
      />

      <CellOutput chunks={outputs} />
    </NodeViewWrapper>
  );
}
