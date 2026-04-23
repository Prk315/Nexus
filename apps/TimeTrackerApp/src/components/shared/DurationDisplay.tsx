import { formatDuration } from "../../lib/formatters";

interface Props {
  seconds: number;
  large?: boolean;
}

export default function DurationDisplay({ seconds, large }: Props) {
  return (
    <span
      style={{
        fontVariantNumeric: "tabular-nums",
        fontSize: large ? "3rem" : "1rem",
        fontWeight: large ? 200 : 400,
        letterSpacing: large ? "0.04em" : undefined,
        color: "var(--text)",
      }}
    >
      {formatDuration(seconds)}
    </span>
  );
}
