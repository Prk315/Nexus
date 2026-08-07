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

    nexus_local_lib::run();
}
