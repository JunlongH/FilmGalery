# 06 — Cross-Cutting and Parity Matrix

## 1. Desktop ↔ Mobile ↔ Server Parity

| Capability | Desktop | Mobile | Server |
|------------|---------|--------|--------|
| Workspace toggle (film/digital) | ✓ (button, ⌘⇧M, onboarding, settings) | ✓ (settings, implicit) | `app_config.photography_mode` (preference only) |
| Per-server persistence | global (`localStorage`) | per-server (`library_mode@${baseUrl}`) | n/a (single server) |
| Photo listing with mode filter | ✓ (`?mode=digital`) | ✓ | ✓ `buildSourceTypeClause` |
| Import wizard | ✓ multi-step `DigitalImportWizard.jsx` | ✓ `DigitalImportScreen.tsx` | ✓ `/api/digital/import/{preview,execute,progress,cancel,check-hash}` |
| Albums (CRUD + sort + nested) | ✓ full | list + detail only | ✓ full endpoints |
| Develop / color grading | ✓ `DigitalDevelop.jsx` (sliders/HSL/curves/split/LUT/crop/export) | ✗ none | ✓ `/api/digital-develop/{preview,save,export,params}` |
| EXIF view | ✓ in sidebar | ✓ in sheet | ✓ parsed by `exiftool-vendored` on import |
| EXIF attach on export | ✓ (server-side via `attachExifToJpegBuffer`) | ✓ (same server path) | ✓ |
| Add to album from viewer | ✓ (modal) | ✓ (sheet) | ✓ `/api/albums/:id/photos` |
| Favorite / like | ✓ (heart 0↔1) | ✓ (heart 0↔1) | ✓ `rating` column 0/1 for digital |
| Soft delete + restore | ✓ (with confirm dialog) | ✓ (delete action) | ✓ `DELETE` soft + `POST /:id/restore` + `?hard=true` |
| RAW decode | n/a (client requests server render) | n/a | ✓ `libraw` via `raw-decoder.js` |
| Map filtering by mode | ✓ (`mode` prop) | ✓ (`useAppMode`) | ✓ `/api/photos/geo?mode=` |
| Calendar / LifeLog filtering | ✓ (`mode` prop) | n/a (mobile uses timeline) | ✓ mode-aware queries |
| Statistics per mode | ✓ (workspace + spending view) | n/a | ✓ `/api/stats/digital/*` + mode filter on `/api/stats/*` |
| Tags per mode | ✓ (`['tags', mode]` query key) | n/a | ✓ `/api/tags?mode=` (counts + cover + photos) |
| Capability discovery | consumes `/api/discover` | consumes `/api/discover` (D-P1-1) | hard-codes `digital: true` (D-P1-1) |

### 1.1 Notable asymmetries

1. **Develop UI** — desktop has full panel, mobile has none (D-P2-7).
   Documented as intentional phasing.
2. **Album sort + nested** — desktop full (drag-sort, parent/child,
   recycle bin), mobile list + detail only. Acceptable for mobile's
   simpler scope.
3. **Per-server mode persistence** — mobile keys `library_mode@baseUrl`
   per server; desktop is global. Mobile's model is more correct (a
   user with multiple servers may want different default per server);
   desktop's is simpler. Not a defect.
4. **Filmlab vs digital-develop source guarding** — digital is
   guarded server-side (`source_type='digital'`); filmlab is not
   (D-P0-1). This is the only material parity defect on the server.

---

## 2. The Workspace ↔ Source_Type Concept Boundary

Two concepts both called "mode":

| Concept | Granularity | Owner | Persisted where | Drives |
|---------|-------------|-------|-----------------|-------|
| **Workspace mode** | global per client | UI toggle | client storage + `app_config` | listing `?mode=` filter, which routes/components mount |
| **Photo source_type** | per row | import / DB column | `photos.source_type` | which develop pipeline opens; FK shape (roll vs session) |

