// Harness entry — see readerproto.html.
//
// Mounts the real ReaderEditor on the real pointer the `Kalkulus (reader)` node
// stores, outside AuthGate, so the reader can be looked at and iterated on
// without a Supabase session. It is the same rig readertest.html uses for
// ParsedViewer, and it exists for the same reason: the thing being designed
// here is a layout, and a layout nobody has rendered is a guess.
//
// The theme buttons are the point of the second half of this file: the reader
// is built entirely out of App.css tokens, which lib/theme.ts rewrites inline
// on <html>, so flipping between Paper and Ink here is the whole light/dark
// check. Nothing in the reader has a dark-mode rule of its own.

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReaderEditor } from "./components/reader/ReaderEditor";
import { applyTheme, PRESETS, type Theme } from "./lib/theme";
import "./App.css";

/** Exactly what vault_content holds for node a16d908d-…-6ad437d669c0. */
const POINTER = '{"v":1,"source":"/reader-proto/kalkulus/reader.json"}';

function Harness() {
  const [theme, setTheme] = useState<Theme>(PRESETS[0].theme);
  useEffect(() => { applyTheme(document.documentElement, theme); }, [theme]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{
        display: "flex", gap: 6, padding: "4px 8px", alignItems: "center",
        borderBottom: "1px solid var(--border-base)", background: "var(--bg-deep)",
        font: "11px system-ui", color: "var(--fg-muted)",
      }}>
        <span>harness · theme</span>
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => setTheme(p.theme)}
                  style={{ font: "inherit", cursor: "pointer" }}>
            {p.name}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ReaderEditor content={POINTER} nodeId="harness" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
