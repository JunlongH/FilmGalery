/**
 * Source-level contract tests (Phase 2C regression safety net).
 *
 * These tests don't run any code — they assert on the source text itself
 * via grep. They are the cheapest possible guard against someone
 * reintroducing a pattern the 2C refactor eliminated.
 *
 * Contracts pinned:
 *
 *   #4 Error handling
 *   - routes/*.js has no `res.status(500).json({ error: err.message })`
 *     pattern (the leak source).
 *   - routes/*.js uses `next(err)` for error funneling (count > 0).
 *   - middleware/error-handler.js uses crypto.randomUUID for errorId.
 *   - packages/shared has NO worker_threads dependency (browser-safe).
 *
 *   #6 Schema
 *   - server/migrations/ stays empty (orphans deleted; schema-migration.js
 *     is the single source of truth).
 *   - server.js has no MIGRATIONS DISABLED block.
 *   - roll-service.js no longer exports ensureStartDateColumn / ensureDisplaySeqColumn
 *     (runtime fallbacks removed).
 *   - schema-migration.js creates idx_photos_location.
 *
 * If any of these break, the test name tells you exactly what pattern
 * regressed and where to look.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function listFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full, predicate, out);
    } else if (predicate(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function grepInFiles(files, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const hits = [];
  for (const f of files) {
    const lines = readFile(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
    }
  }
  return hits;
}

const routeFiles = listFiles(
  path.join(ROOT, 'server/routes'),
  (n) => n.endsWith('.js'),
);

describe('#4 contract — no error.message leak in route 5xx responses', () => {
  test('routes/*.js contains no `res.status(500).json({ error: err.message })`', () => {
    const pattern = /res\.status\(500\)\.json\(\s*\{\s*error:\s*err\.message\s*\}/;
    const hits = grepInFiles(routeFiles, pattern);
    expect(hits).toEqual([]);
  });

  test('routes/*.js contains no `res.status(500).json({ error: e.message })`', () => {
    const hits = grepInFiles(routeFiles, /res\.status\(500\)\.json\(\s*\{\s*error:\s*e\.message\s*\}/);
    expect(hits).toEqual([]);
  });

  test('routes/*.js contains no `res.status(500).json({ ok: false, error: err.message })`', () => {
    const hits = grepInFiles(routeFiles, /res\.status\(500\)\.json\(\s*\{\s*ok:\s*false,\s*error:\s*err\.message\s*\}/);
    expect(hits).toEqual([]);
  });

  test('routes/*.js uses `next(err)` (or `next(e)`/`next(error)`) for error funneling', () => {
    const hits = grepInFiles(routeFiles, /\bnext\((err|e|error|moveErr|dbErr|cleanupErr|tErr|thErr|delErr)\)/);
    // Sanity floor — we should have MANY of these after 2C.2.
    expect(hits.length).toBeGreaterThanOrEqual(20);
  });
});

describe('#4 contract — errorHandler uses UUID errorId', () => {
  test('middleware/error-handler.js imports crypto.randomUUID', () => {
    const src = readFile(path.join(ROOT, 'server/middleware/error-handler.js'));
    expect(src).toMatch(/crypto\.randomUUID\(\)/);
    // The old Date.now().toString(36) form must NOT remain.
    expect(src).not.toMatch(/Date\.now\(\)\.toString\(36\)/);
  });
});

describe('#4 contract — packages/shared stays browser-safe (no worker_threads)', () => {
  test('packages/shared/**/*.js does not require worker_threads', () => {
    const sharedFiles = listFiles(
      path.join(ROOT, 'packages/shared'),
      (n) => n.endsWith('.js'),
    );
    const hits = grepInFiles(sharedFiles, /require\(['"]worker_threads['"]\)|from ['"]worker_threads['"]/);
    expect(hits).toEqual([]);
  });
});

describe('#6 contract — migration orphans deleted', () => {
  test('server/migrations/ has no .js files (orphans deleted; schema-migration owns schema)', () => {
    const dir = path.join(ROOT, 'server/migrations');
    if (!fs.existsSync(dir)) return; // directory removed entirely — also fine
    const orphans = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    expect(orphans).toEqual([]);
  });

  test('server.js no longer has MIGRATIONS DISABLED block', () => {
    const src = readFile(path.join(ROOT, 'server/server.js'));
    expect(src).not.toMatch(/MIGRATIONS DISABLED/);
    expect(src).toMatch(/runAllMigrations/);
  });

  test('roll-service.js no longer exports runtime column fallbacks', () => {
    const src = readFile(path.join(ROOT, 'server/services/roll-service.js'));
    expect(src).not.toMatch(/function\s+ensureStartDateColumn/);
    expect(src).not.toMatch(/function\s+ensureDisplaySeqColumn/);
  });

  test('schema-migration.js creates idx_photos_location', () => {
    const src = readFile(path.join(ROOT, 'server/utils/schema-migration.js'));
    expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_photos_location ON photos\(location_id\)/);
  });
});

describe('#5 contract — worker pool lives server-side only', () => {
  test('server/services/render-worker.js exists and requires worker_threads', () => {
    const src = readFile(path.join(ROOT, 'server/services/render-worker.js'));
    expect(src).toMatch(/require\(['"]worker_threads['"]\)/);
    // And it must delegate the math to the shared renderBuffer (not duplicate).
    expect(src).toMatch(/renderBuffer/);
  });

  test('packages/shared exposes renderBuffer (single source of pixel math)', () => {
    const src = readFile(path.join(ROOT, 'packages/shared/index.js'));
    expect(src).toMatch(/renderBuffer/);
  });
});

describe('#6 contract — backup retention stays bounded', () => {
  test('run-all-migrations.js declares BACKUP_RETENTION (3)', () => {
    const src = readFile(path.join(ROOT, 'server/utils/run-all-migrations.js'));
    expect(src).toMatch(/BACKUP_RETENTION\s*=\s*3/);
    expect(src).toMatch(/backupDatabaseIfNeeded/);
  });

  test('backup uses the actual DB filename (not hardcoded "film.db")', () => {
    // Regression guard: the backup filename was previously hardcoded as
    // `film.db.backup-${stamp}`, which broke when DB_PATH pointed elsewhere.
    const src = readFile(path.join(ROOT, 'server/utils/run-all-migrations.js'));
    expect(src).not.toMatch(/['"`]film\.db\.backup-/);
    expect(src).toMatch(/dbBaseName/);
  });
});
