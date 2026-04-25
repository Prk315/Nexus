fn main() {
    // On iOS the Swift FFI symbol (apply_content_blocker_rules_c) is compiled
    // into the app binary by Xcode's Swift compiler, not into libapp.a/cdylib.
    // The cdylib link step runs before Xcode adds the Swift objects, so we tell
    // ld64 to defer resolution of undefined symbols to the final Xcode link.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rustc-link-arg=-undefined");
        println!("cargo:rustc-link-arg=dynamic_lookup");
    }
    tauri_build::build()
}
