import { useEffect, useState } from "react";
import { useNexusRegistration } from "@nexus/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onOpenUrl, getCurrent } from "@tauri-apps/plugin-deep-link";
import { useAppDispatch, useAppSelector } from "./hooks/useAppDispatch";
import { fetchConfig } from "./store/slices/settingsSlice";
import { fetchCategories } from "./store/slices/categoriesSlice";
import { fetchBlockerState } from "./store/slices/blockerSlice";
import { useAutoSync } from "./hooks/useAutoSync";
import { syncWidgetState } from "./lib/tauriApi";
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

  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (IS_WIDGET) {
      document.documentElement.classList.add("widget-window");
      document.body.classList.add("widget-window");
    }

    dispatch(fetchConfig());
    dispatch(fetchCategories());
    dispatch(fetchBlockerState());

    // Push current timer state to WidgetKit on every app launch.
    syncWidgetState();

    // Deep link: URL that launched the app (e.g. from a widget tap).
    getCurrent()
      .then((urls) => { if (urls?.[0]) setPendingUrl(urls[0]); })
      .catch(() => {});

    // Deep link: URL while the app is already foregrounded.
    let unlistenFn: (() => void) | undefined;
    onOpenUrl((urls) => {
      if (urls[0]) setPendingUrl(urls[0]);
    })
      .then((fn) => { unlistenFn = fn; })
      .catch(() => {});

    return () => { unlistenFn?.(); };
  }, [dispatch]);

  return (
    <ThemeWrapper>
      {IS_WIDGET ? (
        <FloatingWidget />
      ) : (
        <AppShell
          pendingUrl={pendingUrl}
          onUrlHandled={() => setPendingUrl(null)}
        />
      )}
    </ThemeWrapper>
  );
}
