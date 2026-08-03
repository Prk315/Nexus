import { useCallback, useRef, useState } from "react";

// Drag-to-resize width for a left-side panel (handle on its right edge).
// Persists to localStorage under `key`. Returns the current width, a `dragging`
// flag (to suppress CSS width transitions mid-drag), and a pointerdown handler
// to attach to the drag handle.
export function useResizableWidth(key: string, def: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem(key));
    return v >= min && v <= max ? v : def;
  });
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      setWidth(Math.min(max, Math.max(min, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      setDragging(false);
      localStorage.setItem(key, String(widthRef.current));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [key, min, max]);

  return { width, dragging, startResize };
}
