import React from "react";
import ReactDOM from "react-dom/client";
import { NexusAuthProvider, AuthGate } from "@nexus/core";
import { supabase } from "./lib/supabase";
import "./tailwind.css";
import "./App.css";
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
