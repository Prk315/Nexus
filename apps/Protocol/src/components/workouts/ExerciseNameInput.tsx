import { useEffect, useState } from "react";
import { INPUT_SM } from "../../lib/uiHelpers";
import { searchExerciseLibrary } from "../../lib/exerciseLibrary";
import type { ExerciseLibraryItem } from "../../store/types";

/** Searchable exercise-name field backed by the shared library — picking a match
 *  fills the name and captures its muscles; free-typing is still allowed. Used by
 *  the routine designer and the session logger so logged names line up with the
 *  library (which is what lets the muscle map credit manual strength work). */
export default function ExerciseNameInput({
  value, onChange, placeholder = "Search exercises…",
}: {
  value: string;
  onChange: (name: string, primary: string[] | null, secondary: string[] | null) => void;
  placeholder?: string;
}) {
  const [results, setResults] = useState<ExerciseLibraryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      searchExerciseLibrary(q).then((r) => setResults(r)).finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        style={INPUT_SM}
        value={value}
        onChange={(e) => { onChange(e.target.value, null, null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && value.trim().length >= 2 && (results.length > 0 || loading) && (
        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, width: 300, maxWidth: "70vw", maxHeight: 240, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxShadow: "0 8px 24px rgba(0,0,0,0.25)", zIndex: 5 }}>
          {loading && results.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>Searching…</div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(r.name, r.primary_muscles, r.secondary_muscles); setOpen(false); }}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{r.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {r.primary_muscles.join(", ")}{r.equipment ? ` · ${r.equipment}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
