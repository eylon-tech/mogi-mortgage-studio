#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
"${MOGI_PYTHON:-python3}" scripts/fetch.py
"${MOGI_PYTHON:-python3}" scripts/normalize.py
node scripts/ingest.mjs
node scripts/report.mjs
