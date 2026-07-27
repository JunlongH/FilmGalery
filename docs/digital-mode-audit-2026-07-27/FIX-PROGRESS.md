# Digital Mode Fix Progress — 2026-07-27

Tracks remediation of findings from the audit in this directory. Each finding:
**(1) verified against code → (2) fixed systematically → (3) reviewed by `@review`.**

Legend: ⬜ pending · 🔧 in progress · ✅ done · ⏭️ deferred (with reason)

| ID | Sev | Fix summary | Status | Review |
|----|-----|-------------|--------|--------|
| D-P0-1 | P0 | filmlab `/preview` `/render` `/export` source_type guard | ✅ | ✅ no Critical; W1/W2 fixed |
| D-M4 | P3 | `render-positive` + `detect-edges` (+`apply-edge-detection`) same guard (paired with D-P0-1) | ✅ | ✅ no Critical |
| D-P1-4 | P1 | `getDigitalPhotoRecord` JOIN masks soft-deleted session metadata (ON clause) | ✅ | ✅ clean (1st pass caught WHERE-vs-ON, corrected) |
| D-M2 | P2 | `GET /digital-sessions/:id/photos` 404 gate on soft-deleted session | ✅ | ✅ clean |
| D-M1 | P2 | AI `search_photos` / `get_photo_detail` mode-aware filtering | ✅ | search/get_detail/neighbors filtered via handler context mode; get_roll_photos hidden in digital mode |
| D-M3 | P2 | `rollbackPartial` unlinks orphan files + hard-deletes rows | ✅ | ✅ no Critical; follow-ups fixed (processOne self-cleanup, idempotent session delete) |
| D-P1-1 | P2 | `capabilities.digital` reflects raw-decoder availability | ✅ | ✅ no Critical; W1/W2/N1 fixed |
| D-P1-2 | P2 | AppModeContext: warn on AsyncStorage failure | ✅ | ✅ no Critical |
| D-P1-3 | P2 | AppModeContext: `hydrated` flag before first paint | ✅ | ✅ no Critical; W1 race accepted pre-existing |
| D-P1-5 | P2 | docs: migration id `20260801` → `20260701` | ✅ | doc-only, verified by grep |
| D-P2-3 | P2 | `normalizeParams` parse failure surfaces warning | ✅ | ✅ no Critical |
| D-P2-5 | P2 | strict `?mode=` validation (400 on unknown) | ✅ | ✅ 1 Critical (unbounded warn Set) fixed with 500-cap |
| D-P2-6 | P2 | migration `log()` non-fatal on read-only dir | ✅ | ✅ no Critical |
| D-P2-1/2 | P2 | smart-album / stacking columns: document as reserved | ✅ | n/a (docs-only) |
| D-P2-4 | P2 | lens `is_digital` three-state semantics documented | ✅ | n/a (docs-only) |
| D-P2-7 | P2 | docs: mobile develop gap noted as known limitation | ✅ | n/a (docs-only) |
| D-P2-8 | P2 | desktop component tests for digital surface | ✅ | ✅ no Critical (5 W + 3 N, all addressed) |
| D-P3-1 | P3 | `getPhotoWithRoll` → `getPhotoForExport` rename | ✅ | n/a (mechanical rename, grep-verified) |
| D-P3-2 | P3 | comment: NULL-tolerance asymmetry in buildSourceTypeClause | ✅ | n/a (comment-only) |
| D-P3-3 | P3 | Statistics `mode` prop split → `workspace` + `view` | ✅ | ✅ no Critical |
| D-P3-4 | P3 | `library_mode@baseUrl` orphaning: accept + document | ✅ | n/a (comment-only) |
| D-P3-5 | P3 | covered by D-P0-1 | ⏭️ | — |
| D-P3-6 | Nit | onboarding probe: /api/health liveness + mode-agnostic existing-data signal | ✅ | ✅ no Critical; W1 fail-closed regression fixed |
| D-P3-7 | Nit | confirm branch commit baseline | ✅ | verified 2026-07-27 (see below) |

