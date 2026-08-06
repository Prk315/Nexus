//! Focus schedule blocks — wall-clock windows during which apps/sites are blocked.
//!
//! Note this is unrelated to pomodoro despite both using the word "focus": a focus
//! block is a recurring calendar window (e.g. Mon–Fri 09:00–17:00), not a
//! countdown.
//!
//! The gap being closed: in TimeTracker, `focus_blocks` syncs to Supabase but the
//! *payload* of a block — which apps and sites it blocks — lives only in local
//! SQLite (`schedule_block_apps` / `schedule_block_sites` have no cloud
//! counterpart). Work unit 1 adds those tables; this module reads and writes them
//! so a schedule created on the phone actually means something to the evaluator.
//!
//! # Degrading before the migration lands
//!
//! Until work unit 1's migration is applied the two join tables do not exist and
//! PostgREST answers with `PGRST205` / `PGRST200`. That is not a crash and not a
//! user-facing error: the block itself still saves, and the payload is skipped.
//! The commands report the truth by echoing back *empty* `process_names` /
//! `domains` in that case, so the UI never shows a selection that was not stored.
//!
//! # Policy lives on the server
//!
//! Nothing here decides whether a window is currently active. `focus-evaluate`
//! collapses these rows into `blocking_state`; note in particular that
//! `start_time > end_time` is a legal *overnight* window (the evaluator reads it
//! as `now >= start || now < end`) and must not be rejected here.

use super::{eq, now_rfc3339, Rest, T_FOCUS_BLOCKS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Payload tables added by work unit 1. Kept local to this module — it is their
/// only consumer, and `mod.rs`'s const block is contested ground while a dozen
/// units land in parallel.
pub const T_SCHEDULE_BLOCK_APPS: &str = "schedule_block_apps";
pub const T_SCHEDULE_BLOCK_SITES: &str = "schedule_block_sites";

/// Embedded select that pulls a block and both payload lists in one round-trip.
/// Requires the FK relationships work unit 1 declares; `list_blocks` falls back
/// to three queries and a client-side join when the embedding is unavailable.
const EMBEDDED_SELECT: &str = "*,schedule_block_apps(process_name),schedule_block_sites(domain)";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusBlock {
    pub id: Option<String>,
    pub name: String,
    /// "HH:MM" local time.
    pub start_time: String,
    pub end_time: String,
    /// ISO weekday CSV, 1 = Monday .. 7 = Sunday.
    pub days_of_week: String,
    pub color: String,
    pub enabled: bool,
    #[serde(default)]
    pub process_names: Vec<String>,
    #[serde(default)]
    pub domains: Vec<String>,
}

// ── Pure validators ──────────────────────────────────────────────────────────

/// "HH:MM", 24-hour, zero-padded. The zero-padding is load-bearing: it is what
/// makes a lexical `>` comparison of two of these chronologically correct, which
/// is how `is_overnight` and the server-side evaluator both work.
pub fn valid_hhmm(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return false;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| i == 2 || c.is_ascii_digit())
    {
        return false;
    }
    let (hh, mm) = (&s[0..2], &s[3..5]);
    matches!((hh.parse::<u32>(), mm.parse::<u32>()), (Ok(h), Ok(m)) if h < 24 && m < 60)
}

/// Validate an ISO-weekday CSV and return it normalised (ascending, no spaces).
/// Duplicates are an error rather than silently deduplicated — a repeated day is
/// a sign the caller built the string wrong, and swallowing it hides that.
pub fn normalize_days(csv: &str) -> Result<String, String> {
    if csv.trim().is_empty() {
        return Err("days_of_week must list at least one day".into());
    }
    let mut days: Vec<u8> = Vec::new();
    for part in csv.split(',') {
        let token = part.trim();
        if token.is_empty() {
            return Err("days_of_week has an empty entry".into());
        }
        let day: u8 = token
            .parse()
            .map_err(|_| format!("days_of_week entry '{token}' is not a number"))?;
        if !(1..=7).contains(&day) {
            return Err(format!("days_of_week entry '{day}' is outside 1–7"));
        }
        if days.contains(&day) {
            return Err(format!("days_of_week repeats day '{day}'"));
        }
        days.push(day);
    }
    days.sort_unstable();
    Ok(days
        .iter()
        .map(|d| d.to_string())
        .collect::<Vec<_>>()
        .join(","))
}

/// A window that wraps past midnight (22:00 → 06:00). Legal, and the reason the
/// times are never compared as "start must be before end".
pub fn is_overnight(start_time: &str, end_time: &str) -> bool {
    start_time > end_time
}

