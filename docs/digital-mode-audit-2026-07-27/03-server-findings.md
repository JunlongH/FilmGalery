# 03 — Server Findings

Server-side digital-mode surface area spans:
`routes/`, `services/`, `utils/` (migrations + prepared statements),
`scripts/` (integrity check), and the shared `packages/shared/photographyMode.js`.

---

## D-P0-1 — CRITICAL — Filmlab pipeline has no `source_type` guard

**Location**: `server/routes/filmlab.js`
Affected endpoints: `/api/filmlab/preview` (line 32), `/api/filmlab/render`
(line 131), `/api/filmlab/export` (line 261).

**Evidence** — every photo lookup in filmlab is:

```js
db.get('SELECT id, roll_id, ... FROM photos WHERE id = ?', [photoId], ...)
```

No `source_type` predicate. Contrast with the digital pipeline, which is
correctly guarded:

```js
// server/services/digital-develop-service.js:44
WHERE p.id = ? AND p.source_type = 'digital' AND p.deleted_at IS NULL
```

**Concrete failure modes**

1. **Preview** — a client posts a digital photo's id to
   `/api/filmlab/preview`. The film RenderCore runs with
   `getEffectiveInverted(...)` which may invert the image. Result: a
   digital positive gets rendered as a film negative. No persistent
   damage, but the user sees a corrupted preview.

2. **Render** (line 204-247) — far worse:
   ```js
   const newName = `${rollIdRender}_${frameNumRender}.jpg`;  // roll_id is NULL for digital!
   await sharp(out, ...).jpeg({quality:95}).toFile(outPath);
   // then:
   db.run('UPDATE photos SET positive_rel_path = ?, full_rel_path = ?, ... WHERE id = ?')
   ```
   For a digital photo, `roll_id` is NULL and `frame_number` may be NULL,
   so the output filename becomes `null_null.jpg` (or similar) and the
   digital photo's `positive_rel_path` is **overwritten** with a
   film-pipeline render. The user's digital edit is destroyed and the
   thumb is regenerated from the wrong buffer.

3. **Export** — same as preview, just at full resolution.

**Likelihood** — moderate. The desktop `ImageViewer.jsx` correctly
dispatches by `source_type`, so a well-behaved client will never send a
digital id to filmlab. But:
- nothing on the server enforces this contract;
- a buggy client (or a third-party API caller, or a future refactor)
  can violate it silently;
- the `/api/filmlab/render` damage is irreversible without a backup.

**Prior art** — the design checklist
(`docs/digital-mode-design/11-implementation-checklist.md`) reportedly
noted "filmlab should add a `source_type='film'` guard" as a known gap,
but the prior W1/W2/W3 review wave did not implement it.

**Fix**

In every filmlab photo lookup, change the SQL to:
```sql
WHERE id = ? AND (source_type = 'film' OR source_type IS NULL)
```
The NULL tolerance mirrors `buildSourceTypeClause`'s film branch (defense
against un-migrated rows). Add a regression test in
`server/routes/__tests__/filmlab.test.js` (new file or extend existing)
that posts a digital photo id to each filmlab endpoint and asserts 4xx
with `{ error: 'source_type_mismatch' }` or similar.

**Severity rationale**: P0 because (a) `/render` causes irreversible
data loss, (b) the contract is unenforced anywhere except the desktop
client, (c) the fix is trivial.

---

## D-P1-1 — `/api/discover` advertises `digital: true` unconditionally

**Location**: `packages/shared/serverCapabilities.js:101`

```js
capabilities: { data:true, compute: computeEnabled, storage:true, digital: true }
```

`compute` is correctly derived from `SERVER_MODE`, but `digital` is
hard-coded. The digital compute stack depends on optional native deps:
- `libraw` (via `services/raw-decoder.js`) for RAW demosaic
- `exiftool-vendored` for EXIF parsing

If either is missing (common on minimal NAS containers, CI environments,
or fresh clones without the right native build), digital import/develop
silently degrades to "no RAW support" / "no EXIF". The mobile
`SettingsScreen.tsx` and any future capability-gated UI still see
`digital: true` and offer the feature.

**Fix**

