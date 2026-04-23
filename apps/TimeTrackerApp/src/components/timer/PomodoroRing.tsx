interface Props {
  totalSeconds: number;
  remainingSeconds: number;
  phase: "work" | "break" | "long_break";
  size?: number;
}

export default function PomodoroRing({
  totalSeconds,
  remainingSeconds,
  phase,
  size = 120,
}: Props) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = totalSeconds > 0 ? remainingSeconds / totalSeconds : 1;
  const dashOffset = circumference * (1 - progress);
  const color =
    phase === "work"
      ? "var(--accent)"
      : phase === "break"
      ? "var(--success)"
      : "var(--warning)";

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--progress-bg)"
        strokeWidth={6}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}
