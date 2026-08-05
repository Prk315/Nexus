//! Rewards — unlock a blocked app or site by tracking N minutes today.
//!
//! There is no balance and nothing is spent: the "currency" is minutes of
//! *completed* time entries today, and a rule is satisfied while
//! `today_minutes >= required_minutes`. Unlocks reset at local midnight because
//! the evaluation is date-scoped.
//!
//! Whether a rule is currently satisfied is decided by the `focus-evaluate` edge
//! function and published in `blocking_state`. This module is CRUD over the rules
//! plus a read of that verdict — it must not recompute thresholds client-side, or
//! the phone and the Mac will disagree about what is blocked.
//!
//! # The `enabled` column
//!
//! `unlock_rules.enabled` is being added by a parallel work unit. Until that
//! migration lands the cloud table has no such column, so reads fall back to
//! `true` (a rule that exists is live) and an *insert* that PostgREST rejects for
//! the unknown column is retried without it — a new rule is enabled anyway, so
//! nothing is lost. An *update* is not retried: the only reason to PATCH a rule
//! with no other edit is to flip `enabled`, and silently succeeding at a no-op
//! would tell the UI a lie. The error surfaces instead.

use super::{eq, now_rfc3339, Rest, T_UNLOCK_RULES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockRule {
    pub id: Option<String>,
    /// Exactly one of `process_name` / `domain` is set.
    pub process_name: Option<String>,
    pub domain: Option<String>,
    pub required_minutes: i64,
    /// Absent from the cloud table until the parallel migration lands; a row
    /// without the column is a live rule, so the default is `true` rather than
    /// `bool::default()`.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

/// What a caller may *send* to [`tt_unlock_rule_save`].
///
/// Deliberately not [`UnlockRule`]. That type's `enabled` defaults to `true`,
/// which is right when decoding a pre-migration row (a row that exists is live)
/// and wrong as an input default: a caller that simply forgets the field would
/// get `true` — and because the value is already `true` by the time the
/// fail-closed retry guard sees it, the guard could not catch it. Omitting a
/// field must never be how a rule turns itself on.
///
/// So `enabled` is `Option<bool>` here and *absent means "leave it alone"*: on
/// insert the column default applies, on update the column is not written. Only
/// an explicit value ever changes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockRuleInput {
    pub id: Option<String>,
    pub process_name: Option<String>,
    pub domain: Option<String>,
    pub required_minutes: i64,
    #[serde(default)]
    pub enabled: Option<bool>,
}

const NOT_CONFIGURED: &str = "supabase is not configured (~/.nexuslocalrc)";

/// Refusing beats writing a rule that grants an unlock the caller wanted off.
const DISABLED_NEEDS_COLUMN: &str =
    "cannot save a disabled rule: unlock_rules has no `enabled` column yet \
     (apply 20260805120300_unlock_rules_enabled_and_evaluator_indexes.sql)";

fn ensure_configured(rest: &Rest) -> Result<(), String> {
    if rest.is_configured() {
        Ok(())
    } else {
        Err(NOT_CONFIGURED.to_string())
    }
}

/// Trim, and treat an empty or whitespace-only string as unset. Without this a
/// `{ process_name: "", domain: null }` payload passes a naive "exactly one is
/// `Some`" check and writes a row the edge function can never match.
fn normalize(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The invariants the table cannot express (or expresses only as a raw error):
/// exactly one target, and a threshold that is positive and fits the column.
/// Returns the normalized `(process_name, domain)` pair.
fn validate(rule: &UnlockRuleInput) -> Result<(Option<String>, Option<String>), String> {
    let process_name = normalize(rule.process_name.as_deref());
    let domain = normalize(rule.domain.as_deref());

    match (&process_name, &domain) {
        (Some(_), Some(_)) => {
            return Err("an unlock rule targets an app or a site, not both".to_string())
        }
        (None, None) => {
            return Err("an unlock rule needs a target: an app process or a domain".to_string())
        }
        _ => {}
    }

    // The column is `integer` (int4), not bigint. Without this, anything past
    // i32::MAX 400s with a raw Postgres "integer out of range" the UI can't
    // translate.
    if rule.required_minutes < 1 || rule.required_minutes > i32::MAX as i64 {
        return Err(format!(
            "required_minutes must be between 1 and {}",
            i32::MAX
        ));
    }

    Ok((process_name, domain))
}

/// PostgREST's schema-cache miss for a column that doesn't exist yet (PGRST204).
fn is_missing_enabled_column(err: &str) -> bool {
    err.contains("enabled") && (err.contains("PGRST204") || err.contains("schema cache"))
}

/// May a failed insert be retried with the `enabled` key stripped out?
///
/// Never when the caller explicitly asked for `false`. The column defaults to
/// `true`, so stripping it from a `false` insert would resurrect the rule as
/// live — and a live unlock rule *removes* its target from the effective block
/// sets. That is the unsafe direction: the phone would unblock something the
/// caller asked to keep locked.
///
/// `None` cannot reach here in practice (an absent field is never sent, so
/// PostgREST has nothing to complain about) but is treated as retryable for the
/// same reason it is omitted: the caller expressed no opinion.
fn may_retry_without_enabled(err: &str, enabled: Option<bool>) -> bool {
    is_missing_enabled_column(err) && enabled != Some(false)
}

fn first_row(value: Value) -> Result<UnlockRule, String> {
    let rows: Vec<UnlockRule> =
        serde_json::from_value(value).map_err(|e| format!("unlock_rules: {e}"))?;
    rows.into_iter()
        .next()
        .ok_or_else(|| "unlock_rules: write returned no row".to_string())
}

#[tauri::command]
pub async fn tt_unlock_rules() -> Result<Vec<UnlockRule>, String> {
    let rest = Rest::load();
    ensure_configured(&rest)?;
    let user = eq(rest.user_id());
    let value = rest
        .select(
            T_UNLOCK_RULES,
            &[
                ("select", "*"),
                ("user_id", &user),
                ("order", "created_at.asc"),
            ],
        )
        .await?;
    serde_json::from_value(value).map_err(|e| format!("unlock_rules: {e}"))
}

#[tauri::command]
pub async fn tt_unlock_rule_save(rule: UnlockRuleInput) -> Result<UnlockRule, String> {
    let rest = Rest::load();
    ensure_configured(&rest)?;
    let (process_name, domain) = validate(&rule)?;

    let mut body = json!({
        "process_name": process_name,
        "domain": domain,
        "required_minutes": rule.required_minutes,
        "updated_at": now_rfc3339(),
    });
    // Written only when the caller expressed an opinion. Absent means "leave it
    // alone", which on insert is the column default and on update is no write —
    // never a coerced `true`.
    if let Some(enabled) = rule.enabled {
        body["enabled"] = json!(enabled);
    }

    let response = match &rule.id {
        None => {
            body["user_id"] = json!(rest.user_id());
            match rest.insert(T_UNLOCK_RULES, &body).await {
                Ok(v) => v,
                // Pre-migration table, and the rule is enabled anyway.
                Err(e) if may_retry_without_enabled(&e, rule.enabled) => {
                    if let Some(object) = body.as_object_mut() {
                        object.remove("enabled");
                    }
                    rest.insert(T_UNLOCK_RULES, &body).await?
                }
                Err(e) if is_missing_enabled_column(&e) => {
                    return Err(DISABLED_NEEDS_COLUMN.to_string())
                }
                Err(e) => return Err(e),
            }
        }
        Some(id) => {
            let by_id = eq(id);
            let user = eq(rest.user_id());
            rest.update(T_UNLOCK_RULES, &[("id", &by_id), ("user_id", &user)], &body)
                .await?
        }
    };

    // The server's representation, not the echoed input: if `enabled` was
    // dropped it comes back `true` and the UI toggle visibly snaps back.
    first_row(response)
}

#[tauri::command]
pub async fn tt_unlock_rule_delete(id: String) -> Result<(), String> {
    let rest = Rest::load();
    ensure_configured(&rest)?;
    let by_id = eq(&id);
    let user = eq(rest.user_id());
    rest.delete(T_UNLOCK_RULES, &[("id", &by_id), ("user_id", &user)])
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(process_name: Option<&str>, domain: Option<&str>, minutes: i64) -> UnlockRuleInput {
        UnlockRuleInput {
            id: None,
            process_name: process_name.map(str::to_string),
            domain: domain.map(str::to_string),
            required_minutes: minutes,
            enabled: Some(true),
        }
    }

    #[test]
    fn accepts_an_app_only_rule() {
        let ok = validate(&rule(Some("  Safari  "), None, 60)).unwrap();
        assert_eq!(ok, (Some("Safari".to_string()), None));
    }

    #[test]
    fn accepts_a_site_only_rule() {
        let ok = validate(&rule(None, Some("reddit.com"), 1)).unwrap();
        assert_eq!(ok, (None, Some("reddit.com".to_string())));
    }

    #[test]
    fn rejects_both_targets() {
        assert!(validate(&rule(Some("Safari"), Some("reddit.com"), 60)).is_err());
    }

    #[test]
    fn rejects_no_target() {
        assert!(validate(&rule(None, None, 60)).is_err());
    }

    #[test]
    fn treats_blank_targets_as_unset() {
        // Both blank is "no target", not "both targets".
        assert!(validate(&rule(Some("   "), Some(""), 60)).is_err());
        // One blank plus one real target is a valid single-target rule.
        assert_eq!(
            validate(&rule(Some(""), Some("reddit.com"), 60)).unwrap(),
            (None, Some("reddit.com".to_string()))
        );
    }

    #[test]
    fn rejects_minutes_outside_the_int4_column() {
        assert!(validate(&rule(Some("Safari"), None, 0)).is_err());
        assert!(validate(&rule(Some("Safari"), None, -5)).is_err());
        assert!(validate(&rule(Some("Safari"), None, 1)).is_ok());
        // `required_minutes` is int4 in Postgres but i64 here — reject before
        // the server does, so the message is readable.
        assert!(validate(&rule(Some("Safari"), None, i32::MAX as i64)).is_ok());
        assert!(validate(&rule(Some("Safari"), None, i32::MAX as i64 + 1)).is_err());
    }

    #[test]
    fn a_row_without_the_enabled_column_deserializes_as_enabled() {
        // Pre-migration shape: the whole list command must not fail on it.
        let row = serde_json::json!([{
            "id": "0d2f6f1e-0000-4000-8000-000000000000",
            "user_id": "default",
            "process_name": "Safari",
            "domain": null,
            "required_minutes": 90
        }]);
        let rules: Vec<UnlockRule> = serde_json::from_value(row).unwrap();
        assert_eq!(rules.len(), 1);
        assert!(rules[0].enabled);
        assert_eq!(rules[0].required_minutes, 90);
    }

    /// The safety property. `enabled` has no writer anywhere in the fold-in
    /// (TimeTracker's sync omits it from both push and pull), and a granted
    /// unlock *removes* its target from the effective block sets — so an
    /// `enabled` that silently flips false→true unblocks something the user
    /// asked to keep locked. The pre-migration retry must never do that.
    #[test]
    fn never_retries_an_insert_that_would_flip_disabled_to_enabled() {
        let missing = "supabase 400: {\"code\":\"PGRST204\",\"message\":\"Could not find the 'enabled' column of 'unlock_rules' in the schema cache\"}";
        // Enabled rule: dropping the key lands on the column default (true),
        // which is what was asked for.
        assert!(may_retry_without_enabled(missing, Some(true)));
        // Disabled rule: dropping the key would create a live rule. Refuse.
        assert!(!may_retry_without_enabled(missing, Some(false)));
        // Unrelated failures are never retried either way.
        assert!(!may_retry_without_enabled(
            "supabase 500: internal error",
            Some(true)
        ));
    }

    /// The front-door version of the same flip: a caller that simply omits
    /// `enabled` must not be handed `true`. If the input type defaulted like
    /// the read type does, the retry guard would never see the omission.
    #[test]
    fn omitting_enabled_on_input_is_absent_not_true() {
        let input: UnlockRuleInput = serde_json::from_value(serde_json::json!({
            "process_name": "Safari",
            "required_minutes": 60
        }))
        .unwrap();
        assert_eq!(input.enabled, None);

        // ...whereas a *row* read back without the column is a live rule.
        let row: UnlockRule = serde_json::from_value(serde_json::json!({
            "id": "0d2f6f1e-0000-4000-8000-000000000000",
            "process_name": "Safari",
            "required_minutes": 60
        }))
        .unwrap();
        assert!(row.enabled);
    }

    #[test]
    fn detects_the_missing_enabled_column() {
        // Verbatim from a live PATCH against the pre-migration table, not a
        // guess at PostgREST's wording — the fallback is dead if this drifts.
        assert!(is_missing_enabled_column(
            "supabase 400 Bad Request: {\"code\":\"PGRST204\",\"message\":\"Could not find the 'enabled' column of 'unlock_rules' in the schema cache\"}"
        ));
        assert!(!is_missing_enabled_column("supabase 500: internal error"));
        assert!(!is_missing_enabled_column(
            "supabase 400: {\"code\":\"PGRST204\",\"message\":\"Could not find the 'domain' column\"}"
        ));
    }
}
