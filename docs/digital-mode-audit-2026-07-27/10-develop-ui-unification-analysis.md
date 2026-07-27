# 10 — Develop UI Unification Analysis

> User follow-up question: *"现在 digital 的图片编辑界面和 film 的
> filmlab 界面有区别，其中 filmlab 更成熟一些。能否直接复用 FilmLab
> 的前端和界面，只做一些 digital 的对应性的改动？"*
>
> *"The digital photo editing UI differs from film's FilmLab UI, and
> FilmLab is more mature. Can we directly reuse FilmLab's frontend and
> UI, making only digital-specific changes?"*

**Short answer: yes — and it's the recommended path.** This file lays
out the current duplication, the three unification options, and a
concrete migration plan for the recommended one.

---

## 1. Current state — what `DigitalDevelop.jsx` actually is

**File**: `client/src/components/digital/DigitalDevelop.jsx` — 707 LOC

It is **not** a parallel implementation of the FilmLab sub-panels. It
already imports and reuses them:

```jsx
import SliderControl    from '../FilmLab/SliderControl';
import HSLPanel         from '../FilmLab/HSLPanel';
import ToneCurveEditor from '../FilmLab/ToneCurveEditor';
import SplitToningPanel from '../FilmLab/SplitToningPanel';
import LutSelectorModal from '../FilmLab/LutSelectorModal';
```

What `DigitalDevelop` provides on top of those imports is a **thinner
wrapper** than `FilmLab.jsx`:

| Aspect | `FilmLab.jsx` (2862 LOC) | `DigitalDevelop.jsx` (707 LOC) |
|--------|--------------------------|--------------------------------|
| Preview surface | `<FilmLabCanvas>` (521 LOC) — canvas-based, WebGL-accelerated, live histogram | Plain `<img>` tag — no canvas, no histogram |
| Multi-photo editing | `<PhotoSwitcher>` — prev/next within roll | None (one photo at a time) |
| Picker tools | Eyedropper for WB / base correction / curve points | None |
| Crop overlay | Canvas-based, integrated with preview | DOM-based (`<div>` overlay, ~150 LOC at lines 239-345) — **duplicates** FilmLab's logic |
| Ratio lock | `ratioMode: 'free' \| 'original' \| '1:1' \| '3:2' \| '4:3' \| '16:9'` | 5 aspect presets (subset) |
| Inversion controls | Yes (linear/log modes) | Hidden — server forces `inverted=false` |
| Film curve controls | Yes (profile picker) | Hidden — server forces `filmCurveEnabled=false` |
| Base correction (film base/fog) | Yes (gains + log density) | N/A — film-only concept |
| Density levels | Yes (log-domain auto-levels) | N/A — film-only concept |
| RGB gains | Yes | N/A — covered by WB/temp/tint |
| AutoLevels / AutoCrop | Yes | None |
| Photo storage selection | `sourceType: 'original' \| 'negative' \| 'positive'` | N/A — digital has only `positive` |
| Preset category | `'film'` (roll-preset + user) | `'digital'` (user only) |
| Server endpoints | `smartFilmlabPreview` / `smartRenderPositive` / `smartExportPositive` | `developPreview` / `developSave` / `developExport` |
| Params storage | Embedded in photo row (per-column) | `develop_params_json` (JSON blob) |

**The duplication is real**: the crop drag math, the aspect-ratio
clamp, the section/collapse UI, the params state shape, the
debounce/AbortController preview lifecycle — all hand-copied from
FilmLab with film-only branches stripped out.

---

## 2. Why DigitalDevelop was built separately (the W2-R history)

Per `docs/digital-mode-design/DIGITAL-MODE-IMPLEMENTATION-REVIEW.md`
(W2-R review wave):

> *"DigitalDevelop reuses the FilmLab sub-panels but needs to force
> `inverted=false` and `filmCurveEnabled=false`. Rather than
> threading mode through FilmLab (risk of regressing the mature film
> flow), we built a parallel wrapper."*

This was the right call **at the time** — it shipped the digital
feature without risking the film flow. But the tradeoff has now
inverted:

- FilmLab continues to gain features (AutoCrop, picker tools, WebGL
  path, density levels) that digital users want but can't get without
  another copy.
