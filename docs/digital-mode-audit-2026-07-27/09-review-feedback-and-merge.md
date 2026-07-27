# 09 — Review Feedback and Merge

This file documents the independent adversarial review of the audit by
the `@review` agent (DeepSeek V4 Pro, different vendor from the
primary auditor for genuine cross-vendor diversity), and how its
feedback was merged into the report.

---

## 1. Review setup

- **Reviewer**: `@review` subagent (DeepSeek V4 Pro)
- **Input**: the audit report under `docs/digital-mode-audit-2026-07-27/`
  plus read access to the cited source files.
- **Mandate**: verify accuracy, hunt for missing findings, calibrate
  severities, flag false claims. Be skeptical.

---

## 2. Verdict

> *"The report is trustworthy as a basis for remediation work, with one
> caveat: its P1 severity band is inflated. ... The report's main blind
> spot is the AI tools layer. The report's strongest contribution is
> D-P0-1 — the filmlab source-type guard gap is real, severe, and
> correctly identified with precise line numbers and failure modes.
> All 23 cited line numbers I spot-checked are accurate."*

**Merge decision**: accept all findings, apply all severity
recalibrations.

---

## 3. Severity recalibration

The review argued that 4 of the 5 P1 findings were inflated. After
independent verification against the code, the audit accepts the
downgrades:

| Finding | Pre-review | Post-review | Reviewer's justification (audit concurs) |
|---------|-----------|-------------|------------------------------------------|
| D-P0-1 | P0 | **P0** | Irreversible data loss via `/render`. |
| D-P1-1 | P1 | **P2** ↓ | Hard-coded `digital:true` is overly permissive but RAW decode failure is loud via `rawDecoder.decode()` — not silent degradation. |
| D-P1-2 | P1 | **P2** ↓ | `AsyncStorage.getItem` rejection is rare; missing keys resolve to `null`, not errors. Recovery is one re-toggle. |
| D-P1-3 | P1 | **P2** ↓ | Report itself says "not a correctness bug." One wasted request per cold start, cosmetic flash. |
| D-P1-4 | P1 | **P1** | Real data integrity issue (wrong session_label leaks to photo viewer). |
| D-P1-5 | P1 | **P2** ↓ | Pure documentation drift. No code impact. |

**Net effect on headline counts**:

| Severity | Pre-review | Post-review | Δ |
|----------|-----------|-------------|---|
| P0 | 1 | 1 | 0 |
| P1 | 5 | 1 | -4 |
| P2 | 8 | 12 | +4 (4 downgrades) + 4 (new findings D-M1/M2/M3, plus D-P1-5 lands here) - ... → see below |
| P3 | 9 | 10 | +1 (D-M4) |

Re-derived counts: 1 P0, 1 P1, 12 P2 (D-P1-1/2/3/5 downgraded + D-P2-1..8
original + D-M1/M2/M3 new), 10 P3 (D-P3-1..7 original + D-M4 new).

---

## 4. Missing findings the review caught

All four were verified against the code by the primary auditor before
merge. Each becomes a first-class finding with the `D-M*` ID prefix.

### D-M1 — AI photo-tools leak across mode boundary

**Verified at**:
- `server/services/ai-tools/photo-tools.js:39-48` — `search_photos` SQL has no `source_type` predicate
- `server/services/ai-tools/photo-tools.js:90-97` — `get_photo_detail` same shape
- `server/services/ai-tools/index.js:40-55` — `PHOTO_TOOLS` not in `FILM_ONLY_TOOL_KEYS`, so both tools remain available in digital mode

**Confirmed P2** — genuine cross-mode data leak through the AI chat.
Mentioned in exploration inventory (`ai-tools/digital-tools.js`) but
the report never audited the active `photo-tools.js` for mode
filtering. This is the report's main blind spot.

### D-M2 — Second `ds.deleted_at IS NULL` gap in `digital-sessions` route

**Verified at**: `server/routes/digital-sessions.js:42-49`

Identical SQL shape to D-P1-4. The review notes a calibration nuance:
this endpoint is "get photos of session X" — if X exists (even
soft-deleted), returning its photos is arguably correct. The cleaner
behavior is 404-on-deleted-session (matching the PUT handler at
line 56-62). Either fix is valid; report recommendation R-M2 prefers
option 2.

**Confirmed P2** — same impact as D-P1-4 in a second location.

### D-M3 — `rollbackPartial` disk leak

**Verified at**:
- `server/services/digital-import-service.js:281, 286, 291` — `processOne` writes three files before returning
- `server/services/digital-import-service.js:441-449` — `rollbackPartial` only soft-deletes DB rows, no file cleanup
- The JSDoc comment ("file cleanup is best-effort") is **misleading** — there is no file cleanup at all

