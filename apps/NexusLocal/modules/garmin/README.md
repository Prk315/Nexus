# Garmin module

Fetch-only bridge to Garmin Connect. A queued `garmin` command runs
`garmin_bridge.py` and returns raw JSON as the command result; the enqueuing app
maps + upserts into the `protocol_*` tables.

## Interpreter

The module runs the bridge with a **dedicated venv** so it carries its own pinned
`garminconnect` and doesn't depend on the system Python (often too old — modern
`garminconnect` needs 3.10+). Resolution order (`modules/garmin.rs`):

1. `$GARMIN_PYTHON` (explicit override)
2. `~/.nexuslocal/venvs/garmin/bin/python` (the module venv)
3. `py -3` → `python` → `python3` (fallbacks)

## One-time setup (per machine)

```bash
python3 -m venv ~/.nexuslocal/venvs/garmin        # use a 3.10+ interpreter
~/.nexuslocal/venvs/garmin/bin/python -m pip install -r requirements.txt
```

Then authenticate once (stores tokens in `~/.garminconnect`):

```bash
~/.nexuslocal/venvs/garmin/bin/python garmin_bridge.py auth --email you@x.com --password '…'
# add --otp <code> if MFA is enabled
```

## Actions

| action        | payload                          | returns |
|---------------|----------------------------------|---------|
| `check`       | —                                | `{garminconnect_installed}` |
| `status`      | —                                | `{connected}` |
| `sleep`       | `{date:"YYYY-MM-DD", days:N}`    | array of sleep rows |
| `body_stats`  | `{date, days}`                   | array of body/HRV/RHR rows |
| `activities`  | `{date, days}`                   | array of run/workout rows |