/// Trim, validate and normalise in place. Returns the first problem found.
fn validate(block: &mut FocusBlock) -> Result<(), String> {
    block.name = block.name.trim().to_string();
    if block.name.is_empty() {
        return Err("name must not be empty".into());
    }
    if !valid_hhmm(&block.start_time) {
        return Err(format!("start_time '{}' is not HH:MM", block.start_time));
    }
    if !valid_hhmm(&block.end_time) {
        return Err(format!("end_time '{}' is not HH:MM", block.end_time));
    }
    // Overnight (start > end) is legal; a zero-length window is not — the
    // evaluator's `now >= start || now < end` would match every instant.
    if block.start_time == block.end_time {
        return Err("start_time and end_time must differ".into());
    }
    block.days_of_week = normalize_days(&block.days_of_week)?;
    if block.color.trim().is_empty() {
        block.color = "#4f46e5".to_string();
    }
    block.process_names = clean_list(&block.process_names);
    block.domains = clean_list(&block.domains);
    Ok(())
}

/// Trim, drop blanks, drop duplicates while preserving order.
fn clean_list(items: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(items.len());
    for item in items {
        let trimmed = item.trim();
        if !trimmed.is_empty() && !out.iter().any(|existing| existing == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    out
}

/// True when a PostgREST error means "that table/relationship isn't there yet"
/// rather than a real failure. Both live shapes were captured against the
/// project before this was written: the missing *table* on the three-query path
/// answers 404 `PGRST205` ("Could not find the table … in the schema cache"),
/// the missing *relationship* on the embedded path answers 400 `PGRST200`
/// ("Could not find a relationship between … in the schema cache").
///
/// Matched on those two codes and their exact phrasings only. A bare "schema
/// cache" substring would be wrong in both directions: `PGRST002` is a 503
/// whose message is "Could not query the database for the schema cache" — a
/// database outage — and `PGRST204` is a missing *column*. Neither means "work
/// unit 1 hasn't run", and treating them as such would silently drop a payload
/// the user just chose. Likewise not matching a bare "does not exist", which
/// would swallow Postgres' own `column … does not exist`.
fn is_missing_relation(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("pgrst205")
        || e.contains("pgrst200")
        || e.contains("could not find the table")
        || e.contains("could not find a relationship")
}

// ── Row parsing ──────────────────────────────────────────────────────────────

fn str_field(row: &Value, key: &str, fallback: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

/// Pull a list of scalars out of an embedded child array, e.g.
/// `"schedule_block_apps": [{"process_name": "Slack"}]`.
fn embedded_list(row: &Value, table: &str, column: &str) -> Vec<String> {
    row.get(table)
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| r.get(column).and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_block(row: &Value) -> FocusBlock {
    FocusBlock {
        id: row.get("id").and_then(Value::as_str).map(str::to_string),
        name: str_field(row, "name", "Focus Block"),
        start_time: str_field(row, "start_time", "09:00"),
        end_time: str_field(row, "end_time", "17:00"),
        days_of_week: str_field(row, "days_of_week", "1,2,3,4,5"),
        color: str_field(row, "color", "#4f46e5"),
        enabled: row.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        process_names: embedded_list(row, T_SCHEDULE_BLOCK_APPS, "process_name"),
        domains: embedded_list(row, T_SCHEDULE_BLOCK_SITES, "domain"),
    }
}

fn parse_blocks(rows: &Value) -> Vec<FocusBlock> {
    rows.as_array()
        .map(|rows| rows.iter().map(parse_block).collect())
        .unwrap_or_default()
}

// ── Reads ────────────────────────────────────────────────────────────────────

async fn list_blocks(rest: &Rest) -> Result<Vec<FocusBlock>, String> {
    let user = eq(rest.user_id());
    let query = [
        ("select", EMBEDDED_SELECT),
        ("user_id", user.as_str()),
        ("order", "start_time"),
    ];
    match rest.select(T_FOCUS_BLOCKS, &query).await {
        Ok(rows) => Ok(parse_blocks(&rows)),
        Err(e) if is_missing_relation(&e) => {
            eprintln!("[timetracker::focus] payload tables not migrated yet ({e}); listing blocks without them");
            list_blocks_unjoined(rest).await
        }
        // Embedding can also be unavailable for reasons other than the migration
        // (no FK declared, PostgREST version). Three queries always work.
        Err(e) => {
            eprintln!("[timetracker::focus] embedded select failed ({e}); falling back to separate queries");
            list_blocks_unjoined(rest).await
        }
    }
}

/// Fallback path: fetch the blocks, then each payload table, and join in memory.
async fn list_blocks_unjoined(rest: &Rest) -> Result<Vec<FocusBlock>, String> {
    let user = eq(rest.user_id());
    let rows = rest
        .select(
            T_FOCUS_BLOCKS,
            &[
                ("select", "*"),
                ("user_id", user.as_str()),
                ("order", "start_time"),
            ],
        )
        .await?;
    let mut blocks = parse_blocks(&rows);
    let ids: Vec<&str> = blocks.iter().filter_map(|b| b.id.as_deref()).collect();
    if ids.is_empty() {
        return Ok(blocks);
    }
    // UUIDs, so no PostgREST quoting concerns inside `in.()`.
    let filter = format!("in.({})", ids.join(","));

    let apps = child_map(rest, T_SCHEDULE_BLOCK_APPS, "process_name", &filter).await?;
    let sites = child_map(rest, T_SCHEDULE_BLOCK_SITES, "domain", &filter).await?;
    for block in &mut blocks {
        let Some(id) = block.id.as_deref() else {
            continue;
        };
        block.process_names = apps.get(id).cloned().unwrap_or_default();
        block.domains = sites.get(id).cloned().unwrap_or_default();
    }
    Ok(blocks)
}

/// `block_id -> [values]` for one payload table.
///
/// A *missing* table yields an empty map — the schedules are still worth showing
/// and "not stored anywhere" is the honest reading. Every other failure
/// propagates, and that distinction is load-bearing: a transient read error that
/// silently became an empty payload would be echoed straight back into the next
/// save (e.g. the list view's `enabled` toggle), where `reconcile` would diff
/// the real rows against nothing and delete every one of them.
async fn child_map(
    rest: &Rest,
    table: &str,
    column: &str,
    id_filter: &str,
) -> Result<HashMap<String, Vec<String>>, String> {
    let select = format!("block_id,{column}");
    let rows = match rest
        .select(table, &[("select", select.as_str()), ("block_id", id_filter)])
        .await
    {
        Ok(rows) => rows,
        Err(e) if is_missing_relation(&e) => {
            eprintln!("[timetracker::focus] {table} not migrated yet ({e}); treating as empty");
            return Ok(HashMap::new());
        }
        Err(e) => return Err(e),
    };
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows.as_array().map(Vec::as_slice).unwrap_or_default() {
        let (Some(block_id), Some(value)) = (
            row.get("block_id").and_then(Value::as_str),
            row.get(column).and_then(Value::as_str),
        ) else {
            continue;
        };
        map.entry(block_id.to_string())
            .or_default()
            .push(value.to_string());
    }
    Ok(map)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// Make `table` hold exactly `desired` for this block. Returns `false` when the
/// table does not exist yet (work unit 1 pending) so the caller can report an
/// empty payload rather than pretend the selection was stored.
///
/// Diffs against a read instead of issuing `not.in.(…)`: the values are
/// user-supplied strings, and an empty desired list would make `not.in.()`
/// malformed — i.e. "clear every app from this block" would silently no-op.
async fn reconcile(
    rest: &Rest,
    table: &str,
    column: &str,
    block_id: &str,
    desired: &[String],
) -> Result<bool, String> {
    let block_filter = eq(block_id);
    let existing = match rest
        .select(table, &[("select", column), ("block_id", block_filter.as_str())])
        .await
    {
        Ok(rows) => rows
            .as_array()
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| r.get(column).and_then(Value::as_str))
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        Err(e) if is_missing_relation(&e) => {
            eprintln!("[timetracker::focus] {table} not migrated yet ({e}); payload not stored");
            return Ok(false);
        }
        Err(e) => return Err(e),
    };

    for stale in existing.iter().filter(|v| !desired.contains(v)) {
        let value_filter = eq(stale);
        rest.delete(
            table,
            &[
                ("block_id", block_filter.as_str()),
                (column, value_filter.as_str()),
            ],
        )
        .await?;
    }

    let additions: Vec<Value> = desired
        .iter()
        .filter(|v| !existing.contains(v))
        .map(|v| json!({ "block_id": block_id, column: v }))
        .collect();
    if !additions.is_empty() {
        // Upsert rather than insert, on the natural key. The diff above already
        // excludes what is there, so this is a plain insert in practice — but two
        // devices saving the same block at once would otherwise race into the
        // `UNIQUE (block_id, …)` constraint and surface as an opaque 409.
        // `on_conflict` is mandatory: PostgREST defaults it to the primary key,
        // which here is the surrogate `id`, so merging would never happen.
        let on_conflict = format!("block_id,{column}");
        rest.upsert(table, &on_conflict, &Value::Array(additions))
            .await?;
    }
    Ok(true)
}

fn first_row(rows: &Value) -> Option<&Value> {
    match rows {
        Value::Array(rows) => rows.first(),
        other => Some(other),
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tt_focus_blocks() -> Result<Vec<FocusBlock>, String> {
    let rest = Rest::load();
    if !rest.is_configured() {
        return Err("Supabase is not configured".into());
    }
    list_blocks(&rest).await
}

#[tauri::command]
pub async fn tt_focus_block_save(block: FocusBlock) -> Result<FocusBlock, String> {
    let rest = Rest::load();
    if !rest.is_configured() {
        return Err("Supabase is not configured".into());
    }
    let mut block = block;
    validate(&mut block)?;

    // `user_id` is written explicitly rather than left to the column default:
    // every read filters on `Rest::user_id()`, so a mismatch would make a saved
    // block vanish from the list with no error anywhere.
    let body = json!({
        "user_id": rest.user_id(),
        "name": block.name,
        "start_time": block.start_time,
        "end_time": block.end_time,
        "days_of_week": block.days_of_week,
        "color": block.color,
        "enabled": block.enabled,
        "updated_at": now_rfc3339(),
    });

    let user = eq(rest.user_id());
    // A PATCH that matches nothing is a success with an empty body, so the
    // "no row" case below means the block was deleted on another device rather
    // than anything having gone wrong with the request.
    let missing = match block.id.as_deref() {
        None => "focus block insert returned no row".to_string(),
        Some(id) => format!("focus block {id} no longer exists"),
    };
    let saved = match block.id.as_deref() {
        None => rest.insert(T_FOCUS_BLOCKS, &body).await?,
        Some(id) => {
            let id_filter = eq(id);
            rest.update(
                T_FOCUS_BLOCKS,
                &[("id", id_filter.as_str()), ("user_id", user.as_str())],
                &body,
            )
            .await?
        }
    };
    let id = first_row(&saved)
        .and_then(|row| row.get("id"))
        .and_then(Value::as_str)
        .ok_or(missing)?
        .to_string();

    let apps_stored = reconcile(
        &rest,
        T_SCHEDULE_BLOCK_APPS,
        "process_name",
        &id,
        &block.process_names,
    )
    .await?;
    let sites_stored = reconcile(
        &rest,
        T_SCHEDULE_BLOCK_SITES,
        "domain",
        &id,
        &block.domains,
    )
    .await?;

    block.id = Some(id);
    if !apps_stored {
        block.process_names.clear();
    }
    if !sites_stored {
        block.domains.clear();
    }
    Ok(block)
}

#[tauri::command]
pub async fn tt_focus_block_delete(id: String) -> Result<(), String> {
    let rest = Rest::load();
    if !rest.is_configured() {
        return Err("Supabase is not configured".into());
    }
    // The payload rows go with it via `on delete cascade`.
    let id_filter = eq(id.trim());
    let user = eq(rest.user_id());
    rest.delete(
        T_FOCUS_BLOCKS,
        &[("id", id_filter.as_str()), ("user_id", user.as_str())],
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block() -> FocusBlock {
        FocusBlock {
            id: None,
            name: "  Deep work  ".into(),
            start_time: "09:00".into(),
            end_time: "17:00".into(),
            days_of_week: "5,1,2".into(),
            color: "".into(),
            enabled: true,
            process_names: vec![" Slack ".into(), "Slack".into(), "  ".into()],
            domains: vec!["x.com".into()],
        }
    }

    #[test]
    fn hhmm_accepts_padded_24h() {
        for ok in ["00:00", "09:30", "23:59", "12:00"] {
            assert!(valid_hhmm(ok), "{ok} should be valid");
        }
    }

    #[test]
    fn hhmm_rejects_everything_else() {
        for bad in [
            "9:00", "09:0", "24:00", "23:60", "0900", "09-00", "", "09:0a", "09:000", "-1:00",
        ] {
            assert!(!valid_hhmm(bad), "{bad} should be invalid");
        }
    }

    #[test]
    fn days_are_sorted_and_stripped() {
        assert_eq!(normalize_days("5, 1,3").unwrap(), "1,3,5");
        assert_eq!(normalize_days("7").unwrap(), "7");
        assert_eq!(normalize_days("1,2,3,4,5").unwrap(), "1,2,3,4,5");
    }

    #[test]
    fn days_reject_out_of_range_duplicates_and_junk() {
        assert!(normalize_days("0,1").is_err());
        assert!(normalize_days("8").is_err());
        assert!(normalize_days("1,1").is_err());
        assert!(normalize_days("mon").is_err());
        assert!(normalize_days("").is_err());
        assert!(normalize_days("   ").is_err());
        assert!(normalize_days("1,,2").is_err());
        assert!(normalize_days("1,").is_err());
    }

    #[test]
    fn overnight_windows_wrap_past_midnight() {
        assert!(is_overnight("22:00", "06:00"));
        assert!(is_overnight("00:01", "00:00"));
        assert!(!is_overnight("09:00", "17:00"));
        assert!(!is_overnight("09:00", "09:00"));
    }

    #[test]
    fn validate_normalises_and_accepts_overnight() {
        let mut b = block();
        b.start_time = "22:00".into();
        b.end_time = "06:00".into();
        validate(&mut b).unwrap();
        assert_eq!(b.name, "Deep work");
        assert_eq!(b.days_of_week, "1,2,5");
        assert_eq!(b.color, "#4f46e5");
        assert_eq!(b.process_names, vec!["Slack".to_string()]);
    }

    #[test]
    fn validate_rejects_bad_input() {
        let mut empty_name = block();
        empty_name.name = "   ".into();
        assert!(validate(&mut empty_name).is_err());

        let mut bad_start = block();
        bad_start.start_time = "9:00".into();
        assert!(validate(&mut bad_start).is_err());

        let mut bad_end = block();
        bad_end.end_time = "25:00".into();
        assert!(validate(&mut bad_end).is_err());

        let mut zero_length = block();
        zero_length.end_time = zero_length.start_time.clone();
        assert!(validate(&mut zero_length).is_err());

        let mut bad_days = block();
        bad_days.days_of_week = "1,9".into();
        assert!(validate(&mut bad_days).is_err());
    }

    #[test]
    fn missing_relation_matches_both_postgrest_shapes() {
        assert!(is_missing_relation(
            "supabase 404 Not Found: {\"code\":\"PGRST205\",\"message\":\"Could not find the table 'public.schedule_block_apps' in the schema cache\"}"
        ));
        assert!(is_missing_relation(
            "supabase 400 Bad Request: {\"code\":\"PGRST200\",\"message\":\"Could not find a relationship between 'focus_blocks' and 'schedule_block_apps'\"}"
        ));
        assert!(!is_missing_relation("supabase 401 Unauthorized: {}"));
        assert!(!is_missing_relation("error sending request for url"));
        // A real column mismatch must stay a hard error, not a soft skip.
        assert!(!is_missing_relation(
            "supabase 400 Bad Request: {\"code\":\"42703\",\"message\":\"column schedule_block_apps.process_name does not exist\"}"
        ));
        // PGRST002 is a database outage that also says "schema cache", and
        // PGRST204 is a missing column. Neither is "not migrated yet".
        assert!(!is_missing_relation(
            "supabase 503 Service Unavailable: {\"code\":\"PGRST002\",\"message\":\"Could not query the database for the schema cache. Retrying.\"}"
        ));
        assert!(!is_missing_relation(
            "supabase 400 Bad Request: {\"code\":\"PGRST204\",\"message\":\"Could not find the 'process_name' column of 'schedule_block_apps' in the schema cache\"}"
        ));
    }

    #[test]
    fn embedded_rows_parse_into_payload_lists() {
        let row = json!({
            "id": "abc",
            "name": "Deep work",
            "start_time": "09:00",
            "end_time": "17:00",
            "days_of_week": "1,2,3,4,5",
            "color": "#4f46e5",
            "enabled": false,
            "schedule_block_apps": [{"process_name": "Slack"}, {"process_name": "Discord"}],
            "schedule_block_sites": [{"domain": "x.com"}],
        });
        let parsed = parse_block(&row);
        assert_eq!(parsed.id.as_deref(), Some("abc"));
        assert!(!parsed.enabled);
        assert_eq!(parsed.process_names, vec!["Slack", "Discord"]);
        assert_eq!(parsed.domains, vec!["x.com"]);
    }

    #[test]
    fn rows_without_payload_tables_parse_to_empty_lists() {
        let parsed = parse_block(&json!({"id": "abc", "name": "n"}));
        assert!(parsed.process_names.is_empty());
        assert!(parsed.domains.is_empty());
        // Defaults mirror the column defaults so a partial row is still usable.
        assert_eq!(parsed.start_time, "09:00");
        assert_eq!(parsed.days_of_week, "1,2,3,4,5");
    }
}
