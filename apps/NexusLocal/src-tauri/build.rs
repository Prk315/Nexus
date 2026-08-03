fn main() {
    // On iOS the Swift FFI symbols (store_session_c / clear_session_c in
    // WidgetBridge.swift) are compiled into the app binary by Xcode's Swift
    // compiler, not into libapp.a / the cdylib. The cdylib link step runs before
    // Xcode adds the Swift objects, so tell ld64 to defer resolution of
    // undefined symbols to the final Xcode link. (Mirrors TimeTracker.)
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rustc-link-arg=-undefined");
        println!("cargo:rustc-link-arg=dynamic_lookup");
    }
    tauri_build::build()
}
