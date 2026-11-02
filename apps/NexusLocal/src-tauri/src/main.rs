#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // One binary, two roles. `--daemon` is the headless background service the
    // LaunchAgent runs (see `enforcement.rs`); without it this is the normal
    // desktop app. Sharing the binary means the daemon is already inside the
    // installed `.app` bundle — there is no second artefact to build, ship,
    // install or keep in version lockstep.
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    if std::env::args().skip(1).any(|arg| arg == "--daemon") {
        nexus_local_lib::run_daemon();
        return;
    }

    // A third role: one root pass over /etc/hosts, run every 30s by the system
    // LaunchDaemon `hosts_enforcer.rs` installs. The argument is its config.
    #[cfg(target_os = "macos")]
    {
        let args: Vec<String> = std::env::args().collect();
        if let Some(i) = args.iter().position(|a| a == "--hosts-enforcer") {
            let config = args.get(i + 1).map(String::as_str).unwrap_or("");
            std::process::exit(nexus_local_lib::run_hosts_enforcer(config));
        }
    }

    nexus_local_lib::run();
}