**Confirmed P2** — disk waste, no correctness impact, self-limiting
per-import. The report's test-coverage assessment (§2.4) had noted
the rollback path is untested, but never promoted it to a finding.

### D-M4 — `render-positive` and `edge-detection` lack source_type guard

**Verified at**:
- `server/routes/photos.js:1160` — `render-positive` lookup is `WHERE id = ?`
- `server/routes/edge-detection.js:51` — `edge-detection` lookup same

**Calibration: P3, not higher**. Unlike `/api/filmlab/render` (D-P0-1),
these endpoints are **read-only** — they return a buffer, no DB writes,
no thumb regeneration. Both also call `getStrictSourcePath(...,
{allowCrossTypeFallback: false})` which correctly refuses cross-type
file fallback at the storage layer. The remaining damage is "wrong
pipeline runs on the right bytes" — ugly preview, no data loss. P3
is correct.

---

## 5. Minor nits raised by review

### N1 — `isAvailableSync` does not exist

The original R-P1-1 recommendation proposed
`raw-decoder.isAvailableSync?.()`. The reviewer correctly noted: no
sync variant exists today (`isAvailable()` is async). The fix concept
is valid; the recommendation now reads *"either add a sync variant or
memoize the probe at startup."*

### N2 — Migration log crash traversal nuance

The original D-P2-6 writeup said `log()` throws and "the migration
rejects, and `runAllMigrations` aborts startup." The reviewer traced
the exact call path:

```
run-all-migrations.js:116  runner.add('20260701_digital_mode', async () => {
                              const { runDigitalModeMigration } = require('./digital-mode-migration');
                              await runDigitalModeMigration();    ← async factory
                            });
                              ↓
digital-mode-migration.js:37  log('Starting digital-mode migration on: ...')
                              ↓ (synchronous, BEFORE new Promise(...))
                              fs.appendFileSync(...)   ← throws EROFS/EACCES
                              ↓
                              async factory rejects → runner.runAll() catches → startup aborts
```

The traversal is more nuanced than the original writeup suggested
(through `runner.add`'s async factory, not direct rejection inside
`new Promise`). The end behavior is the same — startup crashes on
read-only DB dir — so the finding stands. The fix (wrap
`appendFileSync` in try/catch) is unaffected.

### N3 — Defense-in-depth observation (positive)

The reviewer noted that `photos.js` photo-level mutations
(`export-positive` line 950, `update-positive` line 700,
`ingest-positive` line 792) all guard with `if (row.roll_id == null)
return res.status(400).json({ error: 'Digital photos have no roll
storage' })`. This is implicit defense against digital photos hitting
film mutation endpoints — an observation the report could have noted
as additional defense-in-depth but didn't.

This is now documented in §3 of `02-architecture-and-data-flow.md` is
not updated for it (the observation is informational; no action).

---

## 6. Files updated during merge

| File | Change |
|------|--------|
| `README.md` | Updated headline counts (1/1/12/10), added entries for files 09 and 10 |
| `01-executive-summary.md` | Risk register recalibrated; severity-downgrade reasons annotated inline; D-M1/M2/M3/M4 added |
| `03-server-findings.md` | New section *"Findings added by the independent @review pass"* with D-M1/M2/M3/M4 full write-ups |
| `08-recommendations.md` | New sections R-M1/R-M2/R-M3 (P2) and R-M4 (P3) with files-to-edit and tests-to-add; sequencing reordered; **R-ARCH-1** added (FilmLab/DigitalDevelop unification, see file 10) |
| `09-review-feedback-and-merge.md` | This file |
| `10-develop-ui-unification-analysis.md` | New analysis answering the user's follow-up question about reusing FilmLab's frontend for digital |

---

## 7. What the review did *not* catch (residual blind spots)

For honesty's sake — the review is one pass, not a proof.

- **Concurrency hazards in `digital-develop-service.save()`** — if two
  saves race for the same photoId, the second overwrites the first's
  `develop_params_json` and `positive_rel_path`. Neither the audit
  nor the review verified whether there's row-level locking or a
  version column. Likely a non-issue in practice (single-user
  desktop-electron context) but unverified.
- **Path traversal in `original_filename`** — `processOne` uses
  `item.file.originalname` directly in the INSERT and in
  `digitalFileService.computeDigitalRelPaths(photoId, originalExt,
  shard)`. The latter only uses the extension (safer); the former
  stores the raw name. If multer doesn't sanitize, the DB could hold
  `../../etc/passwd.jpg` as original_filename — harmless unless
  something reads it back into a filesystem context. Not verified.
- **`raw-decoder.decode()` resource exhaustion** — a malicious RAW
  file could potentially cause libraw to allocate huge buffers. No
  size/limit check visible. Not in scope of this audit.

These are flagged for future work, not added to the risk register
without verification.