## Verification log

All findings verified against source on 2026-07-27 before fixing:

- **D-P0-1** ✅ `server/routes/filmlab.js:32,131,261` — all three lookups are `WHERE id = ?` with no source_type predicate; `/render` UPDATEs `positive_rel_path` (line 237-245) → confirmed data-loss path.
- **D-M4** ✅ `server/routes/photos.js:1160`, `server/routes/edge-detection.js:51` — same shape, read-only.
- **D-P1-4** ✅ `server/services/digital-develop-service.js:43` — `LEFT JOIN digital_sessions ds ON p.session_id = ds.id` (no deleted_at filter).
- **D-M2** ✅ `server/routes/digital-sessions.js:42-49` — same JOIN shape; PUT handler at :59 does filter → inconsistency confirmed.
- **D-M1** ✅ `server/services/ai-tools/photo-tools.js:39-48,90-97` — no source_type predicate; `index.js:40-55` PHOTO_TOOLS not in FILM_ONLY_TOOL_KEYS; `ai-orchestrator.js:338,354` handler invoked without mode.
- **D-M3** ✅ `digital-import-service.js:281,286,291` writes 3 files; `:301` returns `{id}` only; `:441-449` rollback only soft-deletes.
- **D-P1-1** ✅ `packages/shared/serverCapabilities.js:101` — `digital: true` hard-coded.
- **D-P1-2/3** ✅ `mobile/src/context/AppModeContext.tsx:19,29` — initial `'film'`, `.catch(() => {})` silent, no hydrated flag.
- **D-P1-5** ✅ `docs/digital-mode-design/03-data-model-and-migration.md:200` + `08-implementation-plan-data.md:213,220` say `20260801_digital_mode`; `server/utils/run-all-migrations.js:28,116` registers `20260701_digital_mode`.
- **D-P2-3** ✅ `digital-develop-service.js:101` — silent catch → `{}`.
- **D-P2-5** ✅ `packages/shared/photographyMode.js:33` — unknown → `'all'`.
- **D-P2-6** ✅ `server/utils/digital-mode-migration.js:26` — sync `fs.appendFileSync` before promise resolution.

## Fix log

### Batch 1 — D-P0-1 + D-M4 (2026-07-27) ✅

- Added `isFilmPipelineSource(sourceType)` (NULL-tolerant, mirrors `buildSourceTypeClause` film branch) to `packages/shared/photographyMode.js` + `.mjs` mirror + both barrel exports.
- Guards (HTTP 409 `{error:'source_type_mismatch', message, sourceType, photoId}`) added to: `filmlab.js` /preview /render /export; `photos.js` render-positive; `edge-detection.js` detect-edges + apply-edge-detection (409 `{success:false,...}` shape there).
- Review follow-ups: `photos.js` export-positive / update-positive / ingest-positive upgraded from `roll_id == null` proxy to the same explicit guard (status 400→409 contract change; no client/watch/mobile code special-cased the old error string — verified by grep). `photos.getByRollSimple` prepared stmt gained `source_type` column.
- Intentionally unguarded: `batch-detect-edges` (read-only batch shape), `/rolls/:id/apply-edge-detection-to-all` (rolls intrinsically film-only). `render-service.js` JOIN-based implicit protection noted (W3, informational).
- Tests: new `server/routes/__tests__/filmlab.source-type-guard.test.js` (12 tests, all pass); photos/export/photos-soft-delete/bucket-e-preservation suites pass; eslint clean.

### Batch 2 — D-P1-4 + D-M2 (2026-07-27) ✅

