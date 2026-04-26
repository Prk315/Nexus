use crate::models::BlockedSite;
use rusqlite::{Connection, Result};

pub fn get_all(conn: &Connection) -> Result<Vec<BlockedSite>> {
    let mut stmt =
        conn.prepare("SELECT id, domain, enabled FROM blocked_sites ORDER BY domain")?;
    let rows = stmt.query_map([], |row| {
        Ok(BlockedSite {
            id: row.get(0)?,
            domain: row.get(1)?,
            enabled: row.get::<_, i64>(2)? != 0,
        })
    })?;
    rows.collect()
}

pub fn add(conn: &Connection, domain: &str) -> Result<BlockedSite> {
    // Normalise: strip scheme and trailing slashes
    let domain = domain
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_lowercase();

    conn.execute(
        "INSERT OR IGNORE INTO blocked_sites (domain, enabled) VALUES (?1, 1)",
        rusqlite::params![domain],
    )?;
    let id = conn.last_insert_rowid();
    Ok(BlockedSite { id, domain, enabled: true })
}

pub fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM blocked_sites WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE blocked_sites SET enabled = ?1 WHERE id = ?2",
        rusqlite::params![enabled as i64, id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE blocked_sites (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                domain  TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn add_and_retrieve_domain() {
        let conn = setup();
        let site = add(&conn, "youtube.com").unwrap();
        assert_eq!(site.domain, "youtube.com");
        assert!(site.enabled);

        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].domain, "youtube.com");
    }

    #[test]
    fn add_strips_https_scheme() {
        let conn = setup();
        let site = add(&conn, "https://youtube.com/").unwrap();
        assert_eq!(site.domain, "youtube.com");
    }

    #[test]
    fn add_strips_http_scheme_and_slash() {
        let conn = setup();
        let site = add(&conn, "http://example.com/").unwrap();
        assert_eq!(site.domain, "example.com");
    }

    #[test]
    fn add_normalises_full_url_to_domain_plus_path() {
        // site_blocker.add strips scheme and trailing slash but keeps the path.
        // ios_content_blocker.extract_hostname then strips the path on iOS.
        let conn = setup();
        let site = add(&conn, "https://m.youtube.com/?ra=m").unwrap();
        // scheme stripped, no trailing slash to trim, path preserved
        assert_eq!(site.domain, "m.youtube.com/?ra=m");
    }

    #[test]
    fn add_is_case_insensitive() {
        let conn = setup();
        let site = add(&conn, "YouTube.COM").unwrap();
        assert_eq!(site.domain, "youtube.com");
    }

    #[test]
    fn remove_deletes_domain() {
        let conn = setup();
        let site = add(&conn, "reddit.com").unwrap();
        remove(&conn, site.id).unwrap();
        assert!(get_all(&conn).unwrap().is_empty());
    }

    #[test]
    fn set_enabled_toggles_state() {
        let conn = setup();
        let site = add(&conn, "twitter.com").unwrap();
        set_enabled(&conn, site.id, false).unwrap();
        let all = get_all(&conn).unwrap();
        assert!(!all[0].enabled);
        set_enabled(&conn, site.id, true).unwrap();
        let all = get_all(&conn).unwrap();
        assert!(all[0].enabled);
    }

    #[test]
    fn get_all_returns_enabled_and_disabled() {
        let conn = setup();
        let a = add(&conn, "a.com").unwrap();
        let b = add(&conn, "b.com").unwrap();
        set_enabled(&conn, b.id, false).unwrap();
        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
        let enabled_count = all.iter().filter(|s| s.enabled).count();
        assert_eq!(enabled_count, 1);
        let _ = a;
    }
}
