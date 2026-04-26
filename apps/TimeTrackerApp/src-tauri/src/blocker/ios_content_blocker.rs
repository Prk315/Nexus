//! iOS Safari Content Blocker integration.
//!
//! On iOS, site blocking is achieved via a Safari Content Blocker App Extension
//! rather than /etc/hosts. This module:
//!   1. Reads enabled blocked sites from SQLite
//!   2. Generates a Safari Content Blocker JSON rules file
//!   3. Writes it to the temp directory
//!   4. Calls a Swift FFI function that copies the file to the App Group
//!      container and reloads the Safari Content Blocker extension.

use serde_json::json;

// The Swift FFI bridge and database integration are only available on device.
#[cfg(target_os = "ios")]
use crate::db::site_blocker;
#[cfg(target_os = "ios")]
use rusqlite::Connection;

#[cfg(target_os = "ios")]
extern "C" {
    /// Defined in ContentBlockerBridge.swift via @_silgen_name.
    fn apply_content_blocker_rules_c();
}

/// Extract the hostname from user input which may be a full URL or bare domain.
/// "https://m.youtube.com/?ra=m" → "m.youtube.com"
/// "youtube.com"                  → "youtube.com"
fn extract_hostname(input: &str) -> String {
    // Lowercase first so scheme stripping works regardless of URL casing.
    let lower = input.trim().to_lowercase();
    let s: &str = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .unwrap_or(&lower);
    // Keep only host:port — drop path, query, fragment
    let s = s.split('/').next().unwrap_or(s);
    let s = s.split('?').next().unwrap_or(s);
    let s = s.split('#').next().unwrap_or(s);
    // Drop port number (e.g. "example.com:8080" → "example.com")
    if let Some(colon) = s.rfind(':') {
        if s[colon + 1..].bytes().all(|b| b.is_ascii_digit()) {
            return s[..colon].to_string();
        }
    }
    s.to_string()
}

/// Escape characters that have special meaning in WebKit url-filter regexes.
fn escape_for_url_filter(hostname: &str) -> String {
    // Only dots are special in a valid hostname; escape them so they match literally.
    hostname.replace('.', "\\.")
}

