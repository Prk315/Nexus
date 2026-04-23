import { useEffect } from "react";

interface KeyBindings {
  onToggleFullGraph: () => void;
  onToggleSearch: () => void;
  onNewNode: () => void;
  onEscape: () => void;
  onCloseTab: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
}

export function useKeyBindings({ onToggleFullGraph, onToggleSearch, onNewNode, onEscape, onCloseTab, onNextTab, onPrevTab }: KeyBindings) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape") {
        onEscape();
        return;
      }

      if (!mod) return;

      if (e.key === "g") { e.preventDefault(); onToggleFullGraph(); }
      else if (e.key === "s") { e.preventDefault(); onToggleSearch(); }
      else if (e.key === "n") { e.preventDefault(); onNewNode(); }
      else if (e.key === "w") { e.preventDefault(); onCloseTab(); }
      else if (e.key === "]" && e.shiftKey) { e.preventDefault(); onNextTab(); }
      else if (e.key === "[" && e.shiftKey) { e.preventDefault(); onPrevTab(); }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onToggleFullGraph, onToggleSearch, onNewNode, onEscape, onCloseTab, onNextTab, onPrevTab]);
}
