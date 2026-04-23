interface Props {
  label: string;
  active: boolean;
  onClick: () => void;
}

export default function NavTab({ label, active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
        padding: "8px 14px",
        borderRadius: 0,
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        fontWeight: active ? 500 : 400,
        fontSize: 13,
        transition: "color 0.15s, border-color 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