- `getDigitalPhotoRecord` + three more queries (`albums.photos`, `photos.listDigital` prepared stmts; inline `albums.js` sort=date_taken) — `ds.deleted_at IS NULL` placed in the LEFT JOIN **ON clause** (masks session metadata, keeps photo accessible — audit-prescribed semantics; DELETE session keeps photos). First pass wrongly used WHERE (hid the photo entirely); @review caught it, corrected.
- `GET /:id/photos` — 404 gate via `digitalSessions.getById` (deleted_at-filtered) before the photos query; header comment updated; photos query JOIN also gained the ON-clause guard as defense-in-depth (review nit).
- Tests: new `server/routes/__tests__/digital-sessions.test.js` (4 tests); `digital-develop-service.test.js` gained ON-placement regex + negative WHERE assertion + behavioral contract test. Full server suite 139/139 pass; eslint clean.

### Batch 3 — D-M1 (2026-07-27) ✅

- `photo-tools.js`: `search_photos`, `get_photo_detail`, `get_photo_neighbors` handlers accept `context = {}` 2nd arg; `buildSourceTypeClause(context.mode, alias)` injected into WHERE (clause='' for all/undefined/unknown mode → no filtering, backward compatible). Neighbors applies the clause to all 3 query sites (target + before + after) so film sessions can't anchor on / neighbor into digital photos.
- `ai-orchestrator.js:341,357`: both `tool.handler(toolArgs)` call sites now pass `{ mode: photographyMode }`.
- Review follow-ups: W1 — clause `params` now destructured and spread at the correct placeholder positions (future-proof; routes pattern). W2 — `'get_roll_photos'` added to `FILM_ONLY_TOOL_KEYS` (hidden from digital-mode schemas; still invocable directly, same as other film-only tools).
- Deferred from review (out of D-M1 scope, noted): W3 stats-tools photo aggregations have no mode filter; W4 write photo-tools (update/batch/rating/favorite/delete) have no source_type gate (stale-ID defense-in-depth).
- Tests: new `server/services/__tests__/ai-tools-photo-mode-filter.test.js` (19 tests: film/digital/all/undefined modes × 3 handlers + param-order invariance + schema visibility of get_roll_photos). Full server suite 158/158 pass; eslint clean.

### Batch 4 — D-M3 (2026-07-27) ✅

- `processOne` returns `{id, relPaths}`; `rollbackPartial` now unlinks the 3 files/photo (display/thumb/original, per-file best-effort) then hard-DELETEs the photos row (safe: cancel runs before album-join; `album_photos` FK is CASCADE; `albums.cover_photo_id`/`photo_tags` never written by import flow — JSDoc states this accurately).
- Cancel branch also soft-deletes the ghost session (`UPDATE digital_sessions SET deleted_at ... AND deleted_at IS NULL`, idempotent).
- Review follow-up: `processOne` now self-cleans on mid-processing failure (hoisted abs paths, catch → unlink 3 files + DELETE row + rethrow) — closes the pre-existing per-file-failure orphan leak in the same class.
- Tests: 3 new cases in `digital-import-service.test.js` (mid-batch cancel with unlink-path + count assertions, cancel-before-any, processOne-failure self-cleanup with continuation). Full server suite 161/161 pass; eslint clean.

### Batch 5 — D-P1-1 (2026-07-27) ✅

- `raw-decoder.js`: new sync `isAvailableSync()` (module-load-resolved `activeDecoder !== null`), named export.
- `serverCapabilities.{js,mjs}`: new `setDigitalAvailabilityProbe(fn|null)` (dependency injection — keeps `packages/shared` server-free); `getCapabilities()` computes `digital = computeEnabled && (probe ? !!probe() : true)` with try/catch → false. `server.js:22-26` registers `() => require('./services/raw-decoder').isAvailableSync()` at startup (all entry points — server.js/Electron/Docker — run the same file; registered before listener starts).
- Review follow-ups: W1 — client `ComputeService.js` now captures `digital` from `/api/discover` (`?? true` default). W2 — `setDigitalAvailabilityProbe` added to both barrels (`index.js` object + `index.mjs` object + per-name export). N1 — simplified redundant `digital` init. W3 (`.mjs` dead probe variable) noted, accepted (ESM consumers never register; behavior correct).
- Tests: new `packages/shared/__tests__/serverCapabilities.test.js` (6 tests: probe false/true/none/throws, NAS short-circuit, unregister). Phase-B routing contract suite passes; full jest run 1163/1163; eslint clean.

