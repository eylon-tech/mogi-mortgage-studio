# Mogi Mortgage Studio

Hebrew mortgage-planning interface, decimal cash-flow engine, historical Bank of Israel/CBS data pipelines, and time-ordered market-rate forecasting research.

## Projects

- [`mogi-app`](mogi-app): the web interface, constrained mix search, exact schedule verification, saved-run APIs, and pinned research snapshots.
- [`mogi-financial-core`](mogi-financial-core): PostgreSQL/PGlite schema, HTTP API contracts, source parsers, cash-flow calculations, historical data, backtests, and tests.
- [Current integration architecture](mogi-app/docs/core-integration.md): authoritative integration notes. Earlier component READMEs describe previous milestones; this document supersedes their statements that the engines are unconnected and their older bank-parity figures.

## Run the application

Requires Node.js 22.13+ and npm.

```sh
cd mogi-app
npm run install:ci
npm run dev
```

The development server normally runs at http://127.0.0.1:5173. Production persistence/authentication requires configured hosting and a D1 `DB` binding; no cloud account credentials or production database are included.

## Run the financial API

In a separate terminal:

```sh
cd mogi-financial-core
npm ci
npm run db:ingest
npm run research:save
npm start
```

The API runs on port 4318; the research report is at http://127.0.0.1:4318/research/rates. Ingestion creates a local PGlite database from the included normalized files. Stop the API before ingestion or research persistence because local PGlite requires a single process. External PostgreSQL can be configured with `DATABASE_URL` using `.env.example` as a reference.

## Validation

```sh
cd mogi-financial-core
npm test
```

```sh
cd mogi-app
node tests/validate.mjs
node tests/qa-regressions.mjs
node tests/core-integration.mjs
npx tsc --noEmit
```

For Python parsers and research, use Python 3.11+ and a virtual environment:

```sh
cd mogi-financial-core
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-research.txt
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
OPENBLAS_NUM_THREADS=1 .venv/bin/python research/forecast/backtest.py
```

## Data, provenance and limitations

The source/data snapshot is from **8 October 2026**; this public export was prepared on **20 October 2026**. Exporting did not refresh the data or revalidate regulatory assumptions. The data is public aggregate market data, not customer loan offers.

The app uses a vendored decimal engine and pinned research artifact; it does not connect live to this local financial database. Market-rate research is not a validated personal bank-pricing model. Backtests use historical release-lag assumptions and latest-vintage data, with mixed performance versus baselines. Read the component documentation before interpreting results.

Captured HTTP session-cookie values were removed from public data metadata. Raw-document and dataset references were updated consistently; economic observations are unchanged. [`PUBLIC-EXPORT.json`](mogi-financial-core/PUBLIC-EXPORT.json) records original/public hashes. Historical backtest results and deployed snapshots retain their original provenance: rerunning from the sanitized dataset produces a new run identity.

This repository contains source, tests, documentation and public research data. Local user databases, customer/session records, credentials, machine-specific hosting identifiers, dependency installations and prior private Git history are excluded. The original local project and complete private backup remain separate. No license for the project code or Mogi branding is granted here; included third-party notices and source-data terms remain applicable.
