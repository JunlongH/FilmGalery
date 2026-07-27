# 05 — Mobile Findings

Mobile digital-mode surface: `mobile/src/context/AppModeContext.tsx`
(state), `mobile/App.tsx` (route registration), `mobile/src/screens/`
(timeline / library / import / viewing), `mobile/src/components/digital/`
(reusable bits), `mobile/__tests__/digital/*` (test coverage).

---

## Architecture summary (verified)

- **State**: `AppModeContext` provides `{ mode, setMode }` via React
  context. Persisted per-server to `AsyncStorage['library_mode@' +
  baseUrl]`. Default `'film'`.
- **Single navigator**: unlike desktop's route-tree split, mobile keeps
  one navigator and branches inside screens via `useAppMode()` (App.tsx
  registers `DigitalAlbumDetail` + `DigitalImport` routes that are
  always present but typically only reachable from the digital
  timeline).
- **Photo viewer**: `PhotoViewScreen.tsx` is a single shared screen
  (film + digital); `isDigital` gates UI elements, not navigation.
- **No develop panel**: mobile has no equivalent of desktop's
  `DigitalDevelop.jsx` — photo editing for digital is view + metadata +
  album actions only.

---

## D-P1-2 — `AppModeContext` silently defaults to `'film'` on storage read failure

**Location**: `mobile/src/context/AppModeContext.tsx:21-34`

```tsx
useEffect(() => {
  if (!baseUrl) return;
  let cancelled = false;
  AsyncStorage.getItem(`library_mode@${baseUrl}`)
    .then((saved) => {
      if (cancelled) return;
      setModeState(saved === 'digital' ? 'digital' : 'film');
    })
    .catch(() => {})              // ← swallowed, leaves initial 'film'
    .finally(() => {});
  return () => { cancelled = true; };
}, [baseUrl]);
```

If `AsyncStorage.getItem` rejects (rare but possible — storage quota,
OS-level keychain lockout, platform bug), the catch swallows the error
and the user is left in the default `'film'` mode with no indication
their saved digital preference was lost.

**Impact**: a digital-workspace user opening the app sees a film
timeline instead, with no error surface. They may believe their photos
are gone (they're not — just filtered out). Re-toggling via Settings
restores the preference, but the silent failure is the problem.

**Fix**

```tsx
.catch((e) => {
  console.warn('[AppModeContext] failed to load saved mode:', e?.message ?? e);
  // optionally surface via a snack/banner
})
```

A unit test (`mobile/__tests__/app-mode.test.tsx` already exists —
extend it) should mock `AsyncStorage.getItem` to reject and assert the
mode remains `'film'` **and** a warning is logged.

---

## D-P1-3 — Initial `useState('film')` causes one-frame flash + wasted queries

**Location**: `mobile/src/context/AppModeContext.tsx:19`

```tsx
const [mode, setModeState] = useState<AppMode>('film');
```

The initial render uses `'film'` synchronously, then the `useEffect`
fires and asynchronously may flip to `'digital'`. Consumers reading
`mode` during the first frame issue film queries (`/api/photos?mode=film`)
that are then invalidated when the real mode loads.

**Impact**: not a correctness bug — queries get re-issued correctly —
but:
- one wasted network request per cold start when the user is actually
  digital;
- a visible flash: film timeline → digital timeline;
- on slow networks, the film timeline may render with real data before
  the flip, briefly showing film photos to a digital user.

**Fix options**:
- (a) Add an explicit `hydrated` flag; render a splash / `null` until
  hydration completes:
  ```tsx
  const [mode, setModeState] = useState<AppMode>('film');
  const [hydrated, setHydrated] = useState(false);
  // in .then(): setHydrated(true);
  // expose hydrated in context; consumers gate first-paint on it
  ```
- (b) Move the AsyncStorage read to a synchronous bootstrap (e.g.
  `useQuickStorage` sync variant) before React renders — not available
  in stock AsyncStorage.

(a) is the standard pattern; small change.

---

## D-P2-7 — No digital develop / color-grading capability on mobile

**Location**: `mobile/src/screens/viewing/PhotoViewScreen.tsx`

The mobile photo viewer supports:
- view (positive / negative toggle for film only — hidden for digital)
- tags / notes edit
- EXIF sheet (digital only)
- album chips + add-to-album (digital only)
- favorite (digital)
- delete (digital)
- download

It does **not** support:
- exposure / contrast / highlights / shadows / whites / blacks sliders
- temperature / tint (white balance)
- HSL / curves / split-toning / LUT
- crop / rotation / export-with-edits

All of which exist on desktop (`DigitalDevelop.jsx`, 707 LOC).

**Status**: documented as intentional phasing in
`docs/digital-mode-design/06-mobile-and-phasing.md`. Not a defect.
Logged here as a parity gap that should be **acknowledged** in any
release notes — a user editing on desktop and then opening the same
photo on mobile will see only the rendered result, not the edit UI.

**Action**: none beyond documentation. If develop-on-mobile becomes a
priority, the path is:
1. Port `packages/@filmgallery/api-client/digital-develop.js` (already
   exists for fetch wrappers).
2. Build a mobile `DigitalDevelopSheet` reusing the slider/HSL/curve
   primitives from a shared package (currently they're desktop-only
   JSX in `client/src/components/FilmLab/`).
3. Add `develop_params_json` round-trip via the existing
   `/api/digital-develop/{preview,save}` endpoints.

---

## D-P3-4 — `library_mode@${baseUrl}` orphans on URL change

**Location**: `mobile/src/context/AppModeContext.tsx:24, 39`

The AsyncStorage key is `library_mode@${baseUrl}`. If `baseUrl` changes
(http → https migration, port change, server rename), the saved mode
under the old key is orphaned and the user silently resets to `'film'`.

**Impact**: rare; one-time per URL migration. Self-heals on re-toggle.

**Fix options**:
- (a) Maintain a `library_mode@${baseUrl}` → `library_mode` migration
  helper that scans for keys with the old prefix and copies the most
  recent value. Brittle.
- (b) Accept the orphan; document it.
- (c) Store under a single canonical `library_mode` key plus a separate
  `library_mode_server@${baseUrl}` override. More flexible.

(c) is the cleanest but is a larger refactor. (b) is acceptable for
now — log it as known behavior.

---

## Verified-correct mobile behaviors (no action)

- **`PhotoViewScreen.tsx` digital gating** — `isDigital = photo?.source_type
  === 'digital'` correctly hides negative-toggle and shows EXIF/album
  actions. Download path uses `getPhotoUrl(baseUrl, p, 'full')` which
  works for both film and digital.
- **`DigitalTimelineScreen.tsx` pagination** — uses
  `pagesMap`-keyed query cache with subscription pattern; `hasMore`
  detection handles both array and `{data, hasMore}` response shapes
  defensively.
- **`DigitalAlbumDetailScreen.tsx` mutation** — sets
  `source_type:'digital'` on optimistic updates, matching server truth.
- **`MapScreen.tsx`** — consumes `useAppMode()` to filter pins (W2-B
  ported the desktop mode prop pattern).
- **Test coverage** — `mobile/__tests__/digital/` has
  `PhotoViewDigital.test.tsx`, `DigitalAlbumDetail.test.tsx`,
  `albums-integration.test.tsx` — broader than desktop's (which is
  zero).
