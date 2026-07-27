# 01 — Executive Summary

> Audit date: 2026-07-27
> Auditor: opencode orchestrator (GLM-5.2) with `@explore` + `@review` delegation
> Baseline: commit on `feat/digital-mode` (uncommitted per prior review), plus
> any subsequent changes through 2026-07-27.
> Prior art: `docs/digital-mode-design/DIGITAL-MODE-IMPLEMENTATION-REVIEW.md` (2026-07-25)

---

## 1. Overall Verdict

The digital-mode feature **shipped its core user-facing flows** — workspace
toggle, import wizard, library, albums, develop panel, cross-mode browsing,
soft delete, and onboarding — and the prior W1/W2/W3 review wave closed the
three P0 contract breaks that existed at branch start. The migration is
idempotent and reversible-via-backup, and a 7-check integrity script exists.

**However, the feature carries one new Critical correctness/data-integrity
defect and several High-severity robustness gaps that were either missed by
the prior review wave or introduced by the same wave's fixes.** None of
these were caught by the existing test suites because the suites assert
*positive contracts* (does the right call work?) rather than *negative
contracts* (does the wrong pipeline reject a cross-type request?).

The feature is **safe to keep behind the existing `digital_enabled` flag**
for day-to-day use, but the P0 must be addressed before any release that
advertises digital + film as mutually isolated workflows.

---

## 2. Risk Register

> **Post-review revision** — After the independent `@review` pass (see
> `09-review-feedback-and-merge.md`), 4 of the 5 P1 findings were
> downgraded to P2, and 4 missing findings (M1-M4) were added. The table
> below reflects the recalibrated severities.

| ID | Sev | Area | One-liner | Fix cost |
|----|-----|------|-----------|----------|
| **D-P0-1** | **Critical** | server:filmlab | `/api/filmlab/{preview,render,export}` accept a digital photo's `id` and run the film pipeline on it (no `source_type='film'` guard). `/render` even overwrites `positive_rel_path` + thumb, corrupting the digital photo. Asymmetric with `/api/digital-develop/*` which is correctly guarded. | S |
| **D-P1-4** | **High** | server:develop | `getDigitalPhotoRecord` LEFT JOINs `digital_sessions` without filtering `ds.deleted_at IS NULL` — a soft-deleted session still contributes `session_label` / `import_batch` to a live photo. | S |
| D-P1-1 | Medium | server:capabilities | `/api/discover` advertises `capabilities.digital: true` unconditionally — even when libraw is missing. *(Downgraded from P1 after review: RAW decode failure is loud via `rawDecoder.decode()`, not silent.)* | S |
| D-P1-2 | Medium | mobile:state | `AppModeContext` defaults to `'film'` on AsyncStorage read failure (swallowed catch). *(Downgraded: rejection is rare; recovery is one re-toggle.)* | S |
| D-P1-3 | Medium | mobile:state | Initial `useState('film')` + async hydration causes a one-frame flash of film queries. *(Downgraded: report itself says "not a correctness bug".)* | M |
| D-P1-5 | Medium | docs:migration | Design docs reference migration id `20260801_digital_mode`; actual registered id is `20260701_digital_mode`. *(Downgraded: pure doc drift, no code impact.)* | S |
| **D-M1** | Medium | server:ai-tools | `search_photos` / `get_photo_detail` query without `source_type` filter; PHOTO_TOOLS is NOT in `FILM_ONLY_TOOL_KEYS`. AI chat in digital workspace returns film photos. *(Found by review.)* | S |
| **D-M2** | Medium | server:sessions | `GET /api/digital-sessions/:id/photos` LEFT JOIN without `ds.deleted_at IS NULL` — same bug as D-P1-4 in a second location. *(Found by review.)* | S |
| **D-M3** | Medium | server:import | `rollbackPartial()` on cancelled imports only soft-deletes DB rows; the 3 files per processed photo (display JPEG, thumb, original) are orphaned on disk permanently. *(Found by review.)* | S |
| D-P2-1 | Medium | schema | `albums.is_smart` + `smart_rule_json` columns exist; no service/UI implements smart albums. Dead schema that suggests a feature that does not exist. | S |
| D-P2-2 | Medium | schema | `photos.stack_id` + `stack_role` columns exist; stacking not implemented. Same as above. | S |
| D-P2-3 | Medium | server:develop | `normalizeParams` swallows JSON parse errors silently → empty params → photo renders with defaults and the user is not told their saved edits are unreadable. | S |
| D-P2-4 | Medium | schema:lenses | `equip_lenses.is_digital` is three-state (NULL/0/1) while `equip_cameras.is_digital` is binary — asymmetric semantics for the "is digital" concept; UI/service must special-case both. | S |
| D-P2-5 | Medium | shared:mode | `normalizeMode` falls back to `'all'` on any unrecognized value. A typo like `?mode=digitaal` returns film **and** digital photos, breaking workspace isolation by accident. | S |
| D-P2-6 | Medium | server:migration | `digital-mode-migration.js` `log()` calls `fs.appendFileSync` to a path next to the DB **before** the migration promise resolves. On a read-only DB directory (NAS mount) this throws synchronously and can crash startup. | S |
| D-P2-7 | Medium | mobile:parity | No digital develop / color-grading capability on mobile. Desktop has full `DigitalDevelop.jsx` (curves, HSL, split-tone, LUT, crop, export); mobile `PhotoViewScreen` shows EXIF + album actions only. | L |
| D-P2-8 | Medium | desktop:test | No Jest tests under `client/src/**` for digital components. Coverage relies on server-side tests + the narrative review doc. | M |
| D-P3-1 | Low | server:exif | `attachExifToJpegBuffer` calls `getPhotoWithRoll(photoId)` for a digital photo — function name is misleading; works only because the underlying query LEFT JOINs rolls. | S |
| D-P3-2 | Low | shared:mode | `buildSourceTypeClause` tolerates NULL only on the film branch. Defense-in-depth; integrity check #1 makes this branch dead in practice. | S |
| D-P3-3 | Low | desktop:UX | `Statistics` component's `mode` prop is overloaded (`'film' | 'digital' | 'spending'`), conflating workspace mode with view selector. | S |
| D-P3-4 | Low | mobile:state | `library_mode@${baseUrl}` key orphans when `baseUrl` changes (e.g. http→https). No migration of the saved preference. | S |
| D-P3-5 | Low | server:filmlab | `/api/filmlab/render` writes output as `{rollId}_{frameNum}.jpg` — for a (mistakenly routed) digital photo this produces a garbage filename. Latent only because of D-P0-1. | S |
| **D-M4** | Low | server:read-paths | `render-positive` (`photos.js:1160`) and `edge-detection` (`edge-detection.js:51`) query photos by ID without `source_type` guard. Read-only — no DB writes — but cross-type pipeline dispatch. *(Found by review.)* | S |
| D-P3-6 | Nit | desktop:onboarding | Onboarding probe `/api/rolls` couples the "digital-first" path to film-roll existence. A digital-only user with no rolls always skips the upgrade gate. | S |
| D-P3-7 | Nit | docs | Implementation review doc claims "all changes uncommitted" — verify this is still the intended state for the audit baseline. | S |