### Batch 6 — D-P1-2 + D-P1-3 (2026-07-27) ✅

- `AppModeContext.tsx`: context value now `{mode, setMode, hydrated}`. Read failure → `console.warn('[AppMode] Failed to load persisted mode:', err)` (default 'film' kept); write failure → `console.warn('[AppMode] Failed to persist mode:', err)`; dead `.finally` removed.
- `hydrated`: false initially → true after first read settles (success AND failure paths, `cancelled`-guarded); resets false→true on baseUrl change; `!baseUrl` → true immediately. No provider render gate (flag exposed only; 8 consumers untouched, all destructure mode/setMode only — backward compatible).
- Review: no Critical. W1 (hydration read can clobber a setMode issued mid-read) accepted as pre-existing (window = single getItem latency; fix neither introduced nor widened it). W2/N1 no action (test mock leak analysis confirmed clean).
- Tests: `app-mode.test.tsx` 15/15 (4 new: hydrated false→true, read-failure warn+hydrated, write-failure warn, baseUrl-change re-hydrate). `tsc --noEmit` clean.

### Batch 7 — D-P1-5 + D-P2-3 + D-P2-5 + D-P2-6 (2026-07-27) ✅

- **D-P1-5**: `20260801_digital_mode` → `20260701_digital_mode` in `docs/digital-mode-design/03-data-model-and-migration.md` (1×) + `08-implementation-plan-data.md` (2×). Grep-verified zero remaining.
- **D-P2-3**: `normalizeParams(paramsJson, photoId)` — optional id param; catch now `console.warn('[DigitalDevelop] photoId=… failed to parse …', err.message)`; still returns `{}`. `err.message` confirmed non-leaking (SyntaxError position info only).
- **D-P2-5**: `normalizeMode` unknown → 'all' unchanged (API compat), but one-time-per-distinct-value `console.warn` (server-side only, `typeof window === 'undefined'` gate). Review Critical: unbounded de-dupe Set = DoS via distinct `?mode=` values → **capped at 500** (`MAX_WARNED_VALUES`); beyond cap, silent 'all'. Mirrored in `.mjs`.
- **D-P2-6**: migration `log()` wraps `appendFileSync` in try/catch → fallback `console.warn` + `console.log` (original line always visible); never throws. Exported as `_log` for tests.
- Tests: new `packages/shared/__tests__/photographyMode.test.js` (13 cases incl. cap test), new `server/utils/__tests__/digital-mode-migration.test.js` (3 cases), +4 cases in `digital-develop-service.test.js`. 43/43 across the 3 suites; eslint clean.

### Batch 8 — D-P2-8 (2026-07-27) ✅

- New `tests/29-digital-desktop-contracts.test.js` — 26 source-contract tests covering the full desktop digital surface: LibraryView (digital fetch + empty-state CTA), DigitalDevelop (API imports, param schema, WB temp/tint contract, preview blob lifecycle, save/export handlers, unmount cleanup, presets category), DigitalImportWizard (execute payload shape, formats, numeric-step state machine), AlbumLibrary/AlbumDetail (query keys, sort toggle, mutations), ImageViewer (`isDigital` gating, DigitalDevelop routing + props, `sourcePath` = `positive_rel_path` + buildUploadUrl + addCacheKey), PhotoDetailsSidebar (Digital Source section gating, albums query enablement), Statistics (`workspace` branch, `modeQs` on summary/gear, spending branch), App.jsx (`MODE_KEY`, ROUTE_KEYS, digital route tree, cross-file MODE_KEY consistency with Onboarding + GeneralSettings).
- Followed the project's established convention (tests/24-phaseQ-ui.test.js): fs.readFileSync + tolerant regex/substring contract assertions in node env — no jsdom/RTL stack introduced. Header documents the convention and defers behavioral render tests.
- Review: no Critical. W1 (STEPS label tautology → numeric-step structural assertions), W2 (MODE_KEY cross-file drift → new 3-file consistency test), W3/W4/W5 (unbounded `[\s\S]*?` regexes → bounded indexOf extractions), N1 (header wording), N2/N3 (missing contracts: ImageViewer sourcePath, Statistics modeQs) — all addressed. Spot-checked the two most fragile bounds (`triggerPreview` single definition site; `stats-digital-cameras` single queryKey) — sound.
- 26/26 pass; full root suite 794/794; eslint clean.

