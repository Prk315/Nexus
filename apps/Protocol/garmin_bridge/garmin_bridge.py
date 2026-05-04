import argparse
import datetime as dt
import json
import sys
from datetime import date, timedelta
from pathlib import Path

TOKEN_STORE = Path.home() / ".garminconnect"


def get_client():
    from garminconnect import Garmin

    client = Garmin()
    client.garth.load(str(TOKEN_STORE))
    client.get_user_summary(date.today().isoformat())
    return client


def cmd_check(args):
    try:
        import garminconnect  # noqa: F401
        print(json.dumps({"garminconnect_installed": True}))
    except ImportError:
        print(json.dumps({"garminconnect_installed": False}))


def cmd_auth(args):
    from garminconnect import Garmin

    email = args.email or input("Garmin email: ")
    password = args.password or input("Garmin password: ")

    client = Garmin(email=email, password=password)

    try:
        client.login(args.otp or None)
    except Exception as exc:
        msg = str(exc).lower()
        # garminconnect signals MFA requirement via various exception messages
        if any(k in msg for k in ("mfa", "2fa", "one-time", "verification")):
            # Return structured response so the UI can show the OTP field
            print(json.dumps({"mfa_required": True}))
            return

        # If an OTP was already supplied, fall through to the normal error path
        raise

    TOKEN_STORE.mkdir(parents=True, exist_ok=True)
    client.garth.dump(str(TOKEN_STORE))
    print(json.dumps({"ok": True}))


def cmd_logout(args):
    import shutil

    if TOKEN_STORE.exists():
        shutil.rmtree(TOKEN_STORE)
    print(json.dumps({"ok": True}))


def cmd_status(args):
    try:
        get_client()
        print(json.dumps({"connected": True}))
    except Exception:
        print(json.dumps({"connected": False}))


def _date_range(end_date_str, days):
    end = date.fromisoformat(end_date_str)
    return [end - timedelta(days=i) for i in reversed(range(days))]


def _hhmm(ts_ms):
    if ts_ms is None:
        return None
    return dt.datetime.fromtimestamp(ts_ms / 1000).strftime("%H:%M")


def _secs_to_min(d, key):
    v = d.get(key)
    return round(v / 60) if v else None


def cmd_sleep(args):
    client = get_client()
    results = []
    for d in _date_range(args.date, args.days):
        ds = d.isoformat()
        try:
            raw = client.get_sleep_data(ds)
        except Exception:
            continue

        daily = raw.get("dailySleepDTO") or {}

        scores = daily.get("sleepScores")
        if isinstance(scores, dict):
            quality = scores.get("overall", {}).get("value")
        else:
            quality = daily.get("sleepScore")

        results.append({
            "date": ds,
            "duration_min": _secs_to_min(daily, "sleepTimeSeconds"),
            "quality_score": quality,
            "deep_sleep_min": _secs_to_min(daily, "deepSleepSeconds"),
            "rem_sleep_min": _secs_to_min(daily, "remSleepSeconds"),
            "light_sleep_min": _secs_to_min(daily, "lightSleepSeconds"),
            "awake_time_min": _secs_to_min(daily, "awakeSleepSeconds"),
            "respiratory_rate": daily.get("averageRespirationValue"),
            "temperature_deviation": daily.get("skinTempF"),
            "bedtime_start": _hhmm(daily.get("sleepStartTimestampGMT")),
            "bedtime_end": _hhmm(daily.get("sleepEndTimestampGMT")),
            "notes": "Garmin import",
        })

    print(json.dumps(results))


