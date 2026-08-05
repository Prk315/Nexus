//! Safari content-blocker rules generation + apply. Domains come from Supabase
//! (`blocked_sites`) via the frontend, are turned into WebKit content-blocker
//! JSON here, written to tmp, then handed to Swift (`ContentBlockerBridge.swift`)
//! to compile + reload. Ports TimeTracker's proven, WebKit-safe rule form.

use serde_json::json;

#[cfg(target_os = "ios")]
extern "C" {
    /// Defined in ContentBlockerBridge.swift via @_silgen_name.
    fn apply_content_blocker_rules_c();
}

/// Extract the hostname from user input that may be a full URL or bare domain.
/// "https://m.youtube.com/?ra=m" → "m.youtube.com"; "youtube.com" → "youtube.com"
fn extract_hostname(input: &str) -> String {
    let lower = input.trim().to_lowercase();
    let s: &str = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .unwrap_or(&lower);
    let s = s.split('/').next().unwrap_or(s);
    let s = s.split('?').next().unwrap_or(s);
    let s = s.split('#').next().unwrap_or(s);
    if let Some(colon) = s.rfind(':') {
        if s[colon + 1..].bytes().all(|b| b.is_ascii_digit()) {
            return s[..colon].to_string();
        }
    }
    s.to_string()
}

/// Escape characters special to WebKit url-filter regexes. Only dots matter in a
/// valid hostname, so escape them to match literally.
fn escape_for_url_filter(hostname: &str) -> String {
    hostname.replace('.', "\\.")
}

/// Generate a Safari content-blocker JSON rules array for the given inputs.
/// WebKit's regex engine is limited: no negated classes `[^x]`, no end-anchor
/// `$`, no lookaheads. `.*hostname` is the safe form (matches any URL containing
/// the host, incl. subdomains + paths). Returns "[]" for an empty list.
///
/// Inputs that yield no hostname are **skipped, not emitted**. An empty hostname
/// produces the filter `.*`, which matches every URL — so a single blank or
/// whitespace-only row in `blocked_sites` would block the entire web in Safari.
/// Dropping the row degrades to "this one entry does nothing", which is the
/// direction that fails safely.
pub fn generate_rules_json(inputs: &[String]) -> String {
    let rules: Vec<serde_json::Value> = inputs
        .iter()
        .filter_map(|input| {
            let hostname = extract_hostname(input);
            if hostname.is_empty() {
                return None;
            }
            let escaped = escape_for_url_filter(&hostname);
            Some(json!({
                "trigger": { "url-filter": format!(".*{escaped}") },
                "action":  { "type": "block" }
            }))
        })
        .collect();
    serde_json::to_string(&rules).unwrap_or_else(|_| "[]".to_string())
}

/// Apply the given blocked domains to the Safari content blocker. On iOS, writes
/// the rules to tmp and calls Swift to compile + reload; a no-op elsewhere.
#[tauri::command]
pub fn apply_content_blocker(domains: Vec<String>) -> Result<usize, String> {
    let json = generate_rules_json(&domains);
    #[cfg(target_os = "ios")]
    {
        let path = std::env::temp_dir().join("blockerRules.json");
        std::fs::write(&path, &json).map_err(|e| e.to_string())?;
        // SAFETY: apply_content_blocker_rules_c is linked from
        // ContentBlockerBridge.swift at compile time (iOS arm64 only).
        unsafe { apply_content_blocker_rules_c() };
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = json;
    }
    Ok(domains.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostname_from_url() {
        assert_eq!(extract_hostname("https://m.youtube.com/?ra=m"), "m.youtube.com");
        assert_eq!(extract_hostname("youtube.com"), "youtube.com");
        assert_eq!(extract_hostname("example.com:8080"), "example.com");
    }

    #[test]
    fn rules_are_webkit_safe() {
        let json = generate_rules_json(&["youtube.com".into()]);
        // Dots are escaped and JSON double-escapes the backslash → `\\.` in output.
        assert!(json.contains(r".*youtube\\.com"));
        assert!(!json.contains('$'));
        assert!(!json.contains("[^"));
    }

    #[test]
    fn empty_is_empty_array() {
        assert_eq!(generate_rules_json(&[]), "[]");
    }

    /// A blank row must never become `.*`, which matches every URL and would
    /// block the whole web in Safari.
    #[test]
    fn blank_inputs_emit_no_rule() {
        for blank in ["", "   ", "https://", "http://", "/", "?", "#"] {
            let json = generate_rules_json(&[blank.to_string()]);
            assert_eq!(json, "[]", "blank input {blank:?} produced a rule: {json}");
        }
    }

    #[test]
    fn blank_input_does_not_poison_a_valid_list() {
        let json = generate_rules_json(&["".into(), "youtube.com".into(), "  ".into()]);
        assert!(json.contains(r".*youtube\\.com"));
        assert!(
            !json.contains(r#""url-filter":".*""#),
            "a bare .* catch-all leaked into the list: {json}"
        );
    }
}
