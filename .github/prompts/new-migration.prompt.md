---
description: "Create a new database migration for schema changes, new tables, or data transformations"
argument-hint: "Describe the schema change, e.g. 'Add a user_presets table with id, name, settings JSON, created_at'"
---
Create a new SQLite migration for FilmGallery.

Requirements:
1. Create file in `server/utils/` following the migration naming pattern
2. Use `CREATE TABLE IF NOT EXISTS` for idempotency
3. Include appropriate indexes with `CREATE INDEX IF NOT EXISTS`
4. Add foreign key constraints where applicable
5. Fields must use snake_case naming
6. Include `created_at TEXT DEFAULT (datetime('now'))` for timestamps
7. Register the migration so it runs at server startup

Reference existing migrations in `server/utils/` for the exact pattern (migration.js, schema-migration.js).

Constraints:
- Never DROP columns in the same release as code removal
- Always use prepared statements for any data transformation
- Test migration by restarting the server
