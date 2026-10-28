//! The floating focus timer: a small round always-on-top window.
//!
//! Same frontend bundle as the main window — `main.tsx` renders
//! `FloatingTimer` instead of `App` when the window label is [`LABEL`]. Built
//! lazily on first show rather than declared in `tauri.conf.json`, so a launch
//! that never starts a pomodoro never pays for a second WebView.
//!
//! Closing it hides it (the app-wide `CloseRequested` handler in `lib.rs`), so
//! wherever it was dragged to is where it comes back.
//!
//! Commands are registered on every platform and report `Ok` off desktop —
//! cfg-ing the handler list is how a command silently stops existing on iOS.

#[cfg(desktop)]
pub const LABEL: &str = "float";

#[cfg(desktop)]
const SIZE: f64 = 148.0;
/// Inset from the screen's top-right corner: clear of the menu bar and the
/// notch, and of where macOS stacks notification banners.
#[cfg(desktop)]
const INSET_X: f64 = 24.0;
#[cfg(desktop)]
const INSET_Y: f64 = 120.0;

#[cfg(desktop)]
pub fn show(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(win) = app.get_webview_window(LABEL) {
        return win.show().map_err(|e| e.to_string());
    }
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Focus")
        .inner_size(SIZE, SIZE)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        // Appearing must not steal the keyboard from whatever is being worked on.
        .focused(false)
        // …and because it is never focused, every click on it is a "first
        // click". Without this macOS spends that click activating the window
        // and the button under it never sees it.
        .accept_first_mouse(true);
    if let Some((x, y)) = top_right(app) {
        builder = builder.position(x, y);
    }
    builder.build().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(desktop)]
pub fn hide(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    match app.get_webview_window(LABEL) {
        Some(win) => win.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(desktop)]
pub fn toggle(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let visible = app
        .get_webview_window(LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide(app)
    } else {
        show(app)
    }
}

/// Logical top-right corner of the primary monitor, inset.
#[cfg(desktop)]
fn top_right(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let origin = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    Some((origin.x + size.width - SIZE - INSET_X, origin.y + INSET_Y))
}

/// Async on purpose: building a window from a synchronous command blocks the
/// thread the window needs (a hard deadlock on Windows, and not worth relying
/// on being benign elsewhere).
#[tauri::command]
pub async fn tt_float_set(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if visible {
            show(&app)
        } else {
            hide(&app)
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, visible);
        Ok(())
    }
}

/// Bring the main window forward — the float's "open" button.
#[tauri::command]
pub fn tt_main_show(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Some(win) = app.get_webview_window("main") {
            win.show().map_err(|e| e.to_string())?;
            win.set_focus().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(())
    }
}