/// Generate a Safari Content Blocker JSON rules array for the given inputs.
/// Each input may be a bare domain ("youtube.com") or a full URL.
/// Returns "[]" for an empty list (clears all rules).
pub fn generate_rules_json(inputs: &[String]) -> String {
    let rules: Vec<serde_json::Value> = inputs
        .iter()
        .map(|input| {
            let hostname = extract_hostname(input);
            let escaped = escape_for_url_filter(&hostname);
            // WebKit's content-blocker regex engine is limited: no negated char
            // classes [^x], no end-anchor $, and no full PCRE features.
            // ".*hostname" is the safe form that matches any URL containing the
            // hostname (including all subdomains and paths).
            json!({
                "trigger": { "url-filter": format!(".*{escaped}") },
                "action":  { "type": "block" }
            })
        })
        .collect();
    serde_json::to_string(&rules).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_hostname ────────────────────────────────────────────────────

    #[test]
    fn bare_domain_unchanged() {
        assert_eq!(extract_hostname("youtube.com"), "youtube.com");
    }

    #[test]
    fn strips_https_scheme() {
        assert_eq!(extract_hostname("https://youtube.com"), "youtube.com");
    }

    #[test]
    fn strips_http_scheme() {
        assert_eq!(extract_hostname("http://example.com"), "example.com");
    }

    #[test]
    fn strips_path_and_query() {
        assert_eq!(
            extract_hostname("https://m.youtube.com/?ra=m"),
            "m.youtube.com"
        );
    }

    #[test]
    fn strips_fragment() {
        assert_eq!(
            extract_hostname("https://example.com/page#section"),
            "example.com"
        );
    }

    #[test]
    fn strips_port() {
        assert_eq!(extract_hostname("https://localhost:8080/path"), "localhost");
    }

    #[test]
    fn lowercases_hostname() {
        assert_eq!(extract_hostname("HTTPS://YouTube.COM/watch"), "youtube.com");
    }

    #[test]
    fn subdomain_preserved() {
        assert_eq!(extract_hostname("https://www.reddit.com/r/rust/"), "www.reddit.com");
    }

    // ── escape_for_url_filter ───────────────────────────────────────────────

    #[test]
    fn escapes_dots() {
        assert_eq!(escape_for_url_filter("youtube.com"), "youtube\\.com");
    }

    #[test]
    fn multiple_dots_escaped() {
        assert_eq!(escape_for_url_filter("a.b.c"), "a\\.b\\.c");
    }

    // ── generate_rules_json ─────────────────────────────────────────────────

    #[test]
    fn empty_list_returns_empty_array() {
        assert_eq!(generate_rules_json(&[]), "[]");
    }

    #[test]
    fn single_domain_produces_valid_json() {
        let json = generate_rules_json(&["youtube.com".to_string()]);
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        let rules = parsed.as_array().expect("top-level array");
        assert_eq!(rules.len(), 1);
        let filter = rules[0]["trigger"]["url-filter"].as_str().unwrap();
        assert_eq!(filter, ".*youtube\\.com");
        assert_eq!(rules[0]["action"]["type"].as_str().unwrap(), "block");
    }

    #[test]
    fn full_url_produces_hostname_only_pattern() {
        let json = generate_rules_json(&["https://m.youtube.com/?ra=m".to_string()]);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let filter = parsed[0]["trigger"]["url-filter"].as_str().unwrap();
        // Must use only the hostname, not the full URL
        assert_eq!(filter, ".*m\\.youtube\\.com");
    }

    #[test]
    fn multiple_domains_all_present() {
        let json = generate_rules_json(&[
            "reddit.com".to_string(),
            "twitter.com".to_string(),
        ]);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let rules = parsed.as_array().unwrap();
        assert_eq!(rules.len(), 2);
        let filters: Vec<&str> = rules
            .iter()
            .map(|r| r["trigger"]["url-filter"].as_str().unwrap())
            .collect();
        assert!(filters.contains(&".*reddit\\.com"));
        assert!(filters.contains(&".*twitter\\.com"));
    }

    #[test]
    fn pattern_contains_no_unsupported_webkit_constructs() {
        // WebKit url-filter does not support: [^x], end-anchor $, or (?...) lookaheads.
        let inputs = vec![
            "youtube.com",
            "https://m.youtube.com/?ra=m",
            "reddit.com",
            "sub.example.co.uk",
        ];
        let json = generate_rules_json(
            &inputs.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        );
        // None of these patterns should appear in the output
        assert!(!json.contains("[^"), "negated char class found");
        assert!(!json.contains("(?"), "lookahead found");
        // $ is valid as an end anchor in some WebKit versions but we avoid it
        // inside url-filter values (it causes Code=6 on iOS 26)
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        for rule in parsed.as_array().unwrap() {
            let filter = rule["trigger"]["url-filter"].as_str().unwrap();
            assert!(!filter.ends_with('$'), "end anchor $ in: {filter}");
        }
    }

    // ── site_blocker DB normalisation (mirrors db/site_blocker.rs::add) ────

    #[test]
    fn db_add_strips_scheme_and_slash() {
        // Replicate the normalisation in db/site_blocker.rs::add
        let raw = "https://m.youtube.com/?ra=m";
        let normalized = raw
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .to_lowercase();
        assert_eq!(normalized, "m.youtube.com/?ra=m");
        // Confirm extract_hostname handles the stored form correctly
        assert_eq!(extract_hostname(&normalized), "m.youtube.com");
    }
}

/// Read all enabled blocked sites from the database, generate Safari Content
/// Blocker rules, write to the temp directory, and call Swift to reload.
#[cfg(target_os = "ios")]
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
