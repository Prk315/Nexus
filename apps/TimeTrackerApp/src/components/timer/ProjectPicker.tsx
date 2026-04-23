import { useState } from "react";
import { useAppSelector } from "../../hooks/useAppDispatch";

interface Props {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
}

export default function ProjectPicker({ value, onChange, disabled }: Props) {
  const categories = useAppSelector((s) => s.categories.items);
  const [open, setOpen] = useState(false);

  const allProjects: string[] = Object.entries(categories).flatMap(([cat, subs]) =>
    subs.length > 0 ? subs.map((s) => `${cat} / ${s}`) : [cat]
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        placeholder="Project (optional)"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        onFocus={() => !disabled && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
      />
      {open && allProjects.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow-md)",
            maxHeight: 180,
            overflowY: "auto",
            zIndex: 50,
          }}
        >
          {allProjects
            .filter((p) => !value || p.toLowerCase().includes(value.toLowerCase()))
            .map((p) => (
              <div
                key={p}
                onMouseDown={() => onChange(p)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background =
                    "var(--surface-raised)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "transparent")
                }
              >
                {p}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