### Batch 9 — D-P2-1/2 + D-P2-4 + D-P2-7 (2026-07-27) ✅

- `digital-mode-migration.js`: `albums.is_smart`/`smart_rule_json` and `photos.stack_id`/`stack_role` commented as RESERVED (unused by any code path); camera-vs-lens `is_digital` binary-vs-three-state asymmetry documented at the camera column definition. NULL-universal lens handling verified already implemented in `equipment-service.js:393-403` + `equipment.js:171-172` — no code change needed.
- `docs/digital-mode-design/06-mobile-and-phasing.md`: mobile digital-develop gap recorded as a known limitation (desktop-only surface).

### Batch 10 — D-P3-3 + D-P3-6 (2026-07-27) ✅

- **D-P3-3**: `Statistics({ workspace = 'film', view = 'stats' })` replaces the overloaded `mode` prop ('stats'/'spending'/'film'/'digital' → two clean axes). All 3 call sites (App.jsx routes only) updated: film /stats → `workspace="film"`, /spending → `workspace="film" view="spending"`, digital /stats → `workspace="digital"`. Contract tests updated to lock the new signature (regex requires literal `view`/`workspace` tokens — old prop fails).
- **D-P3-6**: Onboarding no longer probes `getRolls()` (film-only coupling). Now: `/api/health` liveness probe (loading → hold modal; error → fail-open, matching pre-change behavior) + `/api/stats/summary` mode-agnostic existing-data signal (`total_rolls + total_photos + total_digital_photos > 0`). Fixes the audit case: film user who deleted all rolls but still has photos now correctly sees the upgrade gate.
- Review: no Critical. W1 (health probe fail-closed on transient error — a regression vs the old fail-open rolls probe) fixed: `healthError` removed from the early-return + non-OK status now throws so the fail-open path is well-defined. W2 (silent markCompleted/handleChoice failure dismisses modal) accepted as pre-existing (identical `catch {}` + dismiss pattern predates this change). N1/N2 (hardcoded `?mode=film` in activity query, JSDoc precision) accepted — pre-existing, behavior-correct.
- Tests: 27/27 contract tests pass; full root suite 798/798; eslint clean.

### Batch 11 — D-P3-1 + D-P3-2 + D-P3-4 (2026-07-27) ✅

- **D-P3-1**: `getPhotoWithRoll` renamed to `getPhotoForExport` (its real role: photo + metadata for EXIF/export build; roll fields NULL for digital via LEFT JOIN — JSDoc states this). Sites: download-service.js (def + internal call + export), digital-develop-service.js (import + call), test mocks. Grep: zero remaining refs outside docs/.
- **D-P3-2**: film-branch NULL-tolerance asymmetry commented in `buildSourceTypeClause` (.js + .mjs): NULL source_type = un-migrated legacy film photos (film branch must include); digital rows always explicitly stamped (digital branch strict).
- **D-P3-4**: `library_mode@${baseUrl}` orphaning documented at the key-construction site in AppModeContext.tsx (audit option b: accept; baseUrl change resets to 'film', self-heals on re-toggle).
- Tests: digital-develop-service / photographyMode / ai-tools suites 59/59 pass; eslint clean; mobile `tsc --noEmit` clean.

### D-P3-7 — Commit baseline confirmed (2026-07-27) ✅

HEAD = `37672d3 chore(release): bump version to 4.0.7` on `main`; no stashes. All digital-mode implementation work AND all audit fixes above remain uncommitted in the working tree — the audit's "all changes uncommitted" baseline claim still holds. Nothing committed by the remediation process.
