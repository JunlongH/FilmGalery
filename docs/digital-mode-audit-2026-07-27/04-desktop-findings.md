# 04 — Desktop Findings

Desktop digital-mode surface: `client/src/App.jsx` (workspace switch),
`client/src/components/digital/**` (digital-only screens),
`client/src/components/{ImageViewer,PhotoDetailsSidebar,Statistics,...}`
(shared screens with mode-aware behavior),
`client/src/api/digital-*.js` (fetch wrappers).

---

## Architecture summary (verified)

- **State**: `useState(() => localStorage.getItem(MODE_KEY) || 'film')`
  in `App.jsx:104`. Single source of truth at the `LayoutInner` level.
- **Toggle surfaces** (all converge on the same state):
  1. `Sidebar` toggle button → `onToggleMode` → `toggleMode()` (App.jsx:127)
  2. `Ctrl/Cmd+Shift+M` global shortcut (App.jsx:154) — typing-guarded
  3. `Onboarding.jsx` three-card picker → dispatches `WORKSPACE_EVENT`
  4. `Settings/GeneralSettings.jsx` default-workspace picker → same event
- **Route memory**: `localStorage['fg-last-route-{film,digital}']`
  preserves the last route per workspace; restored on toggle.
- **Route split**: `<FilmRoutes>` vs `<DigitalRoutes>` (App.jsx:55-98),
  completely separate trees. Shared views (`CalendarView`, `MapPage`,
  `Favorites`, `TagGallery`, `Statistics`) are reused with a `mode`
  prop.
- **Tags query** is keyed by `['tags', mode]` so each workspace has its
  own count (mode-scoped via `/api/tags?mode=`).

This is a clean design. The findings below are scoped gaps, not
architecture problems.

---

## D-P2-8 — No desktop Jest tests for digital components

**Location**: `client/src/**` — no `__tests__/` for `DigitalOverview`,
`DigitalImportWizard`, `DigitalDevelop`, `LibraryView`,
`AlbumLibrary`, `AlbumDetail`, or the digital branches of
`ImageViewer` / `PhotoDetailsSidebar`.

The server has 6 new test files (`digital-import.test.js`,
`digital-develop.test.js`, `albums.test.js`, `mode-filter.test.js`,
`photos-facets.test.js`, `photos-soft-delete.test.js`). Mobile has
`__tests__/digital/*`. Desktop has none.

**Coverage gap**: the desktop digital UI contract (blob preview, crop
handle mapping, LUT serialization, lazy-load dispatch in `ImageViewer`)
is verified only manually. The W2-R and W3-R review waves caught
three Critical UI bugs (LUT Float32Array serialization, crop handle
coordinate mapping, `normalizeParams` mutation) — all of which would
have been caught by a render-and-assert test.

**Fix**: introduce at minimum
- `client/src/components/digital/__tests__/DigitalDevelop.test.jsx` —
  render with mock `developPreview`, simulate slider drag, assert
  payload shape;
- `client/src/components/__tests__/ImageViewer.dispatch.test.jsx` —
  pass `source_type='digital'` photo, assert `DigitalDevelop` lazy-mounts
  and FilmLab does not.

This is the same pattern mobile uses (`__tests__/digital/PhotoViewDigital.test.tsx`).

---

## D-P3-3 — `Statistics` `mode` prop overloaded

**Location**: `client/src/components/Statistics.jsx`

The component accepts `mode: 'film' | 'digital' | 'spending'` —
conflating workspace mode with view selector. The implementation
branches on both interpretations:

```js
const workspace = mode === 'digital' ? 'digital' : 'film';
// ...vs...
if (mode === 'spending') { ... }
```

Works today, but couples two unrelated concepts through one prop. A
future addition (`mode="activity"`, `mode="gear"`) will compound the
overload.

**Fix**: split into two props: `workspace: 'film'|'digital'` and
`view: 'overview'|'spending'`. Small refactor; the W2-B review wave
noted this and chose to defer.

---

## D-P3-6 — Onboarding probe `/api/rolls` couples digital-first to film existence

**Location**: `client/src/components/Onboarding.jsx`

The first-run probe calls `/api/rolls`:
- non-empty → show "upgrade gate" modal (existing film user → warn about
  digital mode);
- empty or fail → show three-card first-run picker (Film / Digital /
  Both).

A digital-first user with no film rolls (the exact target audience for
"digital mode") always lands in the three-card flow, which is correct
for them. But a long-time film user who has deleted all rolls (or whose
rolls query fails) also lands there, skipping the upgrade gate.

**Impact**: minor UX surprise. Not a correctness bug.

**Fix options**:
- probe a more reliable signal (e.g. `SELECT COUNT(*) FROM photos WHERE
  source_type='film'` via a dedicated endpoint), or
- gate the upgrade modal on `app_config.onboarding_completed` instead
  of rolls existence.

---

## Verified-correct desktop behaviors (no action)

- **`ImageViewer.jsx` dispatch** — `isDigital = img?.source_type ===
  'digital'` correctly lazy-loads `DigitalDevelop` (not FilmLab) for
  digital photos. Keyboard shortcuts (`f` favorite, `Delete`) are
  digital-gated. The `availableSources` memo does not gate on digital
  vs film, but that's correct: a digital photo may still have RAW
  original vs JPEG positive, and the FilmLab source selector is only
  shown for non-digital photos.
- **Route memory** — `ROUTE_KEYS[mode]` correctly persists per-workspace
  last route; `getRememberedRoute` falls back to `'/'` on storage error.
- **Sidebar shortcuts** — `⌘1`–`⌘0` for digital workspace navigation
  (W2-B); `Ctrl+Shift+M` global toggle.
- **`DigitalDevelop.jsx` preview lifecycle** — generation counter +
  `AbortController` (W1-R) correctly cancels stale preview renders;
  `URL.createObjectURL` is revoked on unmount and before each new
  preview (10s delayed revoke on export to ensure download completes).
- **`normalizeParams` defensive copy** — `{ ...paramsJson }` prevents
  the W2-R mutation bug (crop loss after save).
- **`LibraryView.jsx` batch operations** — chunked 5-concurrent to
  avoid connection pool exhaustion; `resetPages` on batch success
  prevents total drift.
