import React from "react";
import ReactDOM from "react-dom/client";
import { NexusAuthProvider } from "@nexus/core";
import App from "./App";
import { supabase } from "./lib/supabase";
import { SessionBridge } from "./lib/SessionBridge";
import { ContentBlockerSync } from "./lib/ContentBlockerSync";
import { LiveActivitySync } from "./lib/LiveActivitySync";
import { TimeTrackerSync } from "./lib/timetracker";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
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
