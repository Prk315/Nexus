import { useEffect } from "react";
import { useNexusRegistration } from "@nexus/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppDispatch, useAppSelector } from "./hooks/useAppDispatch";
import { fetchConfig } from "./store/slices/settingsSlice";
import { fetchCategories } from "./store/slices/categoriesSlice";
import { fetchBlockerState } from "./store/slices/blockerSlice";
import { useAutoSync } from "./hooks/useAutoSync";
import AppShell from "./components/layout/AppShell";
import FloatingWidget from "./pages/FloatingWidget";

// Reliably detect the widget window by its Tauri label, not URL pathname
const IS_WIDGET = getCurrentWindow().label.startsWith("widget");

function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const theme = useAppSelector((s) => s.settings.theme);

  useEffect(() => {
    const apply = (t: "light" | "dark") => {
      document.documentElement.setAttribute("data-theme", t);
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches ? "dark" : "light");
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      apply(theme);
    }
  }, [theme]);

  return <>{children}</>;
}

export default function App() {
  useNexusRegistration("TimeTracker");
  const dispatch = useAppDispatch();
  useAutoSync();

  useEffect(() => {
    // Mark the body so the widget window gets transparent CSS
    if (IS_WIDGET) {
      document.documentElement.classList.add("widget-window");
      document.body.classList.add("widget-window");
    }

    dispatch(fetchConfig());
    dispatch(fetchCategories());
    dispatch(fetchBlockerState());
  }, [dispatch]);

  return (
    <ThemeWrapper>
      {IS_WIDGET ? <FloatingWidget /> : <AppShell />}
    </ThemeWrapper>
  );
}
