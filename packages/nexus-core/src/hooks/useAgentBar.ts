import { useState, useEffect } from "react";

/**
 * Controls the AgentBar open/close state.
 * Trigger: double spacebar (within 200ms) when focus is not in a text field.
 * Close: Escape key or the X button in the bar.
 */
export function useAgentBar() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let lastSpaceTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (e.key === " ") {
        const target = e.target as HTMLElement;
        const isTyping =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;

        if (isTyping) return;

        const now = Date.now();
        if (now - lastSpaceTime < 200) {
          e.preventDefault();
          setIsOpen((prev) => !prev);
          lastSpaceTime = 0;
        } else {
          lastSpaceTime = now;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
