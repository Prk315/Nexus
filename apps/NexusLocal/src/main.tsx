import React from "react";
import ReactDOM from "react-dom/client";
import { NexusAuthProvider, AuthGate } from "@nexus/core";
import App from "./App";
import { supabase } from "./lib/supabase";
import { SessionBridge } from "./lib/SessionBridge";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NexusAuthProvider supabase={supabase}>
      {/* Bridges the session to the widget's App Group; runs regardless of gate */}
      <SessionBridge />
      <AuthGate appName="Nexus Local">
        <App />
      </AuthGate>
    </NexusAuthProvider>
  </React.StrictMode>
);
