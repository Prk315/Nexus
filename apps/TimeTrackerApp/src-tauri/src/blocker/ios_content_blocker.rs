//! iOS Safari Content Blocker integration.
//!
//! On iOS, site blocking is achieved via a Safari Content Blocker App Extension
//! rather than /etc/hosts. This module:
//!   1. Reads enabled blocked sites from SQLite
//!   2. Generates a Safari Content Blocker JSON rules file
//!   3. Writes it to the temp directory
//!   4. Calls a Swift FFI function that copies the file to the App Group
//!      container and reloads the Safari Content Blocker extension.

use crate::db::site_blocker;
use rusqlite::Connection;
use serde_json::json;

extern "C" {
    /// Defined in ContentBlockerBridge.swift via @_silgen_name.
    /// Reads blockerRules.json from the temp directory, copies it to the
    /// App Group container, and calls SFContentBlockerManager.reloadContentBlocker.
    fn apply_content_blocker_rules_c();
}

/// Generate a Safari Content Blocker JSON rules array for the given domains.
/// Returns "[]" for an empty list (clears all rules).
pub fn generate_rules_json(domains: &[String]) -> String {
    let rules: Vec<serde_json::Value> = domains
        .iter()
        .map(|domain| {
            // Dots must be escaped so the url-filter regex matches them literally.
            let escaped = domain.replace('.', "\\.");
            json!({
                "trigger": { "url-filter": format!(".*{escaped}.*") },
                "action":  { "type": "block" }
            })
        })
        .collect();
    serde_json::to_string(&rules).unwrap_or_else(|_| "[]".to_string())
}

/// Read all enabled blocked sites from the database, generate Safari Content
/// Blocker rules, write to the temp directory, and call Swift to reload.
pub fn write_and_reload(conn: &Connection) -> Result<(), String> {
    let sites = site_blocker::get_all(conn).map_err(|e| e.to_string())?;
    let enabled_domains: Vec<String> = sites
        .into_iter()
        .filter(|s| s.enabled)
        .map(|s| s.domain)
        .collect();

    let json = generate_rules_json(&enabled_domains);

    let rules_path = std::env::temp_dir().join("blockerRules.json");
    std::fs::write(&rules_path, json).map_err(|e| e.to_string())?;

    // SAFETY: The Swift symbol apply_content_blocker_rules_c is linked from
    // ContentBlockerBridge.swift at compile time (iOS arm64 only).
    unsafe {
        apply_content_blocker_rules_c();
    }

    Ok(())
}
