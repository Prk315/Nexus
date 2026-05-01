import { useEffect, type ReactNode } from "react";
import { useNexusRegistration } from "@nexus/core";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { fetchSettings } from "./store/slices/settingsSlice";
import AppShell from "./components/layout/AppShell";

function ThemeWrapper({ children }: { children: ReactNode }) {
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
  useNexusRegistration("Protocol");
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchSettings());
  }, [dispatch]);

  return (
    <ThemeWrapper>
      <AppShell />
    </ThemeWrapper>
  );
}
