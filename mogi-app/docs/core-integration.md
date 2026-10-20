# Mogi financial core integration — 2026-10-08

The existing private Site now runs `mogi-cashflow-0.2.1` (vendored byte-for-byte from the local financial core, hashes in `lib/financial-core/manifest.json`). Both browser schedules and server-side saved-run recomputation use this implementation. `mogi-2.0.0` identifies the adapter/search conventions. Legacy saved records remain immutable; opening a 1.x record displays an explicit recalculation notice and its original saved total. Saving always creates a new record.

## Calculation and search

- Decimal arithmetic with 40 digits and monthly half-up rounding to agorot. Monthly periods; no stub-period/day-count implementation.
- BOI 451 effective annual forwards convert to nominal annual before combination with a nominal spread. Supplied contractual anchor/spread overrides inferred spread.
- Indexation uses explicit monthly levels, currently without a base floor. Missing forecast inputs invalidate the whole forecast and retain only current-term calculations. Balloon maturity is separate from regular payments; full-grace PTI uses the post-grace payment.
- Rules use the versioned BOI 329 configuration, effective 2026-10-01 and verified through 2026-10-08. Unknown commitment maturity requires review. Ordinary residential purchase only.
- A Web Worker screens the configured grid, then verifies up to 120 leading/diverse candidates with exact schedules. Ranking/Pareto status is relative to verified candidates. The counts for unique screening, approximate feasibility, attempted exact verification, and exact feasibility are distinct. This is not a global optimum certificate; rounding can exclude a borderline screened candidate before exact verification.
- Contract offers, explicitly locked/existing tracks, prepayments, grace, and non-annuity methods are preserved. The optimizer never treats aggregate forecasts as customer underwriting.

## Research integration and provenance

`research/forecast/export_site.py` in the core exports the pinned public-data artifact `lib/data/core-research.json`. It verifies the immutable backtest SHA and dataset SHA, reuses configurations locked before the holdout, and refits only on matured labels for new forecasts. Its supplemental rate convention evidence is BOI reporting directive 877 section 9: effective annual. It does not rewrite the original backtest artifact.

The UI exposes all six target/horizon combinations, actual versus predicted historical outcomes, persistence baselines, delayed-release sensitivity, interval coverage, and paired uncertainty intervals. Historical vintage availability is not verified; release lags are assumptions. None of these results enables customer-specific pricing.

The optional button applies the model's nominal-equivalent *change* to the two fixed-track reference rates. Other reference rates stay unchanged. This is an explicit sensitivity assumption, not an absolute personal quote or a future draw-date forecast. Reapplication starts from the pinned base rates. Original bank offers stay locked. Research SHA, dataset SHA, horizon and base rates are saved; the server rejects forged versions or altered rates claiming this provenance.

The deployed Site contains a versioned research snapshot, not a live connection to the local PostgreSQL/PGlite database. The existing market-data refresh remains separate. Future research updates require a fresh export, validation, and Site deployment. No localhost endpoint or private raw borrower dataset is embedded in production.

## API

- Authenticated `GET /api/core/research`: installed model/core versions, rule set, research artifact and all 144 holdout forecast rows.
- Existing owner-scoped `POST /api/runs`: validates schema and research provenance, requires the current model version, recomputes schedules and eligibility on the server, pins engine/rules versions, and saves an immutable snapshot in the existing D1 documents table.
- Existing quote ingestion and readiness checks remain unchanged; pricing cannot activate without verified borrower data and validation.

## Verification and known differences

57 core tests; 24 Site validation checks; 10 regressions; 10 integration checks, including every-month adapter/core parity, missing-data fallback, exact candidate constraints, immutable research selection, offer preservation and spoofed-provenance rejection. TypeScript and production build are required. Local UI exercise covers worker execution, research-to-optimization, saving and restoration.

`lib/data/core-bank-comparison.json` records current differences rather than inheriting previous parity claims: fixed 1.2m/300m/4.5% total is ILS 2,000,996.74 (ILS -0.18 versus Jerusalem/Fibi reference); the variable scenario differs by ILS -4,912.58 from the captured Wise result after effective/nominal conversion; indexed peak differs by ILS +4.71. Exact bank-specific conventions remain unverified. No end-to-end bank parity claim is made.
