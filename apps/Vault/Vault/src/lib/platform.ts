// True when running inside the Tauri desktop shell (vs. a plain browser / the
// Vercel web deploy). Tauri 2 injects __TAURI_INTERNALS__ into the WebView.
// Used to gate Rust-backed features (invoke, native clipboard) that have no
// backend in the browser build.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
