import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ScanDevice = {
  id: string;
  name: string;
  rssi: number;
  serviceUUIDs: string[];
  manufacturerData: string;
};
type Char = { uuid: string; properties: string[] };
type Service = { uuid: string; characteristics: Char[] };
type Snapshot = {
  status?: string;
  scanning?: boolean;
  devices?: ScanDevice[];
  connected?: { name?: string; connected?: boolean; error?: string; services?: Service[] };
  frames?: { char: string; hex: string; len: number }[];
};

/// In-app BLE recon: scan nearby devices to fingerprint the Vellafit scale
/// (name / service UUIDs / manufacturer data). Enter the scale's name and scan
/// again to connect, dump its GATT, and capture raw measurement frames.
/// Runs on a physical iPhone only (the simulator has no Bluetooth).
export function BleScan() {
  const [filter, setFilter] = useState("");
  const [snap, setSnap] = useState<Snapshot>({});
  const [scanning, setScanning] = useState(false);
  const poll = useRef<number | null>(null);

  function refresh() {
    invoke<string>("ble_scan_results")
      .then((s) => { try { setSnap(JSON.parse(s)); } catch {} })
      .catch(() => {});
  }

  function startScan() {
    setScanning(true);
    setSnap({});
    invoke("ble_scan_start", { seconds: 20, connectFilter: filter.trim() }).catch(() => {});
    if (poll.current) clearInterval(poll.current);
    poll.current = window.setInterval(refresh, 1000) as unknown as number;
    window.setTimeout(() => {
      if (poll.current) { clearInterval(poll.current); poll.current = null; }
      setScanning(false);
      refresh();
    }, 23000);
  }

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const devices = snap.devices ?? [];
  const connected = snap.connected;
  const frames = snap.frames ?? [];

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
          {scanning ? "Scanning…" : "Scan 20s"}
        </button>
      </div>

      {snap.status && (
        <div className="text-[10px] text-white/35">status: {snap.status}</div>
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
              <div className="text-[10px] uppercase tracking-wide text-white/35">frames</div>
              {frames.slice(-8).map((f, i) => (
                <div key={i} className="font-mono text-[10px] text-amber-300/80 break-all">
                  {f.char.slice(0, 8)}… {f.hex}
                </div>
              ))}
            </div>
          )}
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
