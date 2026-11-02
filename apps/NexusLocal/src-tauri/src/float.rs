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
    let win = builder.build().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    float_over_fullscreen(&win);
    #[cfg(not(target_os = "macos"))]
    let _ = win;
    Ok(())
}

/// Let the float sit over *other apps' full-screen Spaces*, not just desktops.
///
/// `always_on_top` + `visible_on_all_workspaces` covers ordinary Spaces, but
/// since macOS 10.14 a plain `NSWindow` belonging to an app with a Dock icon
/// (`ActivationPolicy::Regular`, see `lib.rs`) is barred from full-screen
/// Spaces — a full-screen Ghostty or Chrome simply covered it. Electron's
/// `visibleOnFullScreen` gets round this by hiding the Dock icon; this keeps
/// the icon and does what Spotlight-style overlays do instead: re-class the
/// window as a non-activating `NSPanel` with `FullScreenAuxiliary`.
///
/// Re-classing tao's window drops its `canBecomeKeyWindow` override, so the
/// float can never take the keyboard — which it has no use for — and,
/// non-activating, clicking it never pulls you out of the full-screen app.
#[cfg(target_os = "macos")]
fn float_over_fullscreen(win: &tauri::WebviewWindow) {
    let Ok(ptr) = win.ns_window() else {
        return;
    };
    // A raw pointer is not `Send`; the address is, and AppKit calls must be
    // made on the main thread.
    let addr = ptr as usize;
    let _ = win.run_on_main_thread(move || unsafe {
        make_panel(addr as *mut objc2::runtime::AnyObject)
    });
}

/// An `NSPanel` with the same memory layout as tao's `TaoWindow`.
///
/// `TaoWindow` is `NSWindow` plus one `Bool` ivar, `focusable`, which tao
/// reads back by name (`set_focusable`). `NSPanel` itself adds no ivars to
/// `NSWindow` (both 520 bytes on macOS 26), so declaring that one ivar again
/// here gives a class whose instances are laid out exactly like tao's — the
/// re-class neither reads past the allocation nor strands tao's lookup.
#[cfg(target_os = "macos")]
fn panel_class() -> &'static objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, Bool, ClassBuilder};
    use std::sync::OnceLock;

    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let name = c"NexusFloatPanel";
        // Already registered (e.g. a second Tauri runtime in one process):
        // re-registering would fail, so reuse it.
        if let Some(existing) = AnyClass::get(name) {
            return existing;
        }
        let mut builder = ClassBuilder::new(name, objc2::class!(NSPanel))
            .expect("NexusFloatPanel is registered exactly once");
        builder.add_ivar::<Bool>(c"focusable");
        builder.register()
    })
}

/// # Safety
/// `window` must be a live `TaoWindow` (see [`panel_class`] for why the
/// layouts match), and this must run on the main thread.
#[cfg(target_os = "macos")]
unsafe fn make_panel(window: *mut objc2::runtime::AnyObject) {
    use objc2::msg_send;

    const STYLE_NONACTIVATING_PANEL: usize = 1 << 7;
    const JOIN_ALL_SPACES: usize = 1 << 0;
    const STATIONARY: usize = 1 << 4;
    const IGNORES_CYCLE: usize = 1 << 6;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    /// `NSStatusWindowLevel`: above a full-screen app's own chrome (Chrome's
    /// reveal-on-hover toolbar sits above the floating level).
    const STATUS_WINDOW_LEVEL: isize = 25;

    if window.is_null() {
        return;
    }
    objc2::ffi::object_setClass(window, panel_class());

    let mask: usize = msg_send![window, styleMask];
    let _: () = msg_send![window, setStyleMask: mask | STYLE_NONACTIVATING_PANEL];
    let _: () = msg_send![window, setFloatingPanel: true];
    // NSPanel's default is to vanish whenever its app is not frontmost —
    // which for a timer watched from inside other apps is always.
    let _: () = msg_send![window, setHidesOnDeactivate: false];
    let _: () = msg_send![
        window,
        setCollectionBehavior: JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY
    ];
    let _: () = msg_send![window, setLevel: STATUS_WINDOW_LEVEL];
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
