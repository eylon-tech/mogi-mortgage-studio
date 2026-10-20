# Mogi — Mortgage Optimization Studio

Private working application in Hebrew, based on Mogi's supplied design system and logo. Light interface, editable mortgage tracks, bounded multi-objective search, scenario charts, source history, Wise questionnaire import preview, and owner-scoped saved runs.

## Run and validate

Use Node 22.13+ and npm. Run `npm ci`, `npm run dev`, `node tests/validate.mjs`, and `npx tsc --noEmit`. The Site's portable build uses its bundled `build-site.mjs`. Tests include public source fixtures and synthetic Wise cases; no customer data or keys are included.

D1 uses binding `DB`; migration `drizzle/0000_melted_moon_knight.sql` defines owner-scoped documents. The starter handles Sites authentication. Local preview uses the starter's mock sign-in, while deployed access is private to the Site owner. Production migrations are applied through the Sites deploy lifecycle.

## Calculation conventions

- Monthly nominal interest; Equator effective annual rates are converted before amortization.
- End-of-month payments, full loan advanced at inception, grace included in total term.
- Annuity, equal principal, full/partial balloon, full/partial grace, single planned prepayment per track. Term reduction preserves the installment with a final partial payment.
- BOI 451 forward anchors use nominal or real term curves. Contractual spread takes precedence; otherwise the implied spread is explicitly an estimate. Prime uses the nominal monthly anchor plus 1.5 percentage points and spread.
- The current payment holds price conditions constant. Indexed forecast cash flows include first-month indexation. Full precision is default; future rate rounding is configurable.
- Balloon maturity is reported separately from regular monthly peak. Fees and prepayments enter total payments and IRR.
- Income requires verified status. Continuing obligations, rent and same-property payments are treated explicitly. Source links document 329 and the October 2026 change.

## Optimizer

A deterministic 5/10/20-percent allocation grid checks selectable track kinds and six default term combinations (15,23,30 years). Enforces LTV, maximum variable/indexed shares, PTI and optional hard budget/forecast peak limits. Ranks normalized cost, current payment and stressed-payment increase. Reports Pareto alternatives. This is a best result within the tested grid and fixed assumed prices; it is not a claim of global optimum or bank pricing approval.

## Sources and reproducibility

Initial public data snapshot: 8 October 2026 (Israel time). Sources: BOI policy API; Equator by bank/type; 451 forecast workbook with 121 vintages; BIR_MRTG_99; ZCM; CBS CPI; early-repayment reference workbook downloads. Manual refresh validates data and retains the last good source on failure. Saved runs pin inputs, full curve, model version and hashes. Refreshing the data room never changes a saved run. Rates/forecast are adopted explicitly.

Public source workbooks and fetched history can be exported from the app. The source list records the actual use of each dataset. The early-repayment workbooks are downloaded and fingerprinted only; fees are entered from the bank rather than automatically inferred.

## Verified limits and outstanding work

- Equator's current public download contains August 2024–August 2026. March 2023–July 2024 (17 months) was not recoverable from the observed public dashboard and is not fabricated. System-wide BIR data does not substitute for missing bank-level history.
- Fixed annuity agrees to cents with Jerusalem/Fibi's displayed synthetic benchmark. Wise grace, balloon, indexed and prepayment cases are covered. For the 60-month variable case, Wise total is 2,132,103 NIS and this model is 2,132,150.58795 NIS; the 47.58795 NIS difference remains unexplained. All reset rates agree to Wise's displayed two decimals. Passing regression tests does not resolve this difference.
- Discount/Mercantile have a small unexplained maximum-payment discrepancy. Mizrahi was exercised with its different default mixed case, not the identical fixed benchmark.
- Live refresh worked for the policy/Equator/451/repayment files locally; CBS and the two BOI SDMX sources returned unavailable/unsupported responses in the Worker runtime, retaining the successfully downloaded initial snapshot. Availability may vary by runtime.
- Wise AI API is a personal Gemini key for credit-report analysis. No documented optimizer-result API was verified. Questionnaire mapping is local and synthetic-tested; live webhook authentication, payload envelope and retries are not yet verified. Lead ingestion and embedding were researched but not enabled.
- No real approval documents were used. The app does not infer personally approved bank rates or certify underwriting eligibility. Exact calendar accrual, contractual prepayment-fee calculation, multiple staged disbursements and full production servicing are outside this version.

## Validation evidence

`tests/validation-result.json` records 24 passing checks and the unresolved Wise discrepancy. Browser checks cover search, impossible budget, saved-run persistence across reload, restoration, Wise draft mapping, source refresh with partial fallback, schedule rendering and responsive layout. A read-only WebMCP tool exposes the visible calculation and validation errors without changing or saving data.

The CSV export control is implemented; the in-app browser download event did not complete during automation, so downloaded-file verification remains unconfirmed.
