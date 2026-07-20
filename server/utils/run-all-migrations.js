/**
 * Unified Migration Runner
 *
 * Single source of truth for schema evolution. Wraps the three systematic
 * migrations (schema/equipment/film-struct) — the orphan scripts in
 * server/migrations/ are fully consolidated into schema-migration.js and
 * kept only as historical reference (no callers).
 *
 * Idempotency contract: every registered migration must be safe to re-run
 * (CREATE ... IF NOT EXISTS, ALTER TABLE ADD COLUMN with error-as-result).
 * The _migrations table in migration-tracker adds a higher-level skip layer.
 *
 * @module server/utils/run-all-migrations
 */

const fs = require('fs');
const path = require('path');
const { MigrationRunner, hasMigrationRun } = require('./migration-tracker');
const { getDbPath } = require('../config/db-config');

const BACKUP_RETENTION = 3;

const REGISTERED_MIGRATIONS = [
  '20240101_core_schema',
  '20241001_equipment_tables',
  '20241101_film_structure',
];

/**
 * Copy ${dbPath} to ${dbPath}.backup-${ISO}, keeping the newest
 * BACKUP_RETENTION copies. Best-effort: logs and continues on failure.
 * Backups are the only rollback path — forward-only migrations have no down().
 *
 * Only triggered when at least one registered migration has NOT run yet,
 * so an already-migrated database doesn't churn the disk on every restart.
 */
async function backupDatabaseIfNeeded() {
  const pending = [];
  for (const name of REGISTERED_MIGRATIONS) {
    if (!(await hasMigrationRun(name))) pending.push(name);
  }
  if (pending.length === 0) {
    console.log('[MIGRATIONS] All migrations already applied — skipping backup.');
    return;
  }

  const dbPath = getDbPath();
  const dataDir = path.dirname(dbPath);
  const dbBaseName = path.basename(dbPath); // typically film.db, but could be overridden via DB_PATH
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dataDir, `${dbBaseName}.backup-${stamp}`);

  try {
    fs.copyFileSync(dbPath, backupPath);

    // Rotate: keep the newest BACKUP_RETENTION *.backup-* files for this DB.
    const backupPrefix = `${dbBaseName}.backup-`;
    const backups = fs.readdirSync(dataDir)
      .filter(f => f.startsWith(backupPrefix))
      .map(f => ({ f, mtime: fs.statSync(path.join(dataDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const old of backups.slice(BACKUP_RETENTION)) {
      try { fs.unlinkSync(path.join(dataDir, old.f)); } catch { /* ignore */ }
    }
    console.log(`[MIGRATIONS] Backup: ${backupPath} (retention ${BACKUP_RETENTION}; pending: ${pending.join(', ')})`);
  } catch (e) {
    // First-time install has no db to back up — that's fine. Other errors
    // are logged but non-fatal: migrations are idempotent, so even without
    // a backup the worst case is "redo work", not "corrupt state".
    if (e.code !== 'ENOENT') {
      console.warn(`[MIGRATIONS] Backup skipped: ${e.message}`);
    }
  }
}

/**
 * Run all registered migrations with tracking.
 *
 * Order matters: schema first (creates tables/columns/indexes), then
 * equipment + film-struct (which assume base schema exists).
 *
 * @returns {Promise<{total: number, executed: number, skipped: number, failed: number}>}
 */
async function runAllMigrations() {
  console.log('[MIGRATIONS] Starting unified migration runner...');
  await backupDatabaseIfNeeded();

  const runner = new MigrationRunner();

  // 1. Core schema: tables, columns, indexes, data fixes, backfills.
  runner.add('20240101_core_schema', async () => {
    const { runSchemaMigration } = require('./schema-migration');
    await runSchemaMigration();
  });

  // 2. Equipment tables (cameras, lenses, flashes, film formats, scanners).
  runner.add('20241001_equipment_tables', async () => {
    const { runEquipmentMigration } = require('./equipment-migration');
    await runEquipmentMigration();
  });

  // 3. Film structure metadata (brand, format, process).
  runner.add('20241101_film_structure', async () => {
    const { runFilmStructMigration } = require('./film-struct-migration');
    await runFilmStructMigration();
  });

  const results = await runner.runAll();
  console.log('[MIGRATIONS] Unified migration complete:', results);
  return results;
}

/**
 * Check migration status without running.
 * @returns {Promise<Object>}
 */
async function getMigrationStatus() {
  const { getExecutedMigrations } = require('./migration-tracker');
  const executed = await getExecutedMigrations();
  return {
    executed,
    summary: {
      total: 3,
      executed: executed.filter(m => m.success).length,
      failed: executed.filter(m => !m.success).length,
    },
  };
}

module.exports = {
  runAllMigrations,
  getMigrationStatus,
  backupDatabaseIfNeeded,
};