- Every bug fix to the FilmLab crop math (the W2-R and W3-R fixes)
  has to be applied twice.
- The two wrappers have drifted: DigitalDevelop has its own preset
  save/apply flow that FilmLab's roll-preset system doesn't know
  about.

---

## 3. Three options

### Option A — Mode-aware FilmLab (recommended)

Add a `mode: 'film' | 'digital'` prop to `FilmLab.jsx` and
`FilmLabControls.jsx`. When `mode === 'digital'`:

1. **Hide** film-only UI sections: inversion, film curve, base
   correction, density levels, RGB gains, AutoLevels (film-only),
   `sourceType` selector.
2. **Force** `inverted=false`, `filmCurveEnabled=false` in the
   params built for the server request (matches what
   `digital-develop-service.normalizeParams` already does server-side
   — belt-and-suspenders).
3. **Switch** the API endpoints based on mode:
   ```jsx
   const api = mode === 'digital'
     ? { preview: developPreview, save: developSave, export: developExport }
     : { preview: smartFilmlabPreview, save: smartRenderPositive, export: smartExportPositive };
   ```
4. **Use** `category: 'digital'` for the preset picker when in
   digital mode.
5. **Delete** `client/src/components/digital/DigitalDevelop.jsx`.
6. **Update** `ImageViewer.jsx` (line ~442) to render `<FilmLab
   mode="digital" ...>` instead of lazy-loading `DigitalDevelop`.

**Net LOC change**: roughly **-500** (remove 707 from DigitalDevelop;
add ~200 conditional branches across FilmLab.jsx + FilmLabControls.jsx
+ the small API dispatch helper).

**Pros**:
- Smallest change that achieves the goal.
- Digital immediately inherits all FilmLab maturity: canvas preview,
  histograms, picker tools, AutoCrop, photo switcher (within session),
  WebGL path.
- Single source of truth for crop math, debounce logic, etc.
- Future FilmLab features (e.g. AI masks, RAW soft-proof) reach
  digital for free.

**Cons**:
- FilmLab.jsx grows ~7% (2862 → ~3050 LOC). Mitigate by extracting
  film-only blocks into `<FilmOnlySection mode={mode}>` wrapper
  components that early-return null.
- Slight risk of regressing film flow if conditional rendering is
  sloppy. Mitigate with the test backfill in R-P2-8.

**Estimate**: M (~2-3 days).

### Option B — Keep DigitalDevelop, port missing features

Pull canvas rendering, photo switcher, picker tools, AutoCrop into
DigitalDevelop. Keep both wrappers indefinitely.

**Pros**:
- Clean separation; digital UI stays minimal.

**Cons**:
- Continued duplication; every FilmLab crop/picker fix applied twice.
- Digital users still don't get features they actually want (live
  histogram is the most-requested).

**Estimate**: L (~5-7 days to port, plus ongoing sync cost).

### Option C — Extract shared `DevelopShell` component

Pull the common parts (canvas, basic controls, crop, presets,
debounce/abort lifecycle) into a new
`packages/shared/develop-shell/` component. FilmLab and DigitalDevelop
both become thin wrappers around it.

**Pros**:
- Cleanest architecture; mobile can eventually reuse the shell too.
- Forces the long-overdue extraction of FilmLab's monolith.

**Cons**:
- Largest refactor (~2-3 weeks).
- Risks destabilizing the mature film flow during extraction.
- Mobile can't consume the shell as-is (RN vs JSX), so the mobile
  reuse benefit is theoretical without a separate port.

**Estimate**: L (multi-week).

---

## 4. Recommendation: Option A

**Why**: it's the smallest change that delivers what the user asked
for, the tradeoff history now favors it, and it doesn't preclude
Option C later (the conditional branches introduced in Option A are
all extractable when Option C is eventually done).

**Why not Option B**: continued duplication is exactly what the user
is asking us to eliminate. Porting features piecemeal would take
longer than Option A while delivering less.

**Why not Option C (now)**: it's the right end-state but the wrong
next step. Doing it before Option A means designing the shared shell
without knowing which conditional branches actually pull weight in
practice. Option A reveals those branches in situ; Option C then
extracts them with empirical confidence.

---

## 5. Migration plan (Option A)

### Phase 1 — Server-side parity (optional, recommended)

