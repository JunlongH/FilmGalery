# 08 — Recommendations

Prioritized remediation plan. Each item lists: severity, scope, files
to touch, suggested test, and an estimate (S = <1h, M =半天, L = multi-day).

---

## P0 — Must fix before any release that advertises film/digital isolation

### R-P0-1 — Guard filmlab endpoints against digital photo ids

**Severity**: Critical (D-P0-1)
**Scope**: server
**Estimate**: S

**Files to edit**

- `server/routes/filmlab.js` — three handlers (`/preview` line ~32,
  `/render` line ~131, `/export` line ~261). Change each photo lookup
  SQL from:
  ```sql
  WHERE id = ?
  ```
  to:
  ```sql
  WHERE id = ? AND (source_type = 'film' OR source_type IS NULL)
  ```
  Return `409` (or `422`) with `{ error: 'source_type_mismatch',
  message: 'This endpoint only accepts film photos; use
  /api/digital-develop/* for digital.' }` when the lookup returns
  nothing.

**Test to add**

- `server/routes/__tests__/filmlab.source-type-guard.test.js` (new):
  for each of `/preview`, `/render`, `/export`, seed a digital photo,
  post its id, assert 4xx and the error shape. Three cases × the
  negative + one positive (film id → 200).

**Regression check**

- The desktop `ImageViewer` already dispatches by `source_type`, so no
  client change is needed. The fix is purely server-side defense.

---

## P1 — Fix in the next iteration

### R-P1-1 — Reflect actual digital compute capability in `/api/discover`

**Severity**: High (D-P1-1)
**Scope**: server + minor mobile
**Estimate**: S

**Files to edit**

- `packages/shared/serverCapabilities.js` — `getCapabilities()`:
  probe `raw-decoder.isAvailable()` (memoize at first call) and AND it
  into `capabilities.digital`. Optionally also probe
  `exiftool-vendored` availability.
- `server/services/raw-decoder.js` — add a sync `isAvailableSync()`
  variant (or expose the memoized result of the existing async
  `isAvailable()`).

**Test to add**

- `packages/shared/__tests__/serverCapabilities.test.js`:
  mock `raw-decoder.isAvailableSync` to return false; assert
  `getCapabilities().capabilities.digital === false`.

### R-P1-2 — Stop swallowing AsyncStorage errors silently

**Severity**: High (D-P1-2)
**Scope**: mobile
**Estimate**: S

**Files to edit**

- `mobile/src/context/AppModeContext.tsx` — `.catch((e) => { console.warn(...);
  /* optionally surface via snack */ })`.

**Test to add**

- Extend `mobile/__tests__/app-mode.test.tsx`: mock
  `AsyncStorage.getItem` to reject; assert mode stays `'film'` and a
  warning is logged (spy on `console.warn`).

### R-P1-3 — Hydrate mobile mode before first paint

**Severity**: High (D-P1-3)
**Scope**: mobile
**Estimate**: M

**Files to edit**

- `mobile/src/context/AppModeContext.tsx` — add `hydrated: boolean` to
  context; set it in the `.then()`. Consumers (notably
  `HomeScreen` / timeline dispatch) gate first meaningful paint on
  `hydrated`.

**Test to add**

- Assert that during the pre-hydration frame, no `/api/photos` call is
  fired (mock `api.http.get`, assert not-called before hydration
  completes).

### R-P1-4 — Exclude soft-deleted sessions from `getDigitalPhotoRecord`

**Severity**: High (D-P1-4)
**Scope**: server
**Estimate**: S

**Files to edit**

- `server/services/digital-develop-service.js:43` — change JOIN to:
  ```sql
  LEFT JOIN digital_sessions ds
    ON p.session_id = ds.id AND ds.deleted_at IS NULL
  ```

**Test to add**

- Extend `server/services/__tests__/digital-develop-service.test.js`:
  seed a photo + session, soft-delete the session, call
  `getDigitalPhotoRecord(photoId)`, assert `session_label` is null.

### R-M1 — Filter AI photo-tools by active workspace mode

