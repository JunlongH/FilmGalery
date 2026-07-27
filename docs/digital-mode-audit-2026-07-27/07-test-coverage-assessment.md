# 07 — Test Coverage Assessment

## 1. What Exists

### 1.1 Server (Jest)

| File | Examples | What it asserts |
|------|----------|-----------------|
| `server/utils/__tests__/run-all-migrations.test.js` | 1 | Migration `20260701_digital_mode` is in `REGISTERED_MIGRATIONS` |
| `server/routes/__tests__/digital-import.test.js` | 5 | 202+jobId contract; legacy `{files}` → 400; items missing/empty → 400 |
| `server/routes/__tests__/digital-develop.test.js` | 6 | preview → image/jpeg; legacy `{photoId}` → 400; save/export/getParams |
| `server/routes/__tests__/albums.test.js` | 3+ | `albums.list` SQL: count, date range, empty album null |
| `server/routes/__tests__/mode-filter.test.js` | 11 | `buildSourceTypeClause` applied across photos/tags/stats endpoints per mode; no-mode → no filter |
| `server/routes/__tests__/photos-facets.test.js` | varies | facets endpoint applies mode clause |
| `server/routes/__tests__/photos-soft-delete.test.js` | 9 | DELETE soft, hard (`?hard=true`), restore, 404 on re-delete, `checkHash` excludes deleted |
| `server/services/__tests__/digital-import-service.test.js` | 15+ | preview hash/dedup/RAW-probe; execute happy path; rollback on cancel; temp cleanup |
| `server/services/__tests__/digital-develop-service.test.js` | 15 | `normalizeParams` aliases (crop↔cropRect, temperature↔temp), LUT deserialization, forced `inverted=false`/`filmCurveEnabled=false` |

### 1.2 Smoke tests (non-Jest)

| File | What |
|------|------|
| `server/utils/smoke-test-digital-mode.js` | Migration tables/columns/indexes/backfill/seed against a tmp DB |
| `server/smoke-test-part3.js` | End-to-end HTTP for `/api/digital-sessions`, `/api/digital-develop`, `/api/digital/import/*` |
| `server/smoke-test-endpoints.js` | `?mode=film` filter + `source_type` field on photo lists |

### 1.3 Integrity check

`server/scripts/digital-integrity-check.js` — 7 invariants:
1. All photos have `source_type` (no NULL)
2. Digital photos have NULL `roll_id`
3. Film photos have NULL `session_id`
4. No orphan `album_photos` (photo missing)
5. No orphan `album_photos` (album missing)
6. `digital_sessions.file_count` matches actual photos
7. Digital cameras have NULL `format_id`

Exit code 1 on any failure — suitable as a CI gate or post-deploy check.

### 1.4 Mobile (Jest + React Native Testing Library)

| File | What |
|------|------|
| `mobile/__tests__/app-mode.test.tsx` | `AppModeContext` persistence + read |
| `mobile/__tests__/overview.test.tsx` | mode switch refetches with `mode=digital` |
| `mobile/__tests__/home-screen.test.tsx` | DigitalTimelineScreen vs FilmTimelineScreen render |
| `mobile/__tests__/library-screen.test.tsx` | film-only entries hidden in digital |
| `mobile/__tests__/albums-tab.test.tsx` | digital album list rendering |
| `mobile/__tests__/digital-timeline.test.tsx` | digital timeline paging |
| `mobile/__tests__/digital/PhotoViewDigital.test.tsx` | digital photo view (EXIF, album actions) |
| `mobile/__tests__/digital/DigitalAlbumDetail.test.tsx` | album detail mutation |
| `mobile/__tests__/digital/albums-integration.test.tsx` | albums end-to-end |

### 1.5 Desktop

None. (D-P2-8)

---

## 2. Coverage Shape Analysis

**Strengths**

- The migration has a dedicated smoke test that validates the full
  schema surface (tables, columns, indexes, backfill, seed) against a
  throwaway DB. This is exemplary — most projects test only the
  migration's idempotency, not its observable outcome.
- The integrity check encodes the feature's data invariants as code.
  This is the right way to prevent regression: any future migration or
  service change that violates an invariant will fail the check.
- Mobile has a deeper component-test suite than desktop, including
  integration-level tests.
- The server route tests include key negative contracts (legacy payload
  shapes → 400). This is what enabled the W1 fixes to be verified.

**Gaps**

### 2.1 Negative-contract gap (cross-cutting)

Almost every test asserts *the right call succeeds*. Almost none assert
*the wrong call is rejected*. The P0 and several P1 findings live in
this gap:

| Finding | Missing negative test |
|---------|----------------------|
| D-P0-1 | `/api/filmlab/{preview,render,export}` with a digital photo id → should 4xx |
| D-P1-1 | `/api/discover` reflects actual libraw availability |
| D-P1-4 | `getDigitalPhotoRecord` excludes photos with soft-deleted session |
| D-P2-3 | `normalizeParams` surfaces (or at least logs) corrupt JSON |
| D-P2-5 | `normalizeMode('digitaal')` documented contract |

**Recommendation**: adopt a "for every positive contract, write the
matching negative contract" rule for security/correctness-sensitive
endpoints. The existing test style (mock `db.get`, call route, assert
status) supports this with no new infrastructure.

### 2.2 Desktop UI gap

Mobile has 9 test files covering digital screens; desktop has 0. The
W2-R and W3-R review waves caught three Critical UI bugs (LUT
serialization, crop handle mapping, `normalizeParams` mutation) — all
of which would have been caught by a render-and-assert test.

**Recommendation**: introduce a minimal `client/src/components/digital/__tests__/`
mirroring the mobile `__tests__/digital/` structure. Priority:
`DigitalDevelop.test.jsx` (highest LOC, most complex state),
`ImageViewer.dispatch.test.jsx` (security-relevant dispatch).

### 2.3 Migration behavior (not just registration)

`run-all-migrations.test.js` asserts only that the migration id is
registered. The migration's *behavior* (idempotency, backfill correctness,
column additions) is covered by `smoke-test-digital-mode.js` — which is
good — but the smoke test is not part of the Jest suite and may not run
in CI.

**Recommendation**: verify `smoke-test-digital-mode.js` is wired into
CI; if not, either port its assertions to Jest or add a CI step that
runs the smoke scripts.

### 2.4 Concurrency / cancellation

`digital-import-service.execute` has rollback-on-cancel and
pre-flight temp-file existence checks. The rollback path
(`rollbackPartial`) is not tested — only the happy path is.

**Recommendation**: add a test that triggers cancellation mid-import
(mock `jobRegistry.isCancelled` to return true after N files) and
asserts partial photos are soft-deleted.

### 2.5 EXIF failure tolerance

`attachExifToJpegBuffer` is failure-tolerant by design (returns
original buffer on any error). No test exercises the failure path.

**Recommendation**: mock `writeExifWithExiftool` to throw; assert the
returned buffer equals the input and a warning is logged.
