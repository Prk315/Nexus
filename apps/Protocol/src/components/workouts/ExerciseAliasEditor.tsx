import { useState } from "react";
import { INPUT_SM } from "../../lib/uiHelpers";

function AliasRow({ sourceKey, initial, onSave }: { sourceKey: string; initial: string; onSave: (key: string, name: string) => void }) {
  const [val, setVal] = useState(initial);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        title={sourceKey}
        style={{ fontSize: 12, color: "var(--text-muted)", width: 130, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {sourceKey}
      </span>
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>→</span>
      <input
        style={{ ...INPUT_SM, flex: 1, minWidth: 0 }}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { if (val !== initial) onSave(sourceKey, val); }}
        placeholder="Friendly name…"
      />
    </div>
  );
}

/** Maps each imported Garmin exercise key (category / exercise_name) to a friendly
 *  name. Clearing the field removes the alias. Saves on blur. */
export default function ExerciseAliasEditor({
  keys, aliases, onSave,
}: {
  keys: string[];
  aliases: Record<string, string>;
  onSave: (key: string, name: string) => void;
}) {
  if (keys.length === 0) return null;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Name imported exercises
      </div>
      {keys.map((k) => (
        <AliasRow key={k} sourceKey={k} initial={aliases[k] ?? ""} onSave={onSave} />
      ))}
    </div>
  );
}