**Severity**: Medium (D-M1, found by review)
**Scope**: server
**Estimate**: S

**Files to edit**

- `server/services/ai-tools/index.js` — thread `mode` into
  `getToolHandler(name, { mode })` and `TOOLS[name].handler(args, { mode })`.
- `server/services/ai-tools/photo-tools.js:39, 90` — prepend
  `buildSourceTypeClause(mode).clause` to the WHERE; merge params.
  Update the tool `description` to be mode-neutral or mode-aware.
- `server/services/ai-orchestrator.js` — pass `app_config.photography_mode`
  (already read at line 242) into `getToolHandler`.

**Test to add**

- `server/services/ai-tools/__tests__/photo-tools.test.js` — seed film
  + digital photos; call `search_photos.handler({}, { mode: 'digital' })`;
  assert only digital photos returned.

### R-M2 — Filter deleted sessions from `GET /api/digital-sessions/:id/photos`

**Severity**: Medium (D-M2, found by review)
**Scope**: server
**Estimate**: S

**Files to edit**

- `server/routes/digital-sessions.js:42-49` — either:
  - (option 1) add `AND ds.deleted_at IS NULL` to the JOIN, OR
  - (option 2) prepend a 404 gate:
    ```js
    const exists = await getAsync('SELECT 1 FROM digital_sessions WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!exists) return res.status(404).json({ error: 'Session not found' });
    ```