The two are **independent**: a user can be in the film workspace and
click into a digital photo's detail (if one somehow appears in a list).
The `ImageViewer` dispatches purely on `source_type`, not on workspace
mode — correct behavior.

**Subtle consequence**: a "pure" film workspace (mode=film) will never
show a digital photo in its listings (because `?mode=film` filters
them out), so the cross-type dispatch in `ImageViewer` is unreachable
in normal flow. But the `ImageViewer` accepts any `images[]` array, so
if a future feature (search, album detail that mixes types) passes a
mixed array, the dispatch handles it correctly. This is defense in
depth and is correct.

---

## 3. Migration Sequencing

The four digital-related migrations run in dependency order:

```
20240101_core_schema           ← creates photos / rolls / etc.
20241001_equipment_tables      ← creates equip_cameras / equip_lenses
20241101_film_structure        ← film metadata
20260701_digital_mode          ← adds source_type + digital tables + backfill
20260726_relax_photos_roll_id  ← drops roll_id NOT NULL (digital has NULL roll)
20260726_normalize_photo_path_separators  ← Windows path cleanup
20260726_digital_rating_like_only         ← collapse 2-5 → 1 for digital
```

Order is correct. The `20260701` migration depends on `equip_cameras`
existing (for its FK in `digital_sessions.camera_id`) — satisfied by
`20241001`. The `20260726_relax_photos_roll_id` must run after
`20260701_digital_mode` (which introduces digital photos with NULL
roll) — satisfied.

**One concern**: if a future migration adds a column that the
digital-develop service reads unconditionally (e.g. a new EXIF field),
the migration must run before any request that hits that code path.
Current startup sequence (`server.js` runs migrations before listening)
is correct; just worth knowing for future migrations.

---

## 4. Soft-Delete Audit Cross-Check

The prior W3-C review wave audited missing `deleted_at IS NULL` filters
and patched:
- `photos.listByRoll`
- `rolls.countPhotos`
- `/api/photos/favorites`
- `/api/photos/geo` (query + count)
- `photos.checkHash`

This audit found **one additional missing filter**:

- `getDigitalPhotoRecord` (D-P1-4) — the photo's `deleted_at` is
  filtered, but the LEFT JOINed `digital_sessions.deleted_at` is not.

No other soft-delete leaks were found in the digital code paths
inspected (digital-import, digital-develop, digital-sessions routes
all filter correctly).

---

## 5. Test Coverage Distribution

| Layer | Files | Coverage shape |
|-------|-------|----------------|
| Server migrations | `__tests__/run-all-migrations.test.js` | asserts registration only (not behavior) |
| Server routes | `routes/__tests__/{digital-import,digital-develop,albums,mode-filter,photos-facets,photos-soft-delete}.test.js` | positive contracts + key negative (legacy `{files}` → 400) |
| Server services | `services/__tests__/digital-{import,develop}-service.test.js` | unit-level, 15+ examples each |
| Smoke tests | `smoke-test-{part3,endpoints}.js`, `utils/smoke-test-digital-mode.js` | end-to-end HTTP |
| Integrity | `scripts/digital-integrity-check.js` | 7 invariants, exit-code gated |
| Mobile | `__tests__/digital/{PhotoViewDigital,DigitalAlbumDetail,albums-integration}.test.tsx` | component render + interaction |
| Desktop | (none) | D-P2-8 |

**Negative-contract gap** (cross-cutting): the existing tests assert
*the right call works*, but almost none assert *the wrong call is
rejected*. Specific gaps:
- no test that `/api/filmlab/preview` rejects a digital photo id (D-P0-1);
- no test that `/api/discover` reflects actual capability status (D-P1-1);
- no test that `getDigitalPhotoRecord` excludes deleted sessions (D-P1-4);
- no test that `normalizeMode` behaves predictably on unknown input
  (D-P2-5 — current behavior is "returns 'all'", which is tested
  implicitly but not as a contract).

A round of negative-contract tests would have caught all four P0/P1
server findings.
