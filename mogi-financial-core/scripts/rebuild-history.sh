#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for manifest in data/fetch-*.json; do
  "${MOGI_PYTHON:-python3}" scripts/normalize.py --manifest "$manifest"
  node scripts/ingest.mjs "$manifest"
done
node scripts/report.mjs
