/**
 * Body-type matrix: fat level (rows) × muscle mass (columns). The cell where
 * the person currently sits is highlighted with the accent. Axis captions run
 * along the left (fat %) and bottom (muscle mass), matching the "Body type
 * analysis" block of a bio-impedance report. Presentational.
 */

export type Level = "low" | "standard" | "high";

const FAT_ROWS: Level[] = ["high", "standard", "low"];
const MUSCLE_COLS: Level[] = ["low", "standard", "high"];

const CELL_LABEL: Record<string, string> = {
  "high-low": "Obese", "high-standard": "Overfat", "high-high": "Overfat muscular",
  "standard-low": "Low active", "standard-standard": "Standard", "standard-high": "Standard muscular",
  "low-low": "Lean", "low-standard": "Fit", "low-high": "Athletic",
};

const LEVEL_LABEL: Record<Level, string> = { low: "Low", standard: "Standard", high: "High" };

export default function BodyTypeGrid({ fat, muscle }: { fat: Level; muscle: Level }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Fat %
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {FAT_ROWS.map((row) =>
            MUSCLE_COLS.map((col) => {
              const active = row === fat && col === muscle;
              return (
                <div
                  key={`${row}-${col}`}
                  style={{
                    padding: "12px 8px",
                    borderRadius: "var(--radius-sm)",
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    background: active ? "var(--accent)" : "var(--bg)",
                    color: active ? "var(--accent-fg)" : "var(--text-secondary)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  }}
                >
                  {CELL_LABEL[`${row}-${col}`]}
                </div>
              );
            }),
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {MUSCLE_COLS.map((col) => (
            <div key={col} style={{ textAlign: "center", fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>
              {LEVEL_LABEL[col]}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Muscle mass
        </div>
      </div>
    </div>
  );
}
