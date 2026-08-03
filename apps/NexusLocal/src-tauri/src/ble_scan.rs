//! BLE recon scan commands. Drives the Swift CoreBluetooth scanner
//! (`ios/BleScaleBridge.swift`) which writes results to tmp/ble_scan.json; the
//! frontend polls `ble_scan_results` to render them. Used to fingerprint the
//! Vellafit scale's BLE protocol. iOS-only (CoreBluetooth); no-op elsewhere.

#[cfg(target_os = "ios")]
extern "C" {
    fn ble_scan_start_c(seconds: f64, connect_filter: *const std::os::raw::c_char);
    fn ble_scan_stop_c();
}

/// Start a BLE scan for `seconds`. If `connect_filter` is non-empty, connect to
/// the first peripheral whose name contains it and dump its GATT + frames.
#[tauri::command]
pub fn ble_scan_start(seconds: f64, connect_filter: String) {
    #[cfg(target_os = "ios")]
    {
        let c = std::ffi::CString::new(connect_filter).unwrap_or_default();
        // SAFETY: pointer valid for the call; Swift copies before returning.
        unsafe { ble_scan_start_c(seconds, c.as_ptr()) };
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (seconds, connect_filter);
    }
}

#[tauri::command]
pub fn ble_scan_stop() {
    #[cfg(target_os = "ios")]
    unsafe {
        ble_scan_stop_c()
    };
}

/// Return the latest scan snapshot JSON (or "{}" if none / not iOS).
#[tauri::command]
pub fn ble_scan_results() -> String {
    #[cfg(target_os = "ios")]
    {
        let path = std::env::temp_dir().join("ble_scan.json");
        std::fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        "{\"status\":\"ble unavailable off-iOS\",\"devices\":[]}".to_string()
    }
}
