Propose feature roadmap suggestions

Read [](file:///d%3A/Program%20Files/FilmGalery/docs)

Read [](file:///d%3A/Program%20Files/FilmGalery/docs/dev-manual)

Read [](file:///d%3A/Program%20Files/FilmGalery/docs/DEVELOPER-MANUAL.md)

Read [](file:///d%3A/Program%20Files/FilmGalery/docs/dev-manual/02-database.md)

Read [](file:///d%3A/Program%20Files/FilmGalery/docs/dev-manual/03-backend-api.md#1-1), lines 1 to 300

Read [](file:///d%3A/Program%20Files/FilmGalery/docs/dev-manual/05-core-features.md#1-1), lines 1 to 300

Read [](file:///d%3A/Program%20Files/FilmGalery/docs/bugfix-2025-12-02-production-mode.md)

Acknowledged. I’ll propose a concise, actionable roadmap of high-impact features aligned with film workflows and solid engineering.

## Plan: Feature Roadmap (12 suggestions)

This draft outlines practical improvements grouped by workflow themes. Each item includes rationale, likely modules/files, data model notes, and a minimal rollout plan. It’s scoped for 1–2 months of steady work, with strong emphasis on reliability, traceability, and usability.

### Steps
1. Inventory: status audit trail with history; batch status ops.
2. Tagging: faceted search; tag hygiene (merge/rename/dedupe).
3. Location: hierarchical locations (city/area/poi); reverse geocoding cache.
4. Stats: cost dashboards; loaded-film aging alerts.
5. Mobile: write retry queue with idempotency; chunked/resumable uploads.
6. Sync: OneDrive drift checksums; local-first caches (IndexedDB/RN storage).
7. Usability: batch renaming + frame normalization; keyboard quick-actions.
8. QA/Observability: structured API telemetry; deterministic seed fixtures.
9. Gear: roll_gear enrichment automation; consistency checks per roll.
10. Presets: preset sharing/import/export; “apply to roll” bulk.
11. Conflicts: UI conflict banner; server-side auto-merge guardrails.
12. Accessibility: color/contrast and focus management across galleries.

### Further Considerations
1. Prioritization: Option A focus reliability (mobile/sync); Option B focus productivity (search/usability); Option C balanced.
2. Governance: Add admin-only endpoints for tag/merge tools; audit logs for destructive ops.
3. Rollout: Ship in weekly slices with migration + endpoints + minimal UI; add telemetry to verify adoption.

If you want, I can expand any of these into a detailed implementation plan per item (files to touch, API designs, migration sketches) for your review next.