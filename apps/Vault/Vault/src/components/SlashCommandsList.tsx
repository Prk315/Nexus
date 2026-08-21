import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { SlashMenuState } from "../extensions/SlashCommands";
import { GROUP_LABELS } from "../extensions/blockRegistry";

interface Props extends SlashMenuState {
  keyHandlerRef: MutableRefObject<((event: KeyboardEvent) => boolean) | null>;
}

const MENU_MAX_HEIGHT = 320;

export function SlashCommandsList({ items, command, rect, keyHandlerRef }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

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
      if (event.key === "Enter" || event.key === "Tab") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    };
    return () => {
      keyHandlerRef.current = null;
    };
  }, [items, selectedIndex, command]);

  // The menu now scrolls (grouping made it taller than the viewport allowance),
  // so arrow-keying past the fold has to bring the selection with it.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Flip above the cursor when there isn't room below, rather than letting the
  // menu run off the bottom of the window.
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const wanted = Math.min(MENU_MAX_HEIGHT, listRef.current?.scrollHeight ?? MENU_MAX_HEIGHT);
    setFlip(below < wanted && rect.top > below);
  }, [rect, items.length]);

  if (!items.length) return null;

  return createPortal(
    <div
      ref={listRef}
      className="slash-menu"
      style={{
        position: "fixed",
        top: flip ? undefined : rect?.bottom ?? 0,
        bottom: flip ? window.innerHeight - (rect?.top ?? 0) : undefined,
        left: rect?.left ?? 0,
        maxHeight: MENU_MAX_HEIGHT,
        overflowY: "auto",
        zIndex: 1000,
      }}
    >
      {items.map((item, index) => {
        // Headers are derived at render time and deliberately NOT part of
        // `items`. Interleaving them would shift every index and break the
        // arrow-key navigation above, which addresses items positionally.
        const startsGroup = item.group !== items[index - 1]?.group;
        return (
          <div key={item.id}>
            {startsGroup && <div className="slash-group">{GROUP_LABELS[item.group]}</div>}
            <button
              ref={index === selectedIndex ? activeRef : undefined}
              className={`slash-item${index === selectedIndex ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectItem(index);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="slash-icon">{item.icon}</span>
              <span className="slash-label">{item.title}</span>
              {item.shortcut && <span className="slash-shortcut">{item.shortcut}</span>}
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