> Severity scale: **P0** = correctness/data-loss/security; **P1** = likely-broken
> user-facing behavior under common conditions; **P2** = broken under edge
> cases or maintenance hazard; **P3** = polish, naming, defense-in-depth.
> Fix cost: **S** = single file, <50 LOC; **M** = multi-file or design call;
> **L** = large feature work.

---

## 3. Strengths Worth Preserving

- **Migration design** — `IF NOT EXISTS` everywhere, `ALTER ... ADD COLUMN`
  with error-as-result for idempotency, strict variant for critical
  operations, post-backfill verification (`SELECT COUNT ... WHERE
  source_type IS NULL`), and a `_migrations` tracker layer on top.
- **`buildSourceTypeClause`** — centralized, parameterized, with a regex
  guard against column-alias injection. One of the cleaner pieces of the
  feature.
- **Integrity check script** (`server/scripts/digital-integrity-check.js`)
  — 7 assertions encoding the feature's invariants; suitable as a CI gate.
- **Two-phase import** — preview (no writes) then execute (atomic per-file
  with rollback-on-cancel and temp-file expiry sweep). Good resilience.
- **Workspace mode vs photo source_type separation** — the dual concepts
  are documented in `packages/shared/photographyMode.js` and flow
  predictably: `mode` → `?mode=` → SQL filter; `source_type` → per-row →
  pipeline dispatch.

---

## 4. What Changed vs the Prior Review (2026-07-25)

The prior review (`DIGITAL-MODE-IMPLEMENTATION-REVIEW.md`) closed the three
P0 contract breaks (import / develop / albums) and the soft-delete audit
gap. It explicitly listed as "known deferred":

- `ToneCurveEditor` picker mode stubbed
- Heart 0↔1 collapsing multi-star ratings (intentional, kept for parity)
- All changes uncommitted

This audit **does not re-litigate** those closed items. It focuses on what
the prior wave *missed* or *introduced*:

- The filmlab source-type guard was noted as a known gap in the
  implementation checklist but never implemented (D-P0-1).
- The `getDigitalPhotoRecord` LEFT JOIN was added by W2-C but does not
  filter deleted sessions (D-P1-4).
- `serverCapabilities.digital: true` was added by W2-B but never wired to
  actual libraw availability (D-P1-1).
- The migration-id doc drift was present in the original design docs and
  was not corrected when the migration shipped under a different id
  (D-P1-5).

---

## 5. Recommended Priority of Work

1. **D-P0-1** — add `AND source_type = 'film'` (or `IN ('film','film-pending')`
   if relevant) to every filmlab route's photo lookup. Add a negative test
   that posts a digital photo id to `/api/filmlab/preview` and asserts 4xx.
2. **D-P1-1, D-P1-4, D-P1-5** — small, isolated server/doc fixes; ship together.
3. **D-P1-2, D-P1-3** — mobile state hardening; pair with a unit test that
   simulates AsyncStorage rejection.
4. **D-P2-*** — schema cleanup (drop or implement smart-albums/stacking),
   tighten `normalizeMode`, make `log()` non-fatal, surface param-parse
   errors.
5. **D-P3-*** — backlog / opportunistic.

See `08-recommendations.md` for concrete file-level remediation steps.
