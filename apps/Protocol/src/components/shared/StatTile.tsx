export function StatTile({
  label, value, sub, color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 96 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--text)", lineHeight: 1.15 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</span>}
    </div>
  );
}