```js
function getCapabilities() {
  const computeEnabled = isComputeEnabled();
  let digitalComputeAvailable = false;
  try {
    // cheap probe — does not actually decode, just checks the native binding
    digitalComputeAvailable = require('../services/raw-decoder').isAvailableSync?.() ?? false;
  } catch { /* leave false */ }
  return {
    capabilities: {
      data: true, compute: computeEnabled, storage: true,
      digital: computeEnabled && digitalComputeAvailable,
    },
    ...
  };
}
```

Note: `raw-decoder.isAvailable()` is currently async (returns a Promise);
either add a sync variant or memoize the probe at startup and read it
here. The probe cost is negligible (one native module require).

---

## D-P1-4 — `getDigitalPhotoRecord` LEFT JOIN does not filter deleted sessions

**Location**: `server/services/digital-develop-service.js:39-47`

```js
async function getDigitalPhotoRecord(photoId) {
  return getAsync(
    `SELECT p.*, ds.label AS session_label, ds.import_batch
     FROM photos p
     LEFT JOIN digital_sessions ds ON p.session_id = ds.id
     WHERE p.id = ? AND p.source_type = 'digital' AND p.deleted_at IS NULL`,
    [photoId]
  );
}
```

The photo's own `deleted_at` is filtered, but the joined session's
`deleted_at` is not. A soft-deleted session (e.g. an admin removed a
batch from the sessions UI but the photos were kept) still contributes
its `label` and `import_batch` to the photo record.

This is **inconsistent** with the soft-delete model used everywhere else
(W3-C added `deleted_at IS NULL` filters across the listing endpoints;
the digital develop path was apparently not audited).

**Impact**: low-severity data leak — the develop panel would show a
label that the user expects to be gone. No correctness impact on the
render itself.

**Fix**

```sql
LEFT JOIN digital_sessions ds
  ON p.session_id = ds.id AND ds.deleted_at IS NULL
```

---

## D-P1-5 — Migration id drift between code and design docs

**Code** (`server/utils/run-all-migrations.js:28`):
```
'20260701_digital_mode'
```

**Design docs**:
- `docs/digital-mode-design/03-data-model-and-migration.md:200` — references `20260801_digital_mode`
- `docs/digital-mode-design/08-implementation-plan-data.md:213,220` — same

The migration shipped under `20260701_*` (July) but the docs say
`20260801_*` (August). This misleads:
- maintainers searching the codebase for the doc-referenced id;
- any external automation (CI gate, migration-status dashboard) keyed
  off the documented id;
- the `_migrations` tracker — if someone "fixes" the code to match the
  doc, the migration will re-run on every DB that already ran it under
  the real id (idempotent, so no damage, but confusing).

