# Digital Mode Systematic Audit — 2026-07-27

This subdirectory contains the systematic audit of the **digital mode** feature
across desktop (Electron + React), mobile (Expo), and server (Express + SQLite).

## Contents

| File | Scope |
|------|-------|
| `01-executive-summary.md` | Headline findings, risk register, overall verdict |
| `02-architecture-and-data-flow.md` | Two-mode model, state, pipeline, data flow |
| `03-server-findings.md` | Routes, services, migration, capabilities |
| `04-desktop-findings.md` | `client/src/**` digital surface |
| `05-mobile-findings.md` | `mobile/**` digital surface |
| `06-cross-cutting-and-parity.md` | Desktop↔mobile↔server parity matrix |
| `07-test-coverage-assessment.md` | Existing coverage and gaps |
| `08-recommendations.md` | Prioritized remediation plan |
| `09-review-feedback-and-merge.md` | Independent `@review` agent outcome + how it was merged |
| `10-develop-ui-unification-analysis.md` | Should FilmLab's frontend replace `DigitalDevelop.jsx`? |

## Method

1. **Exploration** — whole-repo sweep for `digital`, `source_type`, `mode`,
   `is_digital`, `app_config`, `digital_sessions`, `albums`, `session_id`.
2. **Close reading** of the 12 load-bearing files (canonical mode helpers,
   migration, desktop `App.jsx`, mobile `AppModeContext`, both develop
   services, `photos.js` filtering, `filmlab.js` guard audit,
   `serverCapabilities.js`, migration runner, integrity check, prior
   implementation review).
3. **Cross-reference** against `docs/digital-mode-design/` design docs and the
   prior `DIGITAL-MODE-IMPLEMENTATION-REVIEW.md` (2026-07-25) to identify
   what shipped, what was deferred, and what regressed.
4. **Adversarial pass** — each finding was framed as "could this fail / be
   exploited / mislead the user", then verified against actual code paths.

## Headline Numbers

> After independent `@review` agent pass (see `09-review-feedback-and-merge.md`):
> 4 missing findings added (M1-M4), 4 P1 downgrades applied.

- **1 Critical (P0)** — filmlab pipeline has no `source_type` guard
- **1 High (P1)** — `getDigitalPhotoRecord` joins soft-deleted sessions (D-P1-4, the only true P1)
- **12 Medium (P2)** — capability reporting, mobile state edge cases, schema dead-weight, AI tools leak, rollback disk leak, etc.
- **10 Low / Nit (P3)** — cosmetics, minor robustness, naming, read-only source-guard gaps

(Pre-review counts were 1 / 5 / 8 / 9. The review correctly argued that
4 of the 5 P1s were inflated — see `09-review-feedback-and-merge.md` for
the severity calibration table.)

See `01-executive-summary.md` for the full risk register.
