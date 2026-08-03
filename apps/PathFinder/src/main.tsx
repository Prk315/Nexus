import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { NexusAuthProvider, AuthGate } from "@nexus/core";
import { supabase } from "./lib/supabase";
import { queryClient } from "./lib/queryClient";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <NexusAuthProvider supabase={supabase}>
        <AuthGate appName="PathFinder">
          <App />
        </AuthGate>
      </NexusAuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