**Fix**: update the two doc references to `20260701_digital_mode`. (Or,
less invasively, add a one-line note in each doc: *"registered as
`20260701_digital_mode`"*.)

---

## D-P2-3 — `normalizeParams` silently swallows JSON parse errors

**Location**: `server/services/digital-develop-service.js:96-104`

```js
function normalizeParams(paramsJson) {
  let params = {};
  if (paramsJson) {
    try {
      params = typeof paramsJson === 'string' ? JSON.parse(paramsJson) : { ...paramsJson };
    } catch (_) {
      params = {};          // ← silent
    }
  }
  ...
}
```

If a saved `develop_params_json` blob is corrupted (truncated UTF-8,
encoding mishap, schema change), `normalizeParams` returns `{}`, the
photo renders with defaults, and the user is **not told** their saved
edits are unreadable. Worse: if the user then hits Save, the empty
params overwrite the corrupted blob — the original edits are gone.

**Fix options** (pick one):
- (a) Re-throw with a typed error (`InvalidDevelopParamsError`) and have
  the route return 422; the client shows an "edits unreadable, reset?"
  dialog.
- (b) Log a warning with the photoId + first 200 chars of the blob, but
  still render with defaults (graceful degradation).

(a) is safer for not destroying data; (b) is less invasive.

---

## D-P2-5 — `normalizeMode` defaults unknown → `'all'`

**Location**: `packages/shared/photographyMode.js:28-34`

```js
function normalizeMode(mode) {
  if (typeof mode === 'string') {
    const lower = mode.toLowerCase();
    if (VALID_MODES.has(lower)) return lower;
  }
  return PHOTO_MODES.ALL;        // ← 'all'
}
```

Defensive, but the failure mode is surprising for a workspace system
that promises film/digital isolation: `?mode=digitaal` (typo) returns
both film **and** digital photos. A film workspace that accidentally
sends a typo will suddenly show digital photos mixed in.

**Fix options**:
- (a) Default to `'film'` (legacy behavior, safer for film-first users).
- (b) Default to empty clause but log a warning when an unrecognized
  mode hits a production endpoint.
- (c) Return 400 for unrecognized modes from a strict validation
  middleware, leaving `normalizeMode` for internal defaulting only.

(a) is the smallest behavior change; (c) is the most correct.

---

## D-P2-6 — Migration `log()` can crash startup on read-only DB directory

**Location**: `server/utils/digital-mode-migration.js:23-28`

```js
function log(msg) {
  const logPath = path.join(path.dirname(getDbPath()), 'digital-mode-migration.log');
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);     // ← sync, throws on EROFS / EACCES
  console.log(`[DIGITAL-MIGRATION] ${msg}`);
}
```

`log()` is called *before* the migration promise resolves (line 37:
"Starting digital-mode migration on: ..."). On a NAS deployment where
the DB directory is mounted read-only (or where the process lacks write
permission to that directory), `fs.appendFileSync` throws
synchronously. The migration rejects, and `runAllMigrations` aborts
startup.

This is the digital-mode contribution to a broader pattern — the
schema-migration.js has similar `log()` calls — but it's the one most
likely to bite because the digital migration is the newest.

**Fix**: wrap the `appendFileSync` in `try { ... } catch (_) {}` and
fall through to `console.log`. Or write the log to `os.tmpdir()` instead
of next to the DB.

---

## D-P3-1 — `attachExifToJpegBuffer` calls `getPhotoWithRoll` for digital photos

**Location**: `server/services/digital-develop-service.js:299`

```js
const photo = await getPhotoWithRoll(photoId);
```

The function name implies a rolls JOIN that digital photos don't have.
It works because the underlying query LEFT JOINs rolls (so digital
photos get null roll fields), but the call site is misleading.

**Fix**: either rename `getPhotoWithRoll` → `getPhotoForExport` (its
real role is "fetch photo + all metadata needed for EXIF build"), or
introduce a `getPhotoForDigitalExport` wrapper.

---

## D-P3-5 — `/api/filmlab/render` writes `{rollId}_{frameNum}.jpg`

**Location**: `server/routes/filmlab.js:208-210`

```js
const newName = `${rollIdRender}_${frameNumRender}.jpg`;
```

For a (mistakenly routed — see D-P0-1) digital photo, `roll_id` and
`frame_number` are NULL, so this produces `null_null.jpg` or
`undefined_00.jpg`. Latent only because D-P0-1 allows the wrong code
path. Once D-P0-1 is fixed, this becomes unreachable for digital ids;
no separate fix needed.

---

## Findings added by the independent @review pass

The four findings below were caught by the adversarial `@review` agent
(see `09-review-feedback-and-merge.md`) and verified against the
actual code during merge.

---

## D-M1 — AI photo-tools leak across mode boundary

**Severity**: Medium (P2) — found by review
**Location**: `server/services/ai-tools/photo-tools.js:39-48, 90-97`
and `server/services/ai-tools/index.js:40-55`

**Evidence**

```js
// photo-tools.js — search_photos (line 39)
let sql = `
  SELECT p.id, p.frame_number, p.caption, ...
  FROM photos p
  LEFT JOIN rolls r ON p.roll_id = r.id
  LEFT JOIN films f ON r.filmId = f.id
  WHERE 1=1
`;                                  // ← no source_type predicate
```

`get_photo_detail` (line 90-97) has the same shape. Both tools are in
the `PHOTO_TOOLS` registry. In `index.js:40-55`:

```js
const FILM_ONLY_TOOL_KEYS = new Set([
  ...Object.keys(ROLL_TOOLS),
  ...Object.keys(FILM_TOOLS),
  ...Object.keys(SHOT_LOG_TOOLS),
  ...Object.keys(RENDER_TOOLS),
]);

function getToolSchemas(mode) {
  if (mode === 'digital') {
    return allSchemas.filter(s => !FILM_ONLY_TOOL_KEYS.has(s.function.name));
  }
  return allSchemas;
}
```

`PHOTO_TOOLS` is **not** in `FILM_ONLY_TOOL_KEYS`, so it stays
available in digital mode. But the underlying SQL returns all photos
regardless of `source_type`. A user in the digital workspace asking
the AI "find my photos from Japan" receives film photos in the
results — a genuine cross-mode data leak through the AI chat
interface.

The tool's own description says "搜索用户的胶片照片" ("search user's
**film** photos") — the description is film-specific but the
implementation is mode-agnostic. This is a contract mismatch.

**Fix**

In `photo-tools.js`, accept a `mode` argument threaded through from
`getToolHandler(name, { mode })`, then prepend the appropriate
`buildSourceTypeClause(mode).clause` to the WHERE. Alternatively, make
the tools filter by the active workspace mode at the orchestrator
layer (where `app_config.photography_mode` is already read).

Also update the tool's `description` to be mode-neutral ("Search the
user's photos") or make the description itself mode-aware.

**Test to add**

- `server/services/ai-tools/__tests__/photo-tools.test.js`:
  seed film + digital photos; call `search_photos.handler({})` with
  mode='digital'; assert returned set contains only digital photos.

---

## D-M2 — Same `ds.deleted_at IS NULL` gap in `digital-sessions` route

**Severity**: Medium (P2) — found by review
**Location**: `server/routes/digital-sessions.js:40-49`

**Evidence**

```js
router.get('/:id/photos', async (req, res, next) => {
  try {
    const rows = await allAsync(
      `SELECT p.*, ds.label AS session_label
       FROM photos p
       LEFT JOIN digital_sessions ds ON p.session_id = ds.id
       WHERE p.session_id = ? AND p.deleted_at IS NULL
       ORDER BY p.date_taken ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});
