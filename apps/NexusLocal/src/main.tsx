import React from "react";
import ReactDOM from "react-dom/client";
import { NexusAuthProvider, AuthGate } from "@nexus/core";
import App from "./App";
import { supabase } from "./lib/supabase";
import { SessionBridge } from "./lib/SessionBridge";
import { ContentBlockerSync } from "./lib/ContentBlockerSync";
import { LiveActivitySync } from "./lib/LiveActivitySync";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NexusAuthProvider supabase={supabase}>
      {/* Run regardless of the auth gate */}
      <SessionBridge />
      <ContentBlockerSync />
      <LiveActivitySync />
      <AuthGate appName="Nexus Local">
        <App />
      </AuthGate>
    </NexusAuthProvider>
  </React.StrictMode>
);
