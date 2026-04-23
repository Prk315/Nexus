import { useEffect, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { SlashMenuState } from "../extensions/SlashCommands";

interface Props extends SlashMenuState {
  keyHandlerRef: MutableRefObject<((event: KeyboardEvent) => boolean) | null>;
}

export function SlashCommandsList({ items, command, rect, keyHandlerRef }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) command(item);
  };

  useEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    };
    return () => {
      keyHandlerRef.current = null;
    };
  }, [items, selectedIndex, command]);

  if (!items.length) return null;

  return createPortal(
    <div
      className="slash-menu"
      style={{
        position: "fixed",
        top: rect?.bottom ?? 0,
        left: rect?.left ?? 0,
        zIndex: 1000,
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.title}
          className={`slash-item${index === selectedIndex ? " active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            selectItem(index);
          }}
        >
          <span className="slash-icon">{item.icon}</span>
          {item.title}
        </button>
      ))}
    </div>,
    document.body
  );
}