```

Identical shape to D-P1-4. The session's `deleted_at` is not
filtered. If a session is soft-deleted but its photos are kept, this
endpoint still returns them — joined with the (now-deleted) session's
label.

**Calibration note** — this is a slightly different use case from
D-P1-4. Here the caller explicitly asks for "photos of session X". If
session X exists (even soft-deleted), returning its photos is
arguably correct. The cleaner behavior is to 404 when the session
itself is soft-deleted (matching `PUT /:id` at line 59-62, which does
`WHERE id = ? AND deleted_at IS NULL`). Either:

1. Filter the JOIN (consistent with D-P1-4 fix): `LEFT JOIN ...
   AND ds.deleted_at IS NULL`. The label goes NULL for
   soft-deleted sessions, photos still return.
2. Add a 404 gate: `SELECT 1 FROM digital_sessions WHERE id = ? AND
   deleted_at IS NULL` first; if not found, return 404.

(2) is the more user-correct option. (1) is the smaller diff.

**Test to add**

- Extend `server/routes/__tests__/digital-sessions.test.js`:
  seed session + photos, soft-delete the session, call
  `GET /:id/photos`, assert either 404 (option 2) or photos with
  null `session_label` (option 1).

---

## D-M3 — `rollbackPartial` leaves orphan files on disk

**Severity**: Medium (P2) — found by review
**Location**: `server/services/digital-import-service.js:224-302, 441-449`

**Evidence**

`processOne(item, sessionId)` writes **three files** before returning:

```js
// Line 281 — display JPEG
await oriented.clone().jpeg({ quality: 92 }).toFile(displayAbs);

// Line 286 — thumbnail JPEG
await oriented.clone()
  .resize({ width: 400, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 80 })
  .toFile(thumbAbs);

// Line 291 — original file copy
await fsp.copyFile(item.file.path, originalAbs);

