import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../utils";
import type { CalendarEvent } from "../types";

interface CalendarSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  /** The day to display — defaults to today */
  date?: Date;
  /** Events to render — empty until data sharing is implemented */
  events?: CalendarEvent[];
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 5); // 05:00 – 21:00

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function DayView({ date, events = [] }: { date: Date; events: CalendarEvent[] }) {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {HOURS.map((hour) => (
        <div key={hour} className="flex items-start gap-2 px-3 group">
          <span className="text-[10px] text-muted-foreground/50 w-10 pt-1 shrink-0 tabular-nums">
            {formatHour(hour)}
          </span>
          <div className="flex-1 border-t border-border min-h-[3rem] relative">
            {/* Current time indicator */}
            {isToday && currentMinutes >= hour * 60 && currentMinutes < (hour + 1) * 60 && (
              <div
                className="absolute left-0 right-0 flex items-center gap-1 z-10"
                style={{ top: `${((currentMinutes - hour * 60) / 60) * 100}%` }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 -ml-[3px]" />
                <div className="flex-1 h-px bg-red-500/60" />
              </div>
            )}
            {/* Events will render here once data sharing is implemented */}
            {events
              .filter((e) => parseInt(e.startTime.split(":")[0]) === hour)
              .map((event) => (
                <div
                  key={event.id}
                  className="mx-1 mt-0.5 px-2 py-1 rounded text-xs truncate"
                  style={{ backgroundColor: event.color ?? "hsl(var(--accent))" }}
                >
                  {event.title}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CalendarSidebar({ isOpen, onClose, date = new Date(), events = [] }: CalendarSidebarProps) {
  const dayLabel = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Portal to document.body so `position:fixed` always works regardless of parent CSS
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/20 transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-72 flex flex-col",
          "bg-background border-l border-border shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-11 border-b border-border shrink-0">
          <span className="text-sm font-medium truncate">{dayLabel}</span>
          <button
            onClick={onClose}
            className="h-6 w-6 rounded-full bg-red-500/20 hover:bg-red-500/40 transition-colors flex items-center justify-center shrink-0"
          >
            <X className="h-3.5 w-3.5 text-red-500" />
          </button>
        </div>

        {/* Day view */}
        <DayView date={date} events={events} />
      </div>
    </>,
    document.body
  );
}
