import { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle, X } from "lucide-react";
import { detectOuraType, parseOuraCSV, type OuraImportResult } from "../../lib/importers/oura";
import { pushSleepToCloud, pushBodyMetricToCloud } from "../../lib/api";
import { CARD_STYLE } from "../../lib/uiHelpers";

interface Props {
  onImported: () => void;
}

export default function OuraImportPanel({ onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<OuraImportResult | null>(null);
  const [detectedType, setDetectedType] = useState("");
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
      const type = detectOuraType(text);

      if (type === "unknown") {
        setError("Could not detect Oura format — expected sleep.csv or readiness.csv.");
        setPreview(null);
        return;
      }

      setDetectedType(type);
      const result = parseOuraCSV(text);
      setPreview(result);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      for (const e of preview.sleepEntries) await pushSleepToCloud(e);
      for (const m of preview.bodyMetrics)  await pushBodyMetricToCloud(m);
      const total = preview.sleepEntries.length + preview.bodyMetrics.length;
      setDone(`Imported ${total} entries from ${fileName}.`);
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

  return (
    <div style={{ ...CARD_STYLE, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
            Import from Oura Ring
          </span>
          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)" }}>
            sleep.csv · readiness.csv
          </span>
        </div>

        <label
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px",
            background: "var(--accent)22", color: "var(--accent)",
            border: "1px solid var(--accent)44",
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
              {" · "}detected: <strong style={{ color: "var(--text)" }}>{detectedType}</strong>
              {" · "}
              <strong style={{ color: "var(--accent)" }}>{preview.sleepEntries.length}</strong> sleep
              {" + "}
              <strong style={{ color: "var(--accent)" }}>{preview.bodyMetrics.length}</strong> body metric entries
              {preview.warnings.length > 0 && (
                <span style={{ color: "#f59e0b", marginLeft: 8 }}>
                  ({preview.warnings.length} rows skipped)
                </span>
              )}
            </span>
            <button onClick={reset} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, display: "flex" }}>
              <X size={14} />
            </button>
          </div>

          <button
            onClick={handleImport}
            disabled={importing || (preview.sleepEntries.length === 0 && preview.bodyMetrics.length === 0)}
            style={{
              alignSelf: "flex-start", padding: "7px 16px",
              background: "var(--accent)", color: "#fff",
              border: "none", borderRadius: "var(--radius-sm)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              opacity: importing ? 0.7 : 1,
            }}
          >
            {importing ? "Importing…" : "Import all"}
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
