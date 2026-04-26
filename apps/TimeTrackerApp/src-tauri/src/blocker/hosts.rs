/// Synchronise /etc/hosts with the supplied list of domains.
///
/// We bracket our entries with unique markers so we never touch anything
/// the user already had in the file, and can cleanly remove our block
/// when the list is empty or blocking is disabled.
///
/// Because /etc/hosts is owned by root, we use:
///   osascript -e 'do shell script "..." with administrator privileges'
/// which shows the standard macOS password dialog.  The dialog is only
/// shown when the file actually needs to change.
const MARKER_BEGIN: &str = "# BEGIN TimeTracker-Block";
const MARKER_END: &str = "# END TimeTracker-Block";

/// Build the hosts-file block for a list of domains.
fn build_block(domains: &[String]) -> String {
    if domains.is_empty() {
        return String::new();
    }
    let mut lines = vec![MARKER_BEGIN.to_owned()];
    for domain in domains {
        let domain = domain.trim();
        if domain.is_empty() {
            continue;
        }
        lines.push(format!("127.0.0.1 {domain}"));
        // Also block www. unless the domain already starts with www.
        if !domain.starts_with("www.") {
            lines.push(format!("127.0.0.1 www.{domain}"));
        }
    }
    lines.push(MARKER_END.to_owned());
    lines.join("\n")
}

/// Read /etc/hosts and strip any existing TimeTracker block.
fn strip_block(content: &str) -> String {
    let mut out = Vec::new();
    let mut inside = false;
    for line in content.lines() {
        if line.trim() == MARKER_BEGIN {
            inside = true;
            continue;
        }
        if line.trim() == MARKER_END {
            inside = false;
            continue;
        }
        if !inside {
            out.push(line);
        }
    }
    // Remove trailing blank lines left behind by the removed block
    while out.last().map(|l: &&str| l.trim().is_empty()).unwrap_or(false) {
        out.pop();
    }
    out.join("\n")
}

/// Apply `domains` to /etc/hosts via osascript (shows password dialog if needed).
/// Pass an empty slice to remove the block entirely.
pub fn apply(domains: &[String]) -> Result<(), String> {
    let current = std::fs::read_to_string("/etc/hosts")
        .map_err(|e| format!("Cannot read /etc/hosts: {e}"))?;

    let stripped = strip_block(&current);
    let block = build_block(domains);

    let new_content = if block.is_empty() {
        stripped.clone()
    } else {
        format!("{stripped}\n\n{block}\n")
    };

    // Skip the privileged write if nothing changed
    if new_content == current {
        return Ok(());
    }

    // Escape single quotes inside the content for the shell string
    let escaped = new_content.replace('\'', r"'\''");

    // Write via osascript so macOS handles the privilege elevation UI
    let script = format!(
        "do shell script \
         \"printf '%s' '{escaped}' | tee /etc/hosts > /dev/null && \
           dscacheutil -flushcache && killall -HUP mDNSResponder\" \
         with administrator privileges"
    );

    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("osascript failed to launch: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("hosts update failed: {stderr}"))
    }
}

/// Remove all TimeTracker entries from /etc/hosts.
pub fn clear() -> Result<(), String> {
    apply(&[])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // ── build_block ─────────────────────────────────────────────────────────

    #[test]
    fn empty_domains_produces_empty_block() {
        assert_eq!(build_block(&[]), "");
    }

    #[test]
    fn single_domain_adds_www_variant() {
        let block = build_block(&s(&["youtube.com"]));
        assert!(block.contains("127.0.0.1 youtube.com"), "bare domain missing");
        assert!(block.contains("127.0.0.1 www.youtube.com"), "www variant missing");
    }

    #[test]
    fn www_domain_not_doubled() {
        let block = build_block(&s(&["www.youtube.com"]));
        assert!(block.contains("127.0.0.1 www.youtube.com"));
        // Should NOT add www.www.youtube.com
        assert!(!block.contains("127.0.0.1 www.www.youtube.com"));
    }

    #[test]
    fn block_wrapped_in_markers() {
        let block = build_block(&s(&["example.com"]));
        assert!(block.starts_with(MARKER_BEGIN));
        assert!(block.ends_with(MARKER_END));
    }

    // ── strip_block ─────────────────────────────────────────────────────────

    #[test]
    fn strip_block_removes_marker_section() {
        let content = "# user stuff\n\
                       # BEGIN TimeTracker-Block\n\
                       127.0.0.1 youtube.com\n\
                       # END TimeTracker-Block\n\
                       # more user stuff";
        let stripped = strip_block(content);
        assert!(!stripped.contains("youtube.com"));
        assert!(stripped.contains("# user stuff"));
        assert!(stripped.contains("# more user stuff"));
    }

    #[test]
    fn strip_block_is_idempotent_when_no_block_present() {
        let content = "127.0.0.1 localhost\n# nothing here";
        assert_eq!(strip_block(content), content);
    }

    #[test]
    fn roundtrip_apply_then_strip() {
        let domains = s(&["reddit.com", "twitter.com"]);
        let block = build_block(&domains);
        let combined = format!("# pre-existing\n\n{block}\n");
        let stripped = strip_block(&combined);
        assert!(!stripped.contains("reddit.com"));
        assert!(!stripped.contains("twitter.com"));
        assert!(stripped.contains("# pre-existing"));
    }
}
