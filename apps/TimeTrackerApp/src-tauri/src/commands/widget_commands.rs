use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Apply the collection-behavior flags and window level that make a floating
/// widget sticky across all macOS Spaces, including fullscreen apps.
///
/// Uses raw_window_handle instead of with_webview so it works as soon as the
/// OS window exists — with_webview requires the webview page to have loaded,
/// which is not guaranteed at creation time or even at first toggle time.
///
/// MUST be called from the main thread (NSWindow APIs are not thread-safe).
#[cfg(target_os = "macos")]
fn apply_macos_workspace_behavior<R: Runtime>(window: &WebviewWindow<R>) {
    #[allow(unused_imports)]
    use objc::{msg_send, sel, sel_impl, runtime::Object};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let Ok(handle) = window.window_handle() else { return };
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else { return };

    // ns_view is the root NSView of the OS window (not the WKWebView).
    // [NSView window] gives us the NSWindow we need.
    let ns_view = appkit.ns_view.as_ptr() as *mut Object;
    unsafe {
        let ns_window: *mut Object = msg_send![ns_view, window];
        if ns_window.is_null() {
            return;
        }

        // NSWindowCollectionBehaviorCanJoinAllSpaces  = 1 << 0
        // NSWindowCollectionBehaviorStationary        = 1 << 4
        // NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8
        let behavior: u64 = (1 << 0) | (1 << 4) | (1 << 8);
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

        // NSStatusWindowLevel = 25 — above all normal and fullscreen app windows.
        // Tauri's always_on_top only reaches NSFloatingWindowLevel (3) which sits
        // below fullscreen content; 25 ensures the widget is on top everywhere.
        let _: () = msg_send![ns_window, setLevel: 25_i64];
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_workspace_behavior<R: Runtime>(_window: &WebviewWindow<R>) {}

/// Called once per widget window at startup so the behavior is set as early
/// as possible (the OS window exists immediately after build()).
pub fn configure_widget<R: Runtime>(window: &WebviewWindow<R>) {
    apply_macos_workspace_behavior(window);
}

/// Invoked from the frontend to show or hide all widget windows.
/// All NSWindow work runs on the main thread via run_on_main_thread so the
/// raw pointer access in apply_macos_workspace_behavior is thread-safe.
///
/// This command is desktop-only — hide/show/is_visible are not available on
/// mobile platforms (iOS/Android).
#[tauri::command]
pub fn toggle_widgets(app: AppHandle) {
    #[cfg(desktop)]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let widgets: Vec<_> = handle
                .webview_windows()
                .into_iter()
                .filter(|(label, _)| label.starts_with("widget"))
                .map(|(_, win)| win)
                .collect();

            let Some(first) = widgets.first() else { return };
            let visible = first.is_visible().unwrap_or(false);

            for win in &widgets {
                if visible {
                    let _ = win.hide();
                } else {
                    let _ = win.show();
                    // Re-apply every time we show so the flags survive
                    // any hide → show cycle.
                    apply_macos_workspace_behavior(win);
                }
            }
        });
    }
    #[cfg(mobile)]
    {
        let _ = app; // no-op on mobile
    }
}

/// Invoked from the tray to show or hide all pie-widget windows.
#[tauri::command]
pub fn toggle_pie_widgets(app: AppHandle) {
    #[cfg(desktop)]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let widgets: Vec<_> = handle
                .webview_windows()
                .into_iter()
                .filter(|(label, _)| label.starts_with("pie_widget"))
                .map(|(_, win)| win)
                .collect();

            let Some(first) = widgets.first() else { return };
            let visible = first.is_visible().unwrap_or(false);

            for win in &widgets {
                if visible {
                    let _ = win.hide();
                } else {
                    let _ = win.show();
                    apply_macos_workspace_behavior(win);
                }
            }
        });
    }
    #[cfg(mobile)]
    {
        let _ = app;
    }
}
