use crate::commands::configure_widget;
use crate::db::{timer, AppState};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open TimeTracker", true, None::<&str>)?;
    let toggle_widget =
        MenuItem::with_id(app, "toggle_widget", "Toggle Timer Widget", true, None::<&str>)?;
    let toggle_pie =
        MenuItem::with_id(app, "toggle_pie_widget", "Toggle Day Pie", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&open, &toggle_widget, &toggle_pie, &separator, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .tooltip("TimeTracker")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "open" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "toggle_widget" => {
                let widgets: Vec<_> = app
                    .webview_windows()
                    .into_iter()
                    .filter(|(label, _)| label.starts_with("widget"))
                    .map(|(_, win)| win)
                    .collect();
                if let Some(first) = widgets.first() {
                    let visible = first.is_visible().unwrap_or(false);
                    for win in &widgets {
                        if visible {
                            let _ = win.hide();
                        } else {
                            let _ = win.show();
                            // Re-apply all three flags on every show so the
                            // full collection behavior survives hide→show cycles.
                            configure_widget(win);
                        }
                    }
                }
            }
            "toggle_pie_widget" => {
                let widgets: Vec<_> = app
                    .webview_windows()
                    .into_iter()
                    .filter(|(label, _)| label.starts_with("pie_widget"))
                    .map(|(_, win)| win)
                    .collect();
                if let Some(first) = widgets.first() {
                    let visible = first.is_visible().unwrap_or(false);
                    for win in &widgets {
                        if visible {
                            let _ = win.hide();
                        } else {
                            let _ = win.show();
                            configure_widget(win);
                        }
                    }
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;

    // Spawn 1-second background tick to update tray title
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            update_title(&handle);
        }
    });

    Ok(())
}

fn update_title(app: &AppHandle) {
    let title = {
        let state = app.state::<AppState>();
        let Ok(db) = state.db.lock() else { return };
        let Ok(status) = timer::get_status(&db) else { return };
        if let Some(active) = status.active {
            format_elapsed(active.elapsed_seconds)
        } else if let Some(paused) = status.paused {
            format!("⏸ {}", format_elapsed(paused.elapsed_seconds))
        } else {
            "●".to_string()
        }
    };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_title(Some(&title));
    }
}

fn format_elapsed(secs: i64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}
