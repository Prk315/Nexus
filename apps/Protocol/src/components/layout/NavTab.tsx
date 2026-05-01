interface NavTabProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export default function NavTab({ label, active, onClick }: NavTabProps) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color: active ? "var(--accent)" : "var(--text-muted)",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        borderRadius: 0,
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      {label}
    </button>
  );
}
