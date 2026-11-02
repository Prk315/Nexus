import type { ReactNode } from "react";
import { PHASE_COLOR, type Phase } from "./pomodoro";

/**
 * Progress ring, shared by the panel and the floating window. The rotation is
 * an SVG attribute on the circle rather than a CSS `transform` on the `<svg>` —
 * `transform-origin` on SVG elements is inconsistent in WKWebView, which is the
 * only engine this app ships against.
 */
export function PomodoroRing({
  total,
  remaining,
  phase,
  size = 84,
  stroke = 6,
  children,
}: {
  total: number;
  remaining: number;
  phase: Phase;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 1;
  const center = size / 2;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0" aria-hidden>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={PHASE_COLOR[phase]}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      )}
    </div>
  );
}

/** One dot per focus block in the cycle, filled as they are done. */
export function CycleDots({ done, total, phase }: { done: number; total: number; phase: Phase }) {
  // A 50-block "cycle" is a config choice, not something to draw dot by dot.
  if (total > 8) {
    return (
      <span className="font-mono text-[10px] text-white/40">
        {done}/{total}
      </span>
    );
  }
  return (
    <span className="inline-flex gap-1" aria-label={`${done} of ${total} done`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: i < done ? PHASE_COLOR[phase] : "rgba(255,255,255,0.15)" }}
        />
      ))}
    </span>
  );
}
