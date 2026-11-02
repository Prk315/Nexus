import React from "react";
import ReactDOM from "react-dom/client";
import { NexusAuthProvider } from "@nexus/core";
import App from "./App";
import { supabase } from "./lib/supabase";
import { SessionBridge } from "./lib/SessionBridge";
import { ContentBlockerSync } from "./lib/ContentBlockerSync";
import { LiveActivitySync } from "./lib/LiveActivitySync";
import { TimeTrackerSync } from "./lib/timetracker";
import { FloatingTimer } from "./lib/timetracker/FloatingTimer";
import "./index.css";

/** The floating focus timer is a second window over this same bundle (see
 * `src-tauri/src/float.rs`). It gets the timer and nothing else — in
 * particular none of the syncs below, which the main window already runs and
 * which must not run twice. Read from the Tauri metadata directly so the web
 * build, which has none, never touches the window API. */
const IS_FLOAT_WINDOW =
  typeof window !== "undefined" &&
  (window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
    .__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "float";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (IS_FLOAT_WINDOW) {
  root.render(
    <React.StrictMode>
      <FloatingTimer />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <NexusAuthProvider supabase={supabase}>
        {/* Run regardless of the auth gate */}
        <SessionBridge />
        <ContentBlockerSync />
        <LiveActivitySync />
        <TimeTrackerSync />
        {/* Not behind <AuthGate>: every table this app reads is anon-keyed
            (`user_id = "default"`), so gating hid the whole productivity surface
            from a signed-out launch. App offers sign-in inline instead. */}
        <App />
      </NexusAuthProvider>
    </React.StrictMode>
  );
}
