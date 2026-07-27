# 02 — Architecture and Data Flow

## 1. The Two-Mode Model

Digital mode is not one concept but **two independent ones**, both called
"mode" in the code. Confusing them is the root of several findings.

### 1.1 Workspace mode (UI-level, global)

A per-client toggle that decides which top-level navigation tree to show
and which `?mode=` query parameter to send to listing endpoints.

| Platform | Store | Key | Default |
|----------|------|-----|---------|
| Desktop | `localStorage` | `fg-workspace-mode` | `'film'` |
| Mobile | `AsyncStorage` | `library_mode@${baseUrl}` (per-server) | `'film'` |
| Server | `app_config` singleton | `photography_mode` / `default_source_filter` | `'all'` |

The server's `app_config` is read by the AI orchestrator for context but
**does not drive filtering** of photo lists — the client always sends an
explicit `?mode=`. This is correct (the server's notion of mode is a
preference, not a constraint), but it means a stale `app_config` cannot
cause data leakage on its own.

### 1.2 Per-photo source_type (DB-level, per-row)

A column on every `photos` row: `'film'` or `'digital'`. Decides:

- which develop pipeline opens (FilmLab vs DigitalDevelop)
- which foreign keys are expected (`roll_id` for film; `session_id` for
  digital)
- which listing endpoints return the row when filtered by `mode`

The two concepts meet at the listing endpoints: `?mode=film` resolves to
`WHERE p.source_type = 'film' OR p.source_type IS NULL` (NULL tolerated
for un-migrated rows). A photo with `source_type='digital'` is invisible
to a film workspace, and vice versa.

### 1.3 The shared helper

`packages/shared/photographyMode.js` (111 LOC) is the canonical source of
truth:

```
PHOTO_MODES = { FILM:'film', DIGITAL:'digital', ALL:'all' }
normalizeMode(mode)                              // unknown → 'all'
sourceTypeFilter(mode)                           // → ['film'] | ['digital'] | ['film','digital']
buildSourceTypeClause(mode, columnAlias='p.source_type')
                                                 // → { clause, params }
```

`buildSourceTypeClause` is the only function that emits SQL fragments, and
it validates `columnAlias` against `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`
(injection guard). Every route that filters by mode should call this
helper rather than hand-rolling SQL — and the audit confirms this is
consistently followed.

---

## 2. Data Flow — Desktop

```
User action
  ├─ Sidebar toggle button          ─┐
  ├─ Ctrl/Cmd+Shift+M shortcut       ├─→ App.jsx toggleMode()
  ├─ Onboarding card                 │     └─→ localStorage['fg-workspace-mode'] = next
  └─ Settings/GeneralSettings picker ─┘         + dispatch 'fg-set-workspace-mode' event
                                                 + navigate(getRememberedRoute(next))
                                                          │
App.jsx state: mode = 'film' | 'digital'         ◄────────┘
  │
  ├─ <FilmRoutes> vs <DigitalRoutes>  ─→ separate route trees (App.jsx:55-98)
  │                                       each route gets a `mode` prop
  │
  ├─ tags query: useQuery(['tags', mode], () => getTags(mode))  ── per-workspace tag counts
  │
  └─ page components receive `mode`, pass to fetchers
        │
        ▼
  fetchers append ?mode=digital to /api/photos, /api/photos/facets,
                                  /api/photos/favorites, /api/photos/geo,
                                  /api/tags, /api/stats/*
        │
        ▼
  server routes call buildSourceTypeClause(mode) → SQL WHERE
```

### 2.1 Photo-level dispatch (desktop)

```
User clicks a photo
  │
  ▼
ImageViewer.jsx (img.source_type from row data)
  │
  ├─ source_type === 'digital'
  │     → lazy-load DigitalDevelop
  │     → POST /api/digital-develop/preview { photo_id, params_json }
  │     → service: getDigitalPhotoRecord  WHERE source_type='digital'  ✓ guarded
  │     → normalizeParams: forces inverted=false, filmCurveEnabled=false
  │     → buildPipeline (toneAndCurvesInJs, skipColorOps)
  │     → renderBuffer (Float32 pipeline)
  │
  └─ otherwise
        → FilmLab (inline import)
        → POST /api/filmlab/preview { photoId, params }
        → route: SELECT ... WHERE id = ?          ✗ NOT source-guarded (D-P0-1)
        → getEffectiveInverted(...) — may apply film inversion
        → RenderCore.processPixelFloat
```

---

## 3. Data Flow — Mobile

```
SettingsScreen / implicit navigation
  │
  ▼
AppModeContext.setMode(next)
  ├─ setModeState(next)                         ─→ React re-render
  └─ AsyncStorage.setItem('library_mode@'+baseUrl, next)
        │
        ▼
AppModeProvider exposes { mode, setMode } via context
  │
  ├─ HomeScreen → DigitalTimelineScreen vs FilmTimelineScreen
  ├─ MapScreen → filters pins by mode
  ├─ screens call api.http.get('/api/photos', { mode, ... })
  └─ server path identical to desktop (same /api/photos?mode=digital)
```

