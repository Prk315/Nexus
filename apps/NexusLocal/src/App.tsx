import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BleScan } from "./lib/BleScan";

type ModuleManifest = {
  id: string;
  name: string;
  version: string;
  actions: string[];
  tick_interval_secs: number | null;
};

type GridStatus = {
  device_id: string;
  platform: string;
  hostname: string;
  version: string;
  supabase_configured: boolean;
  modules: ModuleManifest[];
};

export default function App() {
  const [status, setStatus] = useState<GridStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<GridStatus>("grid_status")
        .then((s) => alive && setStatus(s))
        .catch((e) => alive && setErr(String(e)));
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-screen p-6 flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-600 grid place-items-center text-lg">
          ◈
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Nexus Local</h1>
          <p className="text-xs text-white/40">Local grid · background services node</p>
        </div>
        <span
          className={`ml-auto text-xs px-2 py-1 rounded-full ${
            status?.supabase_configured
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {status?.supabase_configured ? "● online" : "○ no backend"}
        </span>
      </header>

      {err && (
        <div className="text-xs text-red-300 bg-red-500/10 rounded-lg p-3">{err}</div>
      )}

      {status && (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label="Device" value={status.hostname} />
          <Field label="Platform" value={status.platform} />
          <Field label="Node ID" value={status.device_id.slice(0, 8)} />
          <Field label="Version" value={status.version} />
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-wide text-white/40">
          Installed modules
        </h2>
        {status?.modules.length ? (
          status.modules.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.name}</span>
                <span className="text-[10px] text-white/40">v{m.version}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.actions.map((a) => (
                  <span
                    key={a}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-white/30">No modules registered.</p>
        )}
      </section>

      <BleScan />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-0.5 font-mono text-white/80 truncate">{value}</div>
    </div>
  );
}