Recommend option 2 (matches the PUT handler's behavior).

**Test to add**

- Extend `server/routes/__tests__/digital-sessions.test.js` —
  soft-delete session, GET photos, assert 404 (option 2) or null
  label (option 1).

### R-M3 — Clean up orphan files in `rollbackPartial`

**Severity**: Medium (D-M3, found by review)
**Scope**: server
**Estimate**: S

**Files to edit**

- `server/services/digital-import-service.js:301` — change `processOne`
  to return `{ id: photoId, relPaths }` (it already computes `relPaths`
  at line 266).
- `server/services/digital-import-service.js:441-449` — extend
  `rollbackPartial` to unlink each path in `r.relPaths` before the
  soft-delete UPDATE. Or switch to `DELETE FROM photos WHERE id = ?`
  (the row was never visible outside this cancelled job).

**Test to add**

- Extend `server/services/__tests__/digital-import-service.test.js`:
  cancel after N photos processed; assert their display/thumb/original
  files are gone from disk (use `fsp.access` and expect ENOENT).

### R-P1-5 — Resolve migration id drift

**Severity**: High (D-P1-5, documentation)
**Scope**: docs
**Estimate**: S

**Files to edit**

- `docs/digital-mode-design/03-data-model-and-migration.md` line ~200
- `docs/digital-mode-design/08-implementation-plan-data.md` lines ~213, ~220

Change `20260801_digital_mode` → `20260701_digital_mode` (or add a
clarifying note).

---

## P2 — Address when touching the surrounding code

### R-P2-1 / R-P2-2 — Decide on smart albums + stacking

**Severity**: Medium
**Scope**: schema + product
**Estimate**: decision required, then S (drop) or L (implement)

The `albums.is_smart` + `smart_rule_json` and `photos.stack_id` +
`stack_role` columns exist but are unused. Options:

- **Drop** them in a new migration (forward-only; column drop is
  destructive but the columns are unused).
- **Document** them as reserved-for-future in the schema doc and add a
  `// reserved, not yet implemented` comment in the migration.
- **Implement** the feature (large).

Recommend: document + comment now; decide on implementation later.

### R-P2-3 — Surface `normalizeParams` JSON parse failures

**Severity**: Medium
**Scope**: server
**Estimate**: S

- `server/services/digital-develop-service.js:101` — replace the silent
  `catch` with a `console.warn` including photoId + first 200 chars of
  the blob. Optionally re-throw a typed error and have the route
  return 422 so the client can prompt "edits unreadable, reset?".

### R-P2-4 — Document the lens `is_digital` three-state semantics

**Severity**: Medium
**Scope**: docs + UI verification
**Estimate**: S

- Add a comment block to the migration explaining the camera (binary)
  vs lens (three-state NULL/0/1) asymmetry and why (lenses can be
  "universal"; cameras cannot).
- Audit `EquipmentSelector.jsx` and `equipment-service.js` to confirm
  the UI handles NULL correctly (treats as "universal" = visible in
  both workspaces).

### R-P2-5 — Tighten `normalizeMode` failure behavior

**Severity**: Medium
**Scope**: shared
**Estimate**: S

Options (pick one):

- Default to `'film'` instead of `'all'` (smallest change; preserves
  film-first legacy behavior).
- Add a strict-validation middleware that 400s on unrecognized `mode`
  values at the route level, leaving `normalizeMode` for internal
  defaulting.

Recommend the middleware approach — it's the most defensible.

### R-P2-6 — Make migration `log()` non-fatal

**Severity**: Medium
**Scope**: server (and same pattern in other migrations)
**Estimate**: S

- `server/utils/digital-mode-migration.js:23-28` — wrap
  `fs.appendFileSync(...)` in `try { ... } catch (_) {}`. Fall through
  to `console.log` regardless.
- Consider writing migration logs to `os.tmpdir()` instead of next to
  the DB (where the directory may be read-only on NAS mounts).

### R-P2-7 — Acknowledge mobile develop gap

**Severity**: Medium (parity)
**Scope**: docs
**Estimate**: S

- Add a release-notes / known-limitations entry: "mobile does not
  support digital develop / color grading; use desktop for editing."
- If implement: scope a follow-up epic. Reuse
  `packages/@filmgallery/api-client/digital-develop.js` (already
  exists) + port `client/src/components/FilmLab/` primitives to a
  shared package.

### R-P2-8 — Add desktop component tests

**Severity**: Medium
**Scope**: client
**Estimate**: M

Priority files:
- `client/src/components/digital/__tests__/DigitalDevelop.test.jsx`
- `client/src/components/__tests__/ImageViewer.dispatch.test.jsx`

Mirror mobile's `__tests__/digital/PhotoViewDigital.test.tsx` pattern.

---

## P3 — Backlog / opportunistic

### R-M4 — Add source_type guard to `render-positive` and `edge-detection`

**Severity**: Low (D-M4, found by review)
**Scope**: server
**Estimate**: S

- `server/routes/photos.js:1160` — change lookup to
  `WHERE id = ? AND (source_type = 'film' OR source_type IS NULL)`.
- `server/routes/edge-detection.js:51` — same.
- Read-only endpoints, so this is consistency hardening rather than
  data-loss prevention. Pair with R-P0-1 in the same PR.

### R-P3-1 — Rename `getPhotoWithRoll` for clarity

Cosmetic. Either rename to `getPhotoForExport` or add a
`getPhotoForDigitalExport` wrapper in `digital-develop-service.js`.

### R-P3-2 — Document the NULL-tolerance asymmetry in `buildSourceTypeClause`

Add a one-line comment explaining "NULL tolerated only on film branch;
integrity check #1 makes this dead in practice; kept as defense in
depth."

### R-P3-3 — Split `Statistics` mode prop into `workspace` + `view`

Small refactor. Touches `Statistics.jsx` + the two call sites in
`App.jsx` (`FilmRoutes` / `DigitalRoutes` pass `mode="film|digital"`;
`FilmRoutes` also has `mode="spending"`).

### R-P3-4 — Decide on `library_mode@baseUrl` orphaning

Accept as known behavior, or implement a single canonical key +
per-server override. Recommend accept-and-document for now.

### R-P3-5 — No separate fix (covered by R-P0-1)

### R-P3-6 — Decouple onboarding probe from `/api/rolls`

Probe a more reliable signal (`app_config.onboarding_completed`,
or `COUNT(photos WHERE source_type='film')`).

### R-P3-7 — Confirm "uncommitted changes" baseline

Verify with the team whether the digital-mode branch is still
intentionally uncommitted (per prior review doc) or has since been
committed. Update the audit baseline accordingly.

---

## Sequencing

Suggested order, assuming a single engineer with half-weeks:

1. **R-P0-1** (S) — ship-blocking; do first, with the negative test.
   Pair with **R-M4** (S, found by review) since it's the same shape
   for `render-positive` and `edge-detection`.
2. **R-P1-4, R-M1, R-M2, R-M3** (S+S+S+S, all review-found or
   review-confirmed) — bundle into one "server hardening" PR. Small,
   isolated, low-risk, and they close the four most material gaps the
   review surfaced.
3. **R-P1-5** (S, docs only) — fold into the same PR or do separately.
4. **R-P1-1** (S) — capability reflection; small but needs the sync
   `isAvailableSync` variant on `raw-decoder.js`. Standalone PR.
5. **R-P1-2, R-P1-3** (S+M) — mobile state hardening; pair with
   `app-mode.test.tsx` extensions.
6. **R-P2-3, R-P2-5, R-P2-6** (S+S+S) — server-hardening PR.
7. **R-P2-1/2 decision** (S) — product call, then act.
8. **R-P2-8** (M) — desktop test backfill.
9. **R-P2-7** (S docs, L if implementing) — depends on product
   priority. If proceeding, evaluate **R-ARCH-1** below first — it
   changes the scope of any mobile develop work.
10. **R-P3-*** — opportunistic, fold into nearby PRs.

Total: ~4-5 engineer-days for P0+P1+P2-hardening including the
review-merged items, plus ongoing P3.

---

## Architecture recommendation (added after user follow-up)

### R-ARCH-1 — Unify FilmLab and DigitalDevelop on the desktop

**Severity**: Medium (architectural) — see `10-develop-ui-unification-analysis.md` for the full analysis
**Scope**: client
**Estimate**: M (Option A) / L (Option C)

The user asked: *"能否直接复用 FilmLab 的前端和界面，只做一些 digital
的对应性的改动"* — *"Can we directly reuse FilmLab's frontend and
UI, with only digital-specific changes?"*

**Short answer: yes, and it's recommended.** `DigitalDevelop.jsx`
(707 LOC) already imports all the FilmLab sub-panels
(`SliderControl`, `HSLPanel`, `ToneCurveEditor`, `SplitToningPanel`,
`LutSelectorModal`). It is effectively a thinner re-implementation of
the FilmLab wrapper, missing:

- Canvas-based preview with live histogram (uses plain `<img>`)
- `PhotoSwitcher` (multi-photo editing within a roll/session)
- Picker tools (eyedropper for WB, base correction, curve points)
- Ratio lock, AutoLevels, AutoCrop
- WebGL acceleration path
- Roll-preset workflow (digital only has user presets)

**Recommended path: Option A** — add a `mode: 'film'|'digital'` prop
to `FilmLab.jsx`. When `mode === 'digital'`:

1. Hide film-only sections (inversion, film curve, base correction,
   density levels, RGB gains).
2. Force `inverted=false`, `filmCurveEnabled=false` in the params sent
   to server (matches what `digital-develop-service.normalizeParams`
   already does server-side — belt-and-suspenders).
3. Switch API endpoints to `developPreview`/`developSave`/`developExport`.
4. Use `category: 'digital'` for the preset picker.

Then delete `DigitalDevelop.jsx`. Net LOC change: roughly **-500**
(remove 707, add ~200 conditional branches across FilmLab.jsx /
FilmLabControls.jsx).

**Server-side opportunity** (R-ARCH-2, larger): unify
`/api/filmlab/*` and `/api/digital-develop/*` into a single
`/api/develop/*` that dispatches by `source_type`. This would close
D-P0-1 by construction and eliminate the asymmetric parameter
storage (`develop_params_json` JSON blob vs embedded-in-row). Not
required for Option A — FilmLab can keep its mode-aware endpoint
switch — but worth scoping if a larger refactor is on the table.

See `10-develop-ui-unification-analysis.md` for the full comparison
table and migration plan.
