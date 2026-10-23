#!/bin/sh
# Rebuild the Kalkulus reader prototype's assets from the PDF.
#
#   cd apps/Vault/Vault && ./scripts/reader-proto/run.sh
#
# Re-runnable: every output is regenerated from the PDF, nothing is appended.
# Writes ten PNGs and reader.json into public/reader-proto/kalkulus/, which is
# what the `Kalkulus (reader)` node's content pointer resolves to:
#
#   {"v":1,"source":"/reader-proto/kalkulus/reader.json"}
#
# Needs PyMuPDF in the system python3 (`python3 -c "import fitz"`) and the
# repo's node_modules for vite-node. Point PDF= somewhere else to use another
# copy of the book.
#
# Two stages on purpose — see annotate.ts: stage 2 runs the app's own
# detectConcept, so the labels in reader.json cannot drift from the labels the
# concept rail renders.
set -eu

PDF="${PDF:-/Users/bastianthomsen/Desktop/Kalkulus.pdf}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
OUT="$APP/public/reader-proto/kalkulus"
RAW="$HERE/.cache/reader.raw.json"

echo "extract  $PDF"
python3 "$HERE/extract.py" --pdf "$PDF" --out "$OUT" --raw "$RAW"

echo "annotate"
cd "$APP"
npx vite-node "$HERE/annotate.ts" -- "$RAW" "$OUT/reader.json"