### 3.1 Photo-level dispatch (mobile)

`PhotoViewScreen.tsx` is a **single shared screen** for film and digital.
`isDigital = photo?.source_type === 'digital'` gates:

- Hide negative-toggle button (digital has no negative)
- Show EXIF sheet + album chips + add-to-album action
- Enable delete action

There is **no develop / color-grading UI on mobile** for digital photos
(D-P2-7). The screen is view + metadata + album actions only.

---

## 4. Pipeline — How Digital Deviates from Film

Both pipelines funnel through `buildPipeline` + `renderBuffer` (Float32)
for CPU/GPU parity. The digital-specific differences:

| Aspect | Film (filmlab) | Digital (digital-develop) |
|--------|----------------|---------------------------|
| Source SELECT | `WHERE id = ?` *(unguarded — D-P0-1)* | `WHERE id = ? AND source_type='digital' AND deleted_at IS NULL` |
| JOIN | `rolls` (inner assumptions) | `digital_sessions` LEFT join *(no `ds.deleted_at` filter — D-P1-4)* |
| `inverted` | Resolved via `getEffectiveInverted()` (may be true for negatives) | Forced `false` in `normalizeParams` |
| `filmCurveEnabled` | True (film-log curve for scanned negatives) | Forced `false` |
| Rating | 0–5 stars (UI shows heart 0↔1 in practice) | 0/1 like-only (legacy 2–5 collapsed by migration `20260726_digital_rating_like_only`) |
| EXIF on export | `buildExifData(photo, filmData, ...)` includes film stock info | `buildExifData(photo, null, {})` — film block skipped |

The `normalizeParams` forcing of `inverted=false` + `filmCurveEnabled=false`
is the **correct** design: it guarantees that even if a malicious or buggy
client sends `inverted: true`, the server ignores it for digital. The
asymmetry with filmlab (which has no equivalent guard against digital
photo ids) is exactly D-P0-1.

---

## 5. Schema Surface

The `20260701_digital_mode` migration adds:

- **4 tables**: `app_config` (singleton), `digital_sessions`, `albums`,
  `album_photos` (junction)
- **12 columns on `photos`**: `source_type`, `session_id`, `content_hash`,
  `deleted_at`, `media_type`, `stack_id`, `stack_role`, `white_balance`,
  `color_space`, `original_filename`, `develop_params_json`, `scene_id`
- **7 columns on `equip_cameras`**: `is_digital`, `sensor_type`,
  `sensor_width_mm`, `sensor_height_mm`, `megapixels`, `crop_factor`,
  `sensor_format`
- **1 column on `equip_lenses`**: `is_digital` (three-state)
- **5 columns on `app_config`** (added after initial release):
  `onboarding_completed`, `default_source_filter`, `show_film_section`,
  `show_digital_section`, `digital_enabled`
- **13 indexes**
- **Backfill**: `UPDATE photos SET source_type='film' WHERE source_type IS NULL`
- **Seed**: `INSERT OR IGNORE INTO app_config (id, photography_mode) VALUES (1, 'all')`

Follow-up migrations:

- `20260726_relax_photos_roll_id` — drops `NOT NULL` on `photos.roll_id`
  so digital photos (NULL roll) can be inserted on legacy DBs.
- `20260726_normalize_photo_path_separators` — fixes Windows backslash
  paths in early digital imports.
- `20260726_digital_rating_like_only` — collapses legacy 2–5 digital
  ratings to 1 (digital dropped stars for like-only).

### 5.1 Unused / dormant columns

- `albums.is_smart` + `albums.smart_rule_json` — smart albums not
  implemented (D-P2-1).
- `photos.stack_id` + `photos.stack_role` — stacking not implemented
  (D-P2-2).

These are not harmful, but they advertise features that do not exist.

---

## 6. Capability Discovery

`/api/discover` returns a capability object that both clients consult:

```js
// packages/shared/serverCapabilities.js
return {
  mode,                                   // 'standalone' | 'nas' | 'dev'
  capabilities: { data:true, compute, storage:true, digital: true },  // ← hard-coded
  endpoints: { data: DATA_ROUTES, compute: computeEnabled ? COMPUTE_ROUTES : [] },
  limits: { maxUploadSize, batchLimit }
};
```

`compute` correctly reflects `SERVER_MODE !== 'nas'`, but `digital` is
hard-coded `true` regardless of whether the digital compute stack
(libraw for RAW decode, exiftool-vendored for EXIF) is actually
installed. This is D-P1-1.

The mobile `SettingsScreen.tsx` shows a "digital enabled" card iff
`capabilities.digital` is true; the desktop `Onboarding.jsx` uses
`/api/rolls` non-empty as its upgrade-gate signal instead (separate
heuristic — D-P3-6).
