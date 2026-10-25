#!/usr/bin/env bash
#
# Import a workflow into the local n8n, with its credentials actually bound.
#
# The workflow JSONs in this repo carry `"credentials": {"<type>": {"id": null,
# ...}}` on purpose — credential ids are instance state and do not belong in
# git. But n8n's importer takes that null literally: the node ends up bound to
# nothing, and the failure surfaces *only on triggered runs* as
#
#     Node "Fetch from Gmail" uses invalid credential
#
# which is the same message the publish-snapshot trap produces, from a
# completely different cause. That ambiguity cost a debugging session on
# 2026-09-08: the drain was re-imported, published, restarted and verified
# active, and still every scheduled pass died in 0 s.
#
# So the resolve step is not optional, and doing it by hand is what goes wrong.
# This script resolves `id: null` against whatever the live instance actually
# has, imports the resolved COPY, publishes it, and restarts — the full
# sequence, because skipping any step silently leaves the old version running.
#
# Usage:
#   ./import-workflow.sh workflows/mail-drain.json nexusMailDrain1
#
set -euo pipefail

FILE="${1:?usage: import-workflow.sh <workflow.json> <workflow-id>}"
WFID="${2:?usage: import-workflow.sh <workflow.json> <workflow-id>}"
CONTAINER="${N8N_CONTAINER:-n8n}"

[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }

# Credentials, straight from the running instance. Matched by TYPE, which is
# safe here because this instance holds exactly one credential per type; if that
# ever stops being true this script must match on name instead and will say so.
CREDS="$(docker exec "$CONTAINER" node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite', {readOnly: true});
console.log(JSON.stringify(db.prepare('select id, name, type from credentials_entity').all()));
")"

RESOLVED="$(mktemp -t n8nwf).json"
python3 - "$FILE" "$RESOLVED" <<PY
import json, sys, collections
creds = json.loads('''$CREDS''')

by_type = collections.defaultdict(list)
for c in creds:
    by_type[c["type"]].append(c)

src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src), object_pairs_hook=collections.OrderedDict)

unresolved = []
for n in d.get("nodes", []):
    for t, ref in (n.get("credentials") or {}).items():
        if ref.get("id") is not None:
            continue
        found = by_type.get(t, [])
        if len(found) == 1:
            n["credentials"][t] = collections.OrderedDict(
                [("id", found[0]["id"]), ("name", found[0]["name"])]
            )
        else:
            # Ambiguous or missing: refuse rather than guess. A wrong binding
            # fails at trigger time, hours later, with a misleading message.
            unresolved.append((n["name"], t, len(found)))

if unresolved:
    for name, t, count in unresolved:
        why = "no credential of this type" if count == 0 else f"{count} candidates — match by name"
        print(f"UNRESOLVED: node {name!r} type {t!r}: {why}", file=sys.stderr)
    sys.exit(1)

json.dump(d, open(dst, "w"), indent=2, ensure_ascii=False)
print("resolved credentials:")
for n in d.get("nodes", []):
    for t, ref in (n.get("credentials") or {}).items():
        print(f"  {n['name']} -> {t} {ref['id']} ({ref['name']})")
PY

docker cp "$RESOLVED" "$CONTAINER:/tmp/wfimport.json"
docker exec "$CONTAINER" n8n import:workflow --input=/tmp/wfimport.json
# import:workflow clears activeVersionId, so publishing is mandatory, not
# optional cleanup — without it the workflow is retired and nothing runs.
docker exec "$CONTAINER" n8n publish:workflow --id="$WFID"
docker restart "$CONTAINER" >/dev/null
rm -f "$RESOLVED"

echo
echo "Restarted. Verify against the STARTUP LOG, never the \`active\` column:"
echo "  docker logs --since 2m $CONTAINER 2>&1 | grep -A20 'Currently active workflows'"