return { id: photoId };
```

On cancellation, `execute` calls `rollbackPartial(photoRows)`:

```js
async function rollbackPartial(photoRows) {
  for (const r of photoRows) {
    try {
      await runAsync('UPDATE photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [r.id]);
    } catch (_) {
      // best-effort
    }
  }
}
```

The JSDoc says *"Soft-deletes inserted rows; file cleanup is
best-effort."* — but **there is no file cleanup at all**. The comment
is misleading. The 3 files per already-processed photo are orphaned
permanently (no sweeper touches them — the 1-hour tmp sweep at line
455 only handles multer's `item.file.path`, not the canonical
`displayAbs`/`thumbAbs`/`originalAbs`).

**Impact**

- Disk waste: each orphaned photo can be 5-50 MB (RAW originals) +
  ~1 MB display + ~50 KB thumb.
- Self-limiting per import: only files for photos that completed
  before the cancel point are orphaned (not the entire batch).
- No correctness impact — the soft-deleted rows are invisible to
  listings.

**Fix**

`processOne` needs to return the relPaths it wrote so `rollbackPartial`
can unlink them:

```js
return { id: photoId, relPaths };

async function rollbackPartial(photoRows) {
  for (const r of photoRows) {
    try {
      if (r.relPaths) {
        for (const rel of Object.values(r.relPaths)) {
          if (rel) await fsp.unlink(digitalFileService.toUploadAbsPath(rel)).catch(() => {});
        }
      }
      await runAsync('UPDATE photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [r.id]);
    } catch (_) { /* best-effort */ }
  }
}
```

(Or hard-delete instead of soft-delete — `DELETE FROM photos WHERE
id = ?` — since the row was never visible to anyone but this cancelled
job.)

**Test to add**

- Extend `server/services/__tests__/digital-import-service.test.js`:
  trigger cancellation after 2 photos processed (mock
  `jobRegistry.isCancelled` to return true on the 3rd iteration);
  assert the display/thumb/original files for the 2 processed photos
  are gone from disk.

---

## D-M4 — `render-positive` and `edge-detection` lack source_type guard

**Severity**: Low (P3) — found by review
**Location**: `server/routes/photos.js:1160`, `server/routes/edge-detection.js:51`

**Evidence**

Both handlers query the photo without filtering by `source_type`:

```js
// photos.js:1160 (render-positive)
const row = await getAsync('SELECT id, roll_id, original_rel_path, ... FROM photos WHERE id = ?', [id]);

// edge-detection.js:51
const photo = await getAsync('SELECT * FROM photos WHERE id = ?', [photoId]);
```

Both then call `getStrictSourcePath(photo, sourceType, {
allowFallbackWithinType: true, allowCrossTypeFallback: false })` —
which **does** correctly refuse cross-type file fallback. So the
damage is limited: a digital photo hitting `render-positive` cannot
have its paths crossed with film storage. But the underlying pipeline
(RenderCore with `inverted`/`filmCurveEnabled` from request body)
still runs the film pipeline on a digital photo's bytes, returning a
wrong-looking preview.

**Why P3, not P0**

Unlike `/api/filmlab/render`, `render-positive` is **read-only** —
it returns a buffer, does not update `positive_rel_path` or
regenerate thumbnails. No persistent damage. The contract is "given
a photo id and a source type, return a rendered buffer of that
source" — cross-type inputs produce ugly output but no data loss.

`edge-detection` is also read-only and is film-oriented (it tries to
detect film frame edges in a scan); for a digital photo the result
is meaningless but not harmful.

**Fix**

Same shape as R-P0-1: add `AND (source_type = 'film' OR source_type
IS NULL)` to the lookup. Pair with the same negative test. Worth
doing for consistency once the P0 fix lands, but not urgent.

---

## Server-side strengths (verified, no action)

- **`buildSourceTypeClause` injection guard** — `COLUMN_ALIAS_RE` regex
  is correct and tested.
- **Migration idempotency** — `IF NOT EXISTS` everywhere; the strict /
  resolve-with-error split for ALTER vs CREATE is well-reasoned and
  documented inline.
- **Post-backfill verification** (`SELECT COUNT(*) ... WHERE source_type
  IS NULL`) — migration aborts if backfill is incomplete, refusing to
  record success.
- **Integrity check script** (`scripts/digital-integrity-check.js`) —
  7 assertions covering the invariants; suitable for CI.
- **Two-phase import** — preview writes nothing; execute has
  pre-flight temp-file existence check, rollback-on-cancel,
  best-effort temp cleanup, and a fail-loud path when 0 photos
  imported.
