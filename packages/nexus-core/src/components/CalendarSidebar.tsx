import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../utils";
import type { CalendarEvent } from "../types";

interface CalendarSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  /** The day to display — defaults to today */
  date?: Date;
  /** Events to render */
  events?: CalendarEvent[];
  /** Clicking an empty hour row (for creating a block). */
  onSlotClick?: (hour: number) => void;
  /** Clicking an existing event (for editing/deleting). */
  onEventClick?: (event: CalendarEvent) => void;
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 5); // 05:00 – 21:00
const MIN_W = 260;
const STORAGE_KEY = "nexus.calendarSidebar.width";

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function DayView({
  date,
  events,
  onSlotClick,
  onEventClick,
}: {
  date: Date;
  events: CalendarEvent[];
  onSlotClick?: (hour: number) => void;
  onEventClick?: (event: CalendarEvent) => void;
}) {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {HOURS.map((hour) => {
        const hourEvents = events.filter(
          (e) => parseInt(e.startTime.split(":")[0]) === hour
        );
        return (
          <div key={hour} className="flex items-start gap-2 px-3 group">
            <span className="text-[10px] text-muted-foreground/50 w-10 pt-1 shrink-0 tabular-nums">
              {formatHour(hour)}
            </span>
            <div
              className="flex-1 border-t border-border min-h-[3rem] relative cursor-pointer hover:bg-accent/20 transition-colors"
              onClick={() => onSlotClick?.(hour)}
              title="Click to add a block"
            >
              {/* Current time indicator */}
              {isToday &&
                currentMinutes >= hour * 60 &&
                currentMinutes < (hour + 1) * 60 && (
                  <div
                    className="absolute left-0 right-0 flex items-center gap-1 z-10 pointer-events-none"
                    style={{ top: `${((currentMinutes - hour * 60) / 60) * 100}%` }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 -ml-[3px]" />
                    <div className="flex-1 h-px bg-red-500/60" />
                  </div>
                )}
              {hourEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick?.(event);
                  }}
                  className="block w-full text-left mx-1 mt-0.5 px-2 py-1 rounded text-xs truncate text-white/95 hover:opacity-80 transition-opacity"
                  style={{ backgroundColor: event.color ?? "hsl(var(--accent))" }}
                  title={`${event.startTime}–${event.endTime} ${event.title}`}
                >
                  {event.recurring && <span className="mr-1">🔁</span>}
                  <span className="tabular-nums opacity-80">{event.startTime}</span>{" "}
                  {event.title}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inline, resizable day-calendar column. Unlike a floating overlay, it lives in
 * the layout flow — the host places it as a flex sibling of its main content so
 * opening it pushes the content aside. Drag the left edge to resize; width is
 * persisted to localStorage. Renders nothing when closed.
 */
export function CalendarSidebar({
  isOpen,
  onClose,
  date = new Date(),
  events = [],
  onSlotClick,
  onEventClick,
}: CalendarSidebarProps) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 360;
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved && saved >= MIN_W ? saved : Math.round(window.innerWidth / 3);
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const maxW = Math.round(window.innerWidth * 0.8);
      const w = Math.min(maxW, Math.max(MIN_W, window.innerWidth - e.clientX));
      widthRef.current = w;
      setWidth(w);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const dayLabel = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div
      className="relative h-full flex flex-col bg-background border-l border-border shrink-0"
      style={{ width }}
    >
      {/* Drag handle on the left edge */}
      <div
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.userSelect = "none";
        }}
        className={cn(
          "absolute left-0 top-0 h-full w-1.5 -ml-[3px] z-20 cursor-col-resize",
          "hover:bg-accent/60 active:bg-accent transition-colors"
        )}
        title="Drag to resize"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 h-11 border-b border-border shrink-0">
        <span className="text-sm font-medium truncate">{dayLabel}</span>
        <button
          onClick={onClose}
          className="h-6 w-6 rounded-full bg-red-500/20 hover:bg-red-500/40 transition-colors flex items-center justify-center shrink-0"
          title="Close"
        >
          <X className="h-3.5 w-3.5 text-red-500" />
        </button>
      </div>

      <DayView
        date={date}
        events={events}
        onSlotClick={onSlotClick}
        onEventClick={onEventClick}
      />
    </div>
  );
}
