import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNexusAuth } from "@nexus/core";

/// Diagnostics for the app↔widget session channel.
///
/// The App Group bridge died because signing succeeded while the runtime
/// container was NIL (commit bbf60f1) — a failure invisible from the build log.
/// The shared keychain is the candidate replacement, so it gets the same
/// treatment: read the state out of BOTH processes and compare, rather than
/// inferring from whether the app compiled.
///
/// How to read it against the widget's badge:
///   app sess:yes + widget badge `anon`  → the keychain group did NOT survive
///                                          re-signing; the two processes are
///                                          looking at different keychains.
///   app sess:no                          → nothing was ever written (signed
///                                          out, or the write was denied) —
///                                          the sharing question is unanswered.
///   app sess:yes + widget badge `kc`     → sharing works.
export function KeychainDebug() {
  const { session } = useNexusAuth();
  const [keychain, setKeychain] = useState("…");
  const [appGroup, setAppGroup] = useState("…");

  useEffect(() => {
    invoke<string>("keychain_debug")
      .then(setKeychain)
      .catch((e) => setKeychain(`error: ${e}`));
    invoke<string>("appgroup_debug")
      .then(setAppGroup)
      .catch((e) => setAppGroup(`error: ${e}`));
  }, [session]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[10px] uppercase tracking-wide text-white/35">
        Widget session channel
      </h2>
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[10px] leading-relaxed text-white/70">
        <div className={session ? "text-emerald-300" : "text-amber-300"}>
          app auth: {session ? `signed in (${session.user.id.slice(0, 8)}…)` : "SIGNED OUT"}
        </div>
        <pre className="mt-1 whitespace-pre-wrap break-all">{keychain}</pre>
        <pre className="mt-1 whitespace-pre-wrap break-all text-white/45">{appGroup}</pre>
      </div>
      <p className="text-[10px] text-white/30">
        Compare with the Habits widget badge: app <span className="font-mono">sess:yes</span> but a
        widget showing <span className="font-mono">anon</span> means the shared keychain group did
        not survive re-signing.
      </p>
    </section>
  );
}
