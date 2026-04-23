import { useState, useEffect } from "react";
import { cn } from "../utils";

interface LifeBarProps {
  birthDate: string | Date;
  expectedLifespanYears?: number;
  className?: string;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function getNextBirthday(birth: Date, now: Date): Date {
  const d = new Date(birth);
  d.setFullYear(now.getFullYear());
  if (d <= now) d.setFullYear(now.getFullYear() + 1);
  return d;
}

function getLastBirthday(birth: Date, now: Date): Date {
  const next = getNextBirthday(birth, now);
  const last = new Date(next);
  last.setFullYear(next.getFullYear() - 1);
  return last;
}

function getStartOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(5, 0, 0, 0);
  return d;
}

function getEndOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(22, 0, 0, 0);
  return d;
}

function getStartOfWeek(now: Date): Date {
  const d = new Date(now);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // roll back to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfWeek(now: Date): Date {
  const start = getStartOfWeek(now);
  const d = new Date(start);
  d.setDate(d.getDate() + 7);
  return d;
}

function getStartOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function getEndOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

// ── Format helpers ────────────────────────────────────────────────────────────

function toSeconds(ms: number): string {
  return `${Math.max(Math.floor(ms / 1000), 0).toLocaleString()}s`;
}

// ── Period section ────────────────────────────────────────────────────────────

interface PeriodProps {
  label: string;
  elapsedMs: number;
  totalMs: number;
  remainingMs: number;
}

function Period({ label, elapsedMs, totalMs, remainingMs }: PeriodProps) {
  const pct = Math.min((elapsedMs / totalMs) * 100, 100);
  const remainingS = Math.max(Math.floor(remainingMs / 1000), 0);

  return (
    <div className="flex-1 flex flex-col gap-1 px-3 py-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          {pct.toFixed(1)}%
        </span>
      </div>

      {/* Mini progress bar */}
      <div className="h-px w-full bg-muted">
        <div
          className="h-full bg-red-500/50 transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/70">
        <span>{toSeconds(elapsedMs)} used</span>
        <span>{remainingS.toLocaleString()}s left</span>
      </div>
    </div>
  );
}

// ── LifeBar ───────────────────────────────────────────────────────────────────

export function LifeBar({ birthDate, expectedLifespanYears = 78, className }: LifeBarProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const birth = new Date(birthDate);
  const expectedDeath = new Date(birth);
  expectedDeath.setFullYear(birth.getFullYear() + expectedLifespanYears);

  // Life
  const lifeTotalMs = expectedDeath.getTime() - birth.getTime();
  const lifeElapsedMs = now.getTime() - birth.getTime();
  const lifePct = Math.min((lifeElapsedMs / lifeTotalMs) * 100, 100);
  const lifeRemainingS = Math.max(Math.floor((expectedDeath.getTime() - now.getTime()) / 1000), 0);

  // Periods
  const nextBirthday = getNextBirthday(birth, now);
  const lastBirthday = getLastBirthday(birth, now);

  const periods: PeriodProps[] = [
    {
      label: "🎂 birthday",
      elapsedMs: now.getTime() - lastBirthday.getTime(),
      totalMs: nextBirthday.getTime() - lastBirthday.getTime(),
      remainingMs: nextBirthday.getTime() - now.getTime(),
    },
    {
      label: "month",
      elapsedMs: now.getTime() - getStartOfMonth(now).getTime(),
      totalMs: getEndOfMonth(now).getTime() - getStartOfMonth(now).getTime(),
      remainingMs: getEndOfMonth(now).getTime() - now.getTime(),
    },
    {
      label: "week",
      elapsedMs: now.getTime() - getStartOfWeek(now).getTime(),
      totalMs: getEndOfWeek(now).getTime() - getStartOfWeek(now).getTime(),
      remainingMs: getEndOfWeek(now).getTime() - now.getTime(),
    },
    {
      label: "day",
      elapsedMs: Math.max(now.getTime() - getStartOfDay(now).getTime(), 0),
      totalMs: getEndOfDay(now).getTime() - getStartOfDay(now).getTime(),
      remainingMs: Math.max(getEndOfDay(now).getTime() - now.getTime(), 0),
    },
  ];

  return (
    <div className={cn("border-b border-border bg-background", className)}>

      {/* Life row */}
      <div className="h-px w-full bg-muted">
        <div
          className="h-full bg-gradient-to-r from-red-500/60 to-red-400/40 transition-none"
          style={{ width: `${lifePct}%` }}
        />
      </div>
      <div className="flex items-center gap-3 px-4 h-6 text-[11px] text-muted-foreground">
        <span className="font-medium tabular-nums">{lifePct.toFixed(2)}% of life</span>
        <span className="text-border">·</span>
        <span className="tabular-nums">{lifeRemainingS.toLocaleString()}s remaining</span>
      </div>

      {/* Period columns */}
      <div className="flex border-t border-border divide-x divide-border">
        {periods.map((p) => (
          <Period key={p.label} {...p} />
        ))}
      </div>

    </div>
  );
}
