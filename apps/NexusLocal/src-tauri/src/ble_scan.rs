//! BLE recon scan commands. Drives the Swift CoreBluetooth scanner
//! (`ios/BleScaleBridge.swift`) which writes results to tmp/ble_scan.json; the
//! frontend polls `ble_scan_results` to render them. Used to fingerprint the
//! Vellafit scale's BLE protocol and to try handshake writes that unlock
//! body-composition (impedance) frames. iOS-only (CoreBluetooth); no-op elsewhere.

#[cfg(target_os = "ios")]
use std::os::raw::c_char;

#[cfg(target_os = "ios")]
extern "C" {
    fn ble_scan_start_c(
        seconds: f64,
        connect_filter: *const c_char,
        handshake_hex: *const c_char,
        handshake_char: *const c_char,
    );
    fn ble_write_c(hex: *const c_char, char_uuid: *const c_char);
    fn ble_scan_stop_c();
}

/// Start a BLE scan for `seconds`. If `connect_filter` is non-empty, connect to
/// the first peripheral whose name contains it, dump its GATT + frames, and — if
/// `handshake_hex` is set — write those bytes to `handshake_char` (default FFF1)
/// after enumeration to trigger a full measurement.
#[tauri::command]
pub fn ble_scan_start(
    seconds: f64,
    connect_filter: String,
    handshake_hex: Option<String>,
    handshake_char: Option<String>,
) {
    #[cfg(target_os = "ios")]
    {
        let filter = std::ffi::CString::new(connect_filter).unwrap_or_default();
        let hs = std::ffi::CString::new(handshake_hex.unwrap_or_default()).unwrap_or_default();
        let hc = std::ffi::CString::new(handshake_char.unwrap_or_else(|| "FFF1".into()))
            .unwrap_or_default();
        // SAFETY: pointers valid for the call; Swift copies before returning.
        unsafe { ble_scan_start_c(seconds, filter.as_ptr(), hs.as_ptr(), hc.as_ptr()) };
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (seconds, connect_filter, handshake_hex, handshake_char);
    }
}

/// Write raw hex bytes to a characteristic (by short UUID, e.g. "FFF1") on the
/// currently-connected peripheral — for trying handshake sequences live.
#[tauri::command]
pub fn ble_write(hex: String, char_uuid: Option<String>) {
    #[cfg(target_os = "ios")]
    {
        let h = std::ffi::CString::new(hex).unwrap_or_default();
        let c = std::ffi::CString::new(char_uuid.unwrap_or_else(|| "FFF1".into())).unwrap_or_default();
        unsafe { ble_write_c(h.as_ptr(), c.as_ptr()) };
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (hex, char_uuid);
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
