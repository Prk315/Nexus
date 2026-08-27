import React from "react";
import ReactDOM from "react-dom/client";
import { NexusAuthProvider, AuthGate } from "@nexus/core";
import { supabase } from "./lib/supabase";
import "./tailwind.css";
import "./App.css";
// After App.css: the block's styles are scoped `pf-` and depend on the custom
// properties App.css declares on :root.
import "./pathfinderBlock.css";
// Also after App.css, and for the same reason: every `vh-` rule reads custom
// properties (and the confirm-pop keyframes) declared there.
import "./versionHistory.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NexusAuthProvider supabase={supabase}>
      <AuthGate appName="Vault">
        <App />
      </AuthGate>
    </NexusAuthProvider>
  </React.StrictMode>,
);