def cmd_body_stats(args):
    client = get_client()
    results = []
    for d in _date_range(args.date, args.days):
        ds = d.isoformat()
        entry = {
            "date": ds,
            "weight_kg": None,
            "hrv_ms": None,
            "resting_hr_bpm": None,
            "spo2_pct": None,
            "readiness_score": None,
            "temperature_deviation": None,
            "recovery_index": None,
            "notes": "Garmin import",
        }

        try:
            body = client.get_body_composition(ds)
            rows = (body or {}).get("totalAverage") or {}
            if rows.get("weight"):
                entry["weight_kg"] = round(rows["weight"] / 1000, 2)
        except Exception:
            pass

        try:
            hrv = client.get_hrv_data(ds)
            entry["hrv_ms"] = (hrv or {}).get("hrvSummary", {}).get("lastNight")
        except Exception:
            pass

        try:
            hr = client.get_rhr_day(ds)
            entry["resting_hr_bpm"] = (hr or {}).get("value") or (hr or {}).get("restingHeartRate")
        except Exception:
            pass

        try:
            spo2 = client.get_spo2_data(ds)
            entry["spo2_pct"] = (spo2 or {}).get("averageSpO2")
        except Exception:
            pass

        results.append(entry)

    print(json.dumps(results))


def cmd_activities(args):
    client = get_client()
    end = date.fromisoformat(args.date)
    start = end - timedelta(days=args.days - 1)

    try:
        raw = client.get_activities_by_date(start.isoformat(), end.isoformat())
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    results = []
    for act in raw or []:
        type_key = (act.get("activityType") or {}).get("typeKey", "")
        start_ts = act.get("startTimeLocal", "")
        act_date = start_ts[:10] if start_ts else ""
        duration_min = round(act.get("duration", 0) / 60) if act.get("duration") else None

        if "running" in type_key or "walk" in type_key:
            dist_m = act.get("distance") or 0
            results.append({
                "type": "run",
                "date": act_date,
                "name": act.get("activityName", ""),
                "actual_km": round(dist_m / 1000, 2) if dist_m else None,
                "avg_pace_s_per_km": round(act.get("duration") / (dist_m / 1000)) if dist_m and act.get("duration") else None,
                "heart_rate_avg": act.get("averageHR"),
                "heart_rate_max": act.get("maxHR"),
                "elevation_gain_m": act.get("elevationGain"),
                "cadence_avg": act.get("averageRunningCadenceInStepsPerMinute"),
                "calories": act.get("calories"),
                "duration_min": duration_min,
            })
        else:
            results.append({
                "type": "workout",
                "date": act_date,
                "name": act.get("activityName", ""),
                "duration_min": duration_min,
                "calories_burned": act.get("calories"),
                "avg_heart_rate": act.get("averageHR"),
            })

    print(json.dumps(results))


def main():
    parser = argparse.ArgumentParser(description="Garmin Connect bridge — outputs JSON to stdout")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="Check if garminconnect library is installed")

    p_auth = sub.add_parser("auth", help="Authenticate with Garmin and store tokens")
    p_auth.add_argument("--email", default="", help="Garmin account email (omit to be prompted)")
    p_auth.add_argument("--password", default="", help="Garmin account password (omit to be prompted)")
    p_auth.add_argument("--otp", default="", help="One-time MFA code (for second auth step)")

    sub.add_parser("logout", help="Remove stored Garmin tokens")
    sub.add_parser("status", help="Check if stored tokens are valid")

    p_sleep = sub.add_parser("sleep", help="Fetch sleep data")
    p_sleep.add_argument("--date", required=True, help="End date YYYY-MM-DD")
    p_sleep.add_argument("--days", type=int, default=7)

    p_body = sub.add_parser("body_stats", help="Fetch body composition + HRV + RHR + SpO2")
    p_body.add_argument("--date", required=True, help="End date YYYY-MM-DD")
    p_body.add_argument("--days", type=int, default=7)

    p_act = sub.add_parser("activities", help="Fetch activities")
    p_act.add_argument("--date", required=True, help="End date YYYY-MM-DD")
    p_act.add_argument("--days", type=int, default=7)

    args = parser.parse_args()

    dispatch = {
        "check": cmd_check,
        "auth": cmd_auth,
        "logout": cmd_logout,
        "status": cmd_status,
        "sleep": cmd_sleep,
        "body_stats": cmd_body_stats,
        "activities": cmd_activities,
    }

    try:
        dispatch[args.command](args)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
