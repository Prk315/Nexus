import { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle, X } from "lucide-react";
import { parseStravaActivities, type StravaImportResult } from "../../lib/importers/strava";
import { pushRunningSessionToCloud, pushWorkoutSessionToCloud } from "../../lib/api";
import { CARD_STYLE } from "../../lib/uiHelpers";

type Mode = "all" | "running" | "workouts";

interface Props {
  /** Restrict which activity types are imported and shown. */
  mode?: Mode;
  onImported: () => void;
}

export default function StravaImportPanel({ mode = "all", onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<StravaImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDone(null);
    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseStravaActivities(text);
      if (result.runningSessions.length === 0 && result.workoutSessions.length === 0 && result.skipped > 0) {
        setError("No recognisable activities found. Make sure you're using activities.csv from a Strava data export.");
        setPreview(null);
        return;
      }
      setPreview(result);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      let count = 0;
      if (mode !== "workouts") {
        for (const s of preview.runningSessions) {
          await pushRunningSessionToCloud(s);
          count++;
        }
      }
      if (mode !== "running") {
        for (const s of preview.workoutSessions) {
          await pushWorkoutSessionToCloud(s);
          count++;
        }
      }
      setDone(`Imported ${count} activities from ${fileName}.`);
      setPreview(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setPreview(null);
    setFileName("");
    setDone(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const runCount     = preview?.runningSessions.length ?? 0;
  const workoutCount = preview?.workoutSessions.length ?? 0;
  const totalCount   = (mode !== "workouts" ? runCount : 0) + (mode !== "running" ? workoutCount : 0);

  return (
    <div style={{ ...CARD_STYLE, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
            Import from Strava
          </span>
          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)" }}>
            activities.csv from your Strava data export
          </span>
        </div>

        <label
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px",
            background: "#fc4c0222", color: "#fc4c02",
            border: "1px solid #fc4c0244",
            borderRadius: "var(--radius-sm)",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Upload size={13} />
          Choose file
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
        </label>
      </div>

      {preview && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "10px 14px",
              fontSize: 13, color: "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}
          >
            <span>
              <strong style={{ color: "var(--text)" }}>{fileName}</strong>
              {" · "}
              {mode !== "workouts" && (
                <><strong style={{ color: "#f97316" }}>{runCount}</strong>{" runs "}</>
              )}
              {mode !== "running" && (
                <><strong style={{ color: "#10b981" }}>{workoutCount}</strong>{" workouts "}</>
              )}
              {preview.skipped > 0 && (
                <span style={{ color: "#f59e0b", marginLeft: 4 }}>
                  ({preview.skipped} skipped)
                </span>
              )}
            </span>
            <button onClick={reset} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, display: "flex" }}>
              <X size={14} />
            </button>
          </div>

          <button
            onClick={handleImport}
            disabled={importing || totalCount === 0}
            style={{
              alignSelf: "flex-start", padding: "7px 16px",
              background: "#fc4c02", color: "#fff",
              border: "none", borderRadius: "var(--radius-sm)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              opacity: importing ? 0.7 : 1,
            }}
          >
            {importing ? "Importing…" : `Import ${totalCount} activities`}
          </button>
        </div>
      )}

      {done && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#10b981", fontSize: 13, marginTop: 10 }}>
          <CheckCircle size={14} /> {done}
        </div>
      )}
      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#ef4444", fontSize: 13, marginTop: 10 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  );
}