Before touching the client, unify the server contract so the client
doesn't need an endpoint dispatch. This is **R-ARCH-2** in
`08-recommendations.md`.

- New route: `/api/develop/{preview,save,export,params}` that
  internally dispatches by `photo.source_type`:
  - film → existing filmlab-service pipeline
  - digital → existing digital-develop-service pipeline
- The route enforces the source-type guard (closes **D-P0-1** by
  construction).
- Old routes (`/api/filmlab/*`, `/api/digital-develop/*`) stay as
  thin aliases for one release, then deprecated.

This makes the client simpler (one endpoint set) **and** closes the
P0 server-side. Recommend doing this first.

If you'd rather not touch the server, skip to Phase 2 — the client
endpoint dispatch in Option A works fine without server unification.

### Phase 2 — Client refactor

1. Add `mode` prop to `FilmLab.jsx` (default `'film'` for backward
   compat).
2. Wrap film-only UI in `<FilmOnlySection>` components:
   ```jsx
   function FilmOnlySection({ mode, children }) {
     if (mode === 'digital') return null;
     return <>{children}</>;
   }
   ```
3. In the params-builder function (where FilmLab constructs the
   server request body), force `inverted=false` and
   `filmCurveEnabled=false` when `mode === 'digital'`.
4. Introduce the API dispatch object (see Option A step 3 above).
5. Update preset category based on `mode`.
6. Update `ImageViewer.jsx:442` to pass `mode="digital"` to `<FilmLab>`
   when `img.source_type === 'digital'`.
7. **Delete** `client/src/components/digital/DigitalDevelop.jsx`.
8. Delete `client/src/api/digital-develop.js` if Phase 1 server
   unification is done; otherwise keep as the implementation of the
   `digital` branch in the API dispatch.

### Phase 3 — Tests

- New: `client/src/components/FilmLab/__tests__/FilmLab.digital.test.jsx`
  — renders FilmLab with `mode="digital"`, asserts film-only sections
  are not in the DOM, asserts request body has `inverted=false`.
- Existing: `client/src/components/digital/__tests__/DigitalDevelop.test.jsx`
  (if R-P2-8 lands first) becomes obsolete — delete or convert to a
  FilmLab mode-digital test.

### Phase 4 — Mobile (out of scope for this refactor)

Mobile `PhotoViewScreen.tsx` does not have a develop panel today
(D-P2-7). The unification doesn't change mobile's status. If/when
mobile develop ships, it should consume the same `api/develop/*`
endpoint set from Phase 1, not a parallel one.

---

## 6. Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Regressing the mature film flow during the conditional-render refactor | Medium | Gate the new `mode` prop behind a default `'film'`; existing call sites see no behavior change. Run the existing film smoke tests + the W2-R regression scenarios (LUT serialization, crop handle mapping) before merge. |
| Server endpoint dispatch (Phase 1) introduces a new attack surface | Low | The unified route inherits the strictest guards of either predecessor: `source_type` enforcement from digital-develop + the existing filmlab input validation. Add the negative-contract test from R-P0-1 to the unified route. |
| Preset categories cross-contaminate (digital preset visible in film mode) | Low | Filter presets by `mode`/`category` in the preset loader; this is already done in `DigitalDevelop` (`listPresets('digital')`). |
| FilmLab.jsx grows too large to maintain | Low | The `<FilmOnlySection>` wrapper is a natural extraction point; if FilmLab.jsx exceeds ~3200 LOC after the merge, escalate to Option C and extract the shared shell. |

---

## 7. Decision matrix

| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| Eliminates duplication | ✓ | ✗ (continues it) | ✓ |
| Delivers user's ask | ✓ | partial | ✓ |
| Smallest change | ✓ | ✗ | ✗ |
| Inherits FilmLab features for digital | ✓ | partial (manual port) | ✓ |
| Doesn't preclude future Option C | ✓ | ✓ | n/a |
| Risk to film flow | low-medium | low | medium-high |
| Estimate | M (~2-3d) | L (~5-7d + ongoing) | L (multi-week) |

**Recommendation**: proceed with **Option A**, ideally preceded by
**Phase 1** (server unification, R-ARCH-2) so that the P0 finding
closes as a side effect.
