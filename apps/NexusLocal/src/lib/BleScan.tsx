import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabasePublic } from "./supabase";
import { decodeFrames, computeBodyComp, toBodyMetricsRow, type BodyComp, type Segments } from "./bodyScan";

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ScanDevice = {
  id: string;
  name: string;
  rssi: number;
  serviceUUIDs: string[];
  manufacturerData: string;
  advHistory?: string[];
};
type Char = { uuid: string; properties: string[] };
type Service = { uuid: string; characteristics: Char[] };
type Snapshot = {
  status?: string;
  scanning?: boolean;
  devices?: ScanDevice[];
  connected?: { name?: string; connected?: boolean; error?: string; services?: Service[] };
  frames?: { char: string; hex: string; len: number }[];
  log?: string[];
};

// Candidate QN/Yolanda handshake writes to try against FFF1 — the sequence that
// flips the scale out of weight-only mode into a full body-composition measurement
// (impedance). Edit the field freely; these are just starting points.
const PRESETS: { label: string; hex: string }[] = [
  { label: "QN start A", hex: "130915" },
  { label: "QN start B", hex: "1f05151000000000" },
  { label: "unit kg", hex: "1305150001" },
  { label: "wake 0x02", hex: "02" },
];

/// In-app BLE recon for the Vellafit (QN/Yolanda FFF0) scale. Scan to fingerprint,
/// enter the scale name to connect + dump GATT + capture FFF4 frames, and send a
/// handshake write to FFF1 to unlock impedance. Physical iPhone only.
export function BleScan() {
  const [filter, setFilter] = useState("CF597_GNLine");
  const [handshake, setHandshake] = useState("");
  const [hsChar, setHsChar] = useState("FFF1");
  const [snap, setSnap] = useState<Snapshot>({});
  const [scanning, setScanning] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [bodyComp, setBodyComp] = useState<BodyComp | null>(null);
  const [segs, setSegs] = useState<{ seg0: Segments | null; seg1: Segments | null }>({ seg0: null, seg1: null });
  const [saveMsg, setSaveMsg] = useState("");
  const poll = useRef<number | null>(null);

  // Decode weight + segment impedances + body composition whenever frames update.
  useEffect(() => {
    const frames = snap.frames ?? [];
    if (!frames.length) return;
    const { weightKg, seg0, seg1 } = decodeFrames(frames);
    setSegs({ seg0, seg1 });
    setBodyComp(weightKg && seg0 ? computeBodyComp(weightKg, seg0) : null);
  }, [snap.frames]);

  async function saveToProtocol() {
    if (!bodyComp) return;
    setSaveMsg("saving…");
    const row = toBodyMetricsRow(bodyComp, segs.seg0, segs.seg1, todayLocal());
    try {
      const { data: existing } = await supabasePublic
        .from("protocol_body_metrics")
        .select("id")
        .eq("user_id", row.user_id)
        .eq("date", row.date)
        .limit(1);
      const q =
        existing && existing.length
          ? supabasePublic.from("protocol_body_metrics").update(row).eq("id", existing[0].id)
          : supabasePublic.from("protocol_body_metrics").insert(row);
      const { error } = await q;
      setSaveMsg(error ? `save failed: ${error.message}` : `saved to Protocol ✓ (${row.date})`);
    } catch (e) {
      setSaveMsg(`save failed: ${String(e)}`);
    }
  }

  function refresh() {
    invoke<string>("ble_scan_results")
      .then((s) => { try { setSnap(JSON.parse(s)); } catch {} })
      .catch(() => {});
  }

  // Upload the full capture to Supabase so the complete be/df body-comp sequence
  // is never lost to the rolling on-screen list (and no phone-juggling with hands
  // on the electrodes). Reads the latest JSON straight from the bridge.
  async function uploadCapture(label: string) {
    setUploadMsg("saving…");
    try {
      const raw = await invoke<string>("ble_scan_results");
      const s = JSON.parse(raw) as Snapshot;
      const { error } = await supabasePublic.from("nexus_ble_captures").insert({
        label,
        device_name: s.connected?.name ?? null,
        frame_count: s.frames?.length ?? 0,
        snapshot: s,
      });
      setUploadMsg(error ? `save failed: ${error.message}` : `saved ✓ (${s.frames?.length ?? 0} frames)`);
    } catch (e) {
      setUploadMsg(`save failed: ${String(e)}`);
    }
  }

  function startScan() {
    setScanning(true);
    setSnap({});
    invoke("ble_scan_start", {
      seconds: 60,   // stay connected through the full body scan (impedance)
      connectFilter: filter.trim(),
      handshakeHex: handshake.trim(),
      handshakeChar: hsChar.trim() || "FFF1",
    }).catch(() => {});
    if (poll.current) clearInterval(poll.current);
    poll.current = window.setInterval(refresh, 1000) as unknown as number;
    window.setTimeout(() => {
      if (poll.current) { clearInterval(poll.current); poll.current = null; }
      setScanning(false);
      refresh();
      // Auto-save the full capture so nothing is lost with hands on the electrodes.
      uploadCapture("auto");
    }, 63000);
  }

  function sendWrite(hex: string) {
    invoke("ble_write", { hex: hex.trim(), charUuid: hsChar.trim() || "FFF1" }).catch(() => {});
    setTimeout(refresh, 400);
  }

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const devices = snap.devices ?? [];
  const connected = snap.connected;
  const frames = snap.frames ?? [];
  const isConnected = !!connected?.connected;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-wide text-white/40">BLE scan · recon</h2>

      <div className="flex gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="connect filter (scale name, optional)"
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80 placeholder:text-white/25"
        />
        <button
          onClick={startScan}
          disabled={scanning}
          className={`rounded-lg px-3 py-2 text-xs font-medium ${
            scanning ? "bg-white/10 text-white/40" : "bg-indigo-500/20 text-indigo-300"
          }`}
        >
          {scanning ? "Scanning…" : "Scan 60s"}
        </button>
      </div>

      {/* Handshake: bytes written to FFF1 after connect to trigger impedance. */}
      <div className="flex gap-2">
        <input
          value={handshake}
          onChange={(e) => setHandshake(e.target.value)}
          placeholder="handshake hex → FFF1 (e.g. 130915)"
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-amber-200/80 placeholder:text-white/25"
        />
        <input
          value={hsChar}
          onChange={(e) => setHsChar(e.target.value)}
          className="w-16 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-center font-mono text-xs text-white/70"
        />
        <button
          onClick={() => sendWrite(handshake)}
          disabled={!isConnected || !handshake.trim()}
          className={`rounded-lg px-3 py-2 text-xs font-medium ${
            isConnected && handshake.trim()
              ? "bg-amber-500/20 text-amber-300"
              : "bg-white/10 text-white/30"
          }`}
        >
          Write
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setHandshake(p.hex)}
            className="rounded bg-white/[0.05] px-2 py-1 text-[10px] text-white/50 hover:text-white/80"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => uploadCapture("manual")}
          className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-300"
        >
          ☁ Save capture
        </button>
        {uploadMsg && <span className="text-[10px] text-white/45">{uploadMsg}</span>}
      </div>

      {snap.status && (
        <div className="text-[10px] text-white/35">
          status: {snap.status}{isConnected ? " · connected" : ""}
        </div>
      )}

      {devices.map((d) => (
        <div key={d.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-white/90">{d.name || "(no name)"}</span>
            <span className="text-white/40">{d.rssi} dBm</span>
          </div>
          {d.serviceUUIDs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {d.serviceUUIDs.map((u) => (
                <span key={u} className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">{u}</span>
              ))}
            </div>
          )}
          {d.manufacturerData && (
            <div className="mt-1 font-mono text-[10px] text-white/40 break-all">mfg: {d.manufacturerData}</div>
          )}
          {d.advHistory && d.advHistory.length > 0 && (
            <div className="mt-1 font-mono text-[10px] text-emerald-300/70 break-all">
              {d.advHistory.map((h, i) => <div key={i}>adv: {h}</div>)}
            </div>
          )}
        </div>
      ))}

      {connected?.name && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
          <div className="font-medium text-emerald-300">
            connected: {connected.name} {connected.error ? `· ${connected.error}` : ""}
          </div>
          {(connected.services ?? []).map((s) => (
            <div key={s.uuid} className="mt-2">
              <div className="font-mono text-[10px] text-white/60">svc {s.uuid}</div>
              {s.characteristics.map((c) => (
                <div key={c.uuid} className="ml-3 font-mono text-[10px] text-white/45">
                  {c.uuid} [{c.properties.join(",")}]
                </div>
              ))}
            </div>
          ))}
          {frames.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wide text-white/35">frames ({frames.length})</div>
              {frames.slice(-14).map((f, i) => (
                <div key={i} className="font-mono text-[10px] text-amber-300/80 break-all">
                  {f.char.slice(0, 8)}… {f.hex}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {bodyComp && (
        <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-fuchsia-300">Body composition</h3>
            <span className="text-[9px] text-white/35">estimate · calibrating</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Metric label="Weight" value={`${bodyComp.weightKg}`} unit="kg" big />
            <Metric label="Body fat" value={`${bodyComp.bodyFatPct}`} unit="%" />
            <Metric label="Fat mass" value={`${bodyComp.fatMassKg}`} unit="kg" />
            <Metric label="Muscle" value={`${bodyComp.muscleMassKg}`} unit="kg" />
            <Metric label="Water" value={`${bodyComp.bodyWaterPct}`} unit="%" />
            <Metric label="FFM" value={`${bodyComp.fatFreeMassKg}`} unit="kg" />
            <Metric label="Skel. muscle" value={`${bodyComp.skeletalMuscleKg}`} unit="kg" />
            <Metric label="Bone" value={`${bodyComp.boneMassKg}`} unit="kg" />
            <Metric label="BMI" value={`${bodyComp.bmi}`} unit="" />
            <Metric label="BMR" value={`${bodyComp.bmrKcal}`} unit="kcal" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={saveToProtocol}
              className="rounded-lg bg-fuchsia-500/25 px-3 py-1.5 text-xs font-medium text-fuchsia-200"
            >
              Save to Protocol
            </button>
            {saveMsg && <span className="text-[10px] text-white/45">{saveMsg}</span>}
          </div>
        </div>
      )}

      {snap.log && snap.log.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
          <div className="text-[10px] uppercase tracking-wide text-white/35">log</div>
          {snap.log.slice(-8).map((l, i) => (
            <div key={i} className="font-mono text-[10px] text-white/45 break-all">{l}</div>
          ))}
        </div>
      )}

      {!scanning && devices.length === 0 && (
        <p className="text-[10px] text-white/30">
          Scan finds nearby BLE devices. Physical iPhone only — the simulator has no Bluetooth.
        </p>
      )}
    </section>
  );
}

function Metric({ label, value, unit, big }: { label: string; value: string; unit: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-0.5">
        <span className={`font-semibold text-white/90 ${big ? "text-base" : "text-sm"}`}>{value}</span>
        {unit && <span className="ml-0.5 text-[9px] text-white/40">{unit}</span>}
      </div>
    </div>
  );
}
