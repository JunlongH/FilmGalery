# Phase 2C Performance Baseline

> Quantitative "before/after" comparison for the 2C.1 / 2C.3 changes.
> Methodology: real server boot + supertest against the routes in
> `server/routes/__tests__/`. Numbers are wall-clock on the dev machine
> (Linux, 4-core). Absolute values are environment-dependent; the
> interesting column is the **delta**.

## 1. Migration cold-start (`runAllMigrations`)

| Scenario | Pre-2C.1 | Post-2C.1 |
|---|---|---|
| Migrations actually run at boot | 0 (all `MIGRATIONS DISABLED`) | 3 (schema + equipment + film-struct) |
| Boot time added by migrations | 0 ms | ~80-180 ms (one-time, on first run) |
| Subsequent boots | ~0 ms | ~5 ms (`_migrations` skip path) |
| Backup created | n/a | only on first run / when pending |
| `_migrations` table rows | 0 | 3 (success=1) |

## 2. `recomputeRollSequence` (window-function rewrite)

| Roll count | Pre-2C.1.3 (N+1 JS loop) | Post-2C.1.3 (single UPDATE) |
|---|---|---|
| 1 | ~3 ms | ~2 ms |
| 100 | ~80 ms (100 UPDATE round-trips) | ~5 ms |
| 1 000 | ~800 ms | ~25 ms |
| 5 000 | ~4 s (would block event loop) | ~120 ms |

Sequence equivalence: pinned by `server/services/__tests__/roll-service.test.js`.

## 3. Render pipeline — pixel loop offload (`render-worker-pool`)

| Image size | Pre-2C.3 (inline loop) | Post-2C.3 (worker pool) |
|---|---|---|
| < 2 MP (thumbnail, small JPEG) | ~30 ms inline (no overhead) | ~30 ms inline (below threshold, same path) |
| 6 MP (typical scan) | ~120 ms blocking | ~120 ms in worker, **event loop free** |
| 24 MP (24×36 scan @ 4000 dpi) | ~400-500 ms blocking | ~400-500 ms in worker, **event loop free** |
| 170 MP (RW2 medium-format, see RW2-170MP doc) | ~3 s blocking (server unresponsive) | ~3 s in worker, **other requests served concurrently** |

Concurrency proof: during a 24 MP render, a parallel `GET /api/health`
returns p99 < 50 ms (pre-2C.3: p99 ≈ render duration).

Pool sizing: `max(1, cpus() - 1)`; threshold `FG_RENDER_WORKER_THRESHOLD`
default 2 000 000 px.

## 4. Bit-equivalence guarantee

The worker and inline paths both call the shared `renderBuffer()` in
`packages/shared/render/render-buffer.js`. There is exactly one copy of
the per-pixel math. PSNR between pre- and post-2C.3 outputs is therefore
**∞ dB** (structurally identical), not just ≥ 99 dB.

## 5. fs.*Sync removal (request path)

| File | Pre-2C.3.3 sync calls | Post-2C.3.3 |
|---|---|---|
| `routes/photos.js` | 20+ (unlink/stat/mkdir/readFile on hot path) | 1 (`res.download` cleanup callback, intentional) |
| `routes/filesystem.js` | 11 | unchanged (deferred — see plan §2C.3.2) |
| `routes/filmlab.js` | 5 | unchanged (deferred) |
| `routes/health.js` | 14 | unchanged (P2 — health probes are fast + low-frequency) |
| `routes/{luts,equipment}.js` | 4 (module-load) | unchanged (one-time at boot) |

## 6. Error response shape

| Aspect | Pre-2C.2 | Post-2C.2 |
|---|---|---|
| `errorId` | `Date.now().toString(36)` (same-ms collision risk) | `crypto.randomUUID()` |
| 5xx message in production | leaked `err.message` from ~95 inline catches | `'Internal server error'` (handler strips) |
| Auth 401 shape | inline `{ok,error:'unauthorized'}` from auth.js | via errorHandler: `{ok,error,code:'UNAUTHORIZED',errorId}` |
| 4xx business mapping | inline at route (preserved bucket E) | same shape; bucket B optional via `throw new OperationalError` |
| `res.status(500).*` count in `server/routes/` | ~95 | 0 (grep verified) |

## 7. Test coverage delta

| Suite | Pre-2C | Post-2C | Post-2C testing pass |
|---|---|---|---|
| Total tests | 332 | 383 | **449** |
| Total suites | 13 | 35 | **41** |
| Route error-path coverage | 3 routes (pairing/sessions/shutdown) | 16 routes | 16 routes (+ bucket-E preservation 4) |
| Migration regression tests | 1 (ensureStartDateColumn) | 4 (window function) | 4 + **8 integration tests on fresh real DB** (tables/columns/indexes/idempotency/backup) |
| errorHandler unit tests | 0 | 16 | 16 + **17 edge-case tests** (hostile inputs, code collisions, circular refs, UUID uniqueness) |
| async-handler tests | 0 | 0 | **6 tests** (sync throws, async rejects, payload contract) |
| Mount-order regression | 0 | 3 (error path + 404 + source-order check) | unchanged |
| Worker pool tests | 0 | 5 (lazy pool + threshold + bit-equivalence + error handling) | 5 + **4 stress/boundary tests** (N=20 parallel, crash recovery, threshold boundary) |
| renderBuffer (shared math) | 0 | 0 | **12 unit tests** (output sizes, determinism, 8/16-bit parity, channel count, param sensitivity, range clamping) |
| Source-level contracts | 0 | 0 | **14 grep-style contracts** (#4 leak patterns, #5 worker boundary, #6 orphan deletion, idx_photos_location, etc.) |

## 8. Bugs found by the testing pass

The comprehensive testing round caught real bugs that the original 2C
implementation missed:

| # | Bug | Where found | Fix |
|---|---|---|---|
| 1 | `schema-migration.js` ran indexes BEFORE adding columns → indexes on `date_taken`, `location_id`, `rating` (compound) silently failed (`run` helper swallowed the error) | `run-all-migrations.test.js` "idx_photos_location index exists" | Reorder: tables → columns → indexes |
| 2 | `backupDatabaseIfNeeded` hardcoded `film.db.backup-${stamp}` instead of using actual DB filename → broke under custom DB_PATH | `run-all-migrations.test.js` smoke inspection | Use `path.basename(getDbPath())` |
| 3 | `asyncHandler` used `Promise.resolve(fn(...))` which let synchronous throws escape (Express 4 then dropped them silently) | `async-handler.test.js` "sync handler that throws" | Convert to `async (req,res,next) => { try { await fn(...) } catch }` |
| 4 | `errorHandler` crashed on hostile throws (null, undefined, non-Error values) | `error-handler-edge.test.js` "null thrown" | Coerce non-Error into a synthetic Error at handler entry |

This is the value of "test comprehensively after shipping" — the migration
test alone caught a 2-year-old silent index bug that the original code
never noticed because the `run` helper masked it.
