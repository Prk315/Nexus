import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { NexusAuthProvider, AuthGate } from "@nexus/core";
import { store } from "./store";
import { getSupabaseClient } from "./lib/supabase";
import App from "./App";
import "./tailwind.css";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NexusAuthProvider supabase={getSupabaseClient()}>
      <AuthGate appName="Protocol">
        <Provider store={store}>
          <App />
        </Provider>
      </AuthGate>
    </NexusAuthProvider>
  </React.StrictMode>
);
