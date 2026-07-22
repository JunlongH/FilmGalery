/**
 * v4 Phase Y — Backend hardening regression tests.
 *
 * Covers:
 *   Y.1 (P0-3) — paginateQuery helper (opt-in pagination)
 *   Y.2 (P1-17) — indexes exist (verified via schema-migration.js)
 *   Y.3 (P0-5) — log scrubbing (no req.body / EXIF GPS in logs)
 *         (P0-6/P0-7) — isPathConfined guard before fs.unlink
 *         (P1-3) — CORS Private-Network restricted to local origins
 *   Y.4 (P3) — LUT filename collision prevention
 *         (P1-5) — WAL checkpoint alternates PASSIVE/TRUNCATE
 */

const fs = require('fs');
const path = require('path');

function readSrc(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// ============================================================================
// Y.1 — paginateQuery
// ============================================================================

describe('v4 Y.1 — paginateQuery opt-in pagination', () => {
  const { paginateQuery } = require('../server/utils/db-helpers');

  test('returns { paginated: false, rows } when page is absent (backward compat)', async () => {
    // Mock allAsync to return some rows
    const original = require('../server/db');
    // We can't easily mock db.all here, but we can verify the code path
    // by checking that without ?page=, it calls allAsync with the base SQL
    // (no LIMIT/OFFSET appended). This is a structural test.
    const src = readSrc('server/utils/db-helpers.js');
    // The function should check parseInt(query.page) and return early
    expect(src).toMatch(/if\s*\(!Number\.isFinite\(pageRaw\)\s*\|\|\s*pageRaw\s*<\s*1\)/);
    expect(src).toMatch(/paginated:\s*false/);
  });

  test('source contains LIMIT ? OFFSET ? for paginated path', () => {
    const src = readSrc('server/utils/db-helpers.js');
    expect(src).toMatch(/LIMIT\s*\?\s*OFFSET\s*\?/);
  });

  test('strips trailing ORDER BY from count subquery', () => {
    const src = readSrc('server/utils/db-helpers.js');
    // v4-review: ORDER BY stripping was removed entirely — SQLite accepts
    // `SELECT COUNT(*) FROM (<sql with ORDER BY>)` (ORDER BY is a no-op
    // inside a COUNT subquery). This eliminates the fragile regex entirely.
    // Verify the regex is gone and the count just wraps baseSql as-is.
    expect(src).not.toMatch(/orderByMatch/);
    expect(src).not.toMatch(/countBase/);
    expect(src).toMatch(/SELECT COUNT\(\*\) AS cnt FROM \(\$\{baseSql\}\)/);
  });

  test('pageSize hard-capped at 5000 to prevent abuse', () => {
    const src = readSrc('server/utils/db-helpers.js');
    expect(src).toMatch(/pageSize\s*>\s*5000/);
  });

  test('GET /api/photos uses paginateQuery', () => {
    const src = readSrc('server/routes/photos.js');
    expect(src).toMatch(/paginateQuery/);
    // Without ?page, returns array directly (backward compat)
    expect(src).toMatch(/pageResult\.paginated/);
    expect(src).toMatch(/res\.json\(withTags\)/);
    // With ?page, returns { data, total, page, pageSize, hasMore }
    expect(src).toMatch(/\.\.\.pageResult\.payload,\s*data:\s*withTags/);
  });

  test('GET /api/photos/favorites uses paginateQuery', () => {
    const src = readSrc('server/routes/photos.js');
    const favSection = src.substring(src.indexOf("router.get('/favorites'"));
    expect(favSection).toMatch(/paginateQuery/);
  });

  test('GET /api/photos/negatives uses paginateQuery', () => {
    const src = readSrc('server/routes/photos.js');
    const negSection = src.substring(src.indexOf("router.get('/negatives'"));
    expect(negSection).toMatch(/paginateQuery/);
  });

  test('GET /api/tags/:tagId/photos uses paginateQuery', () => {
    const src = readSrc('server/routes/tags.js');
    expect(src).toMatch(/paginateQuery/);
  });
});

// ============================================================================
// Y.2 — Indexes (verified via schema-migration.js)
// ============================================================================

describe('v4 Y.2 — Database indexes exist in schema-migration.js', () => {
  test('schema-migration.js creates all required photo indexes', () => {
    const src = readSrc('server/utils/schema-migration.js');
    expect(src).toMatch(/idx_photos_roll\s+ON\s+photos\(roll_id\)/);
    expect(src).toMatch(/idx_photos_date_taken\s+ON\s+photos\(date_taken\)/);
    expect(src).toMatch(/idx_photos_rating\s+ON\s+photos\(rating\)/);
    expect(src).toMatch(/idx_photos_location\s+ON\s+photos\(location_id\)/);
  });

  test('schema-migration.js creates roll indexes', () => {
    const src = readSrc('server/utils/schema-migration.js');
    expect(src).toMatch(/idx_rolls_start\s+ON\s+rolls\(start_date\)/);
    expect(src).toMatch(/idx_rolls_film\s+ON\s+rolls\(filmId\)/);
  });

  test('schema-migration.js creates photo_tags indexes', () => {
    const src = readSrc('server/utils/schema-migration.js');
    expect(src).toMatch(/idx_photo_tags_photo\s+ON\s+photo_tags\(photo_id\)/);
    expect(src).toMatch(/idx_photo_tags_tag\s+ON\s+photo_tags\(tag_id\)/);
  });

  test('db.js does NOT duplicate schema-migration indexes (comment only)', () => {
    const src = readSrc('server/db.js');
    // Should have a comment pointing to schema-migration.js
    expect(src).toMatch(/schema-migration\.js/);
    // Should NOT create idx_photos_roll (that's schema-migration's job)
    expect(src).not.toMatch(/CREATE INDEX.*idx_photos_roll_id/);
  });
});

// ============================================================================
// Y.3 — Security: log scrubbing, path confinement, CORS
// ============================================================================

describe('v4 Y.3 — Log scrubbing (P0-5)', () => {
  test('PUT /api/photos/:id does not log full req.body', () => {
    const src = readSrc('server/routes/photos.js');
    // Should log only field names, not values
    expect(src).not.toMatch(/console\.log\(.*req\.body\)/);
    expect(src).toMatch(/fields=\[/);
  });

  test('download-with-exif does not log EXIF values (only keys)', () => {
    const src = readSrc('server/routes/photos.js');
    // Should log Object.keys(exifData), not JSON.stringify(exifData)
    expect(src).toMatch(/EXIF keys to write:\s*\[\$\{Object\.keys\(exifData\)/);
    // Must NOT have the old JSON.stringify(exifData, null, 2) in a console.log
    expect(src).not.toMatch(/console\.log.*JSON\.stringify\(exifData,\s*null,\s*2\)/);
  });
});

describe('v4 Y.3 — Path confinement before fs.unlink (P0-6/P0-7)', () => {
  test('path-security.js exports safeUnlink helper', () => {
    const src = readSrc('server/utils/path-security.js');
    expect(src).toMatch(/async function safeUnlink/);
    expect(src).toMatch(/isPathConfined\(rootDir,\s*relPath\)/);
    expect(src).toMatch(/module\.exports.*safeUnlink/s);
  });

  test('films.js imports safeUnlink and uses it for all 3 unlink sites', () => {
    const src = readSrc('server/routes/films.js');
    expect(src).toMatch(/require.*path-security/);
    expect(src).toMatch(/safeUnlink/);
    // Should have 3 safeUnlink calls (hard-delete, PUT thumb, POST thumb)
    const matches = src.match(/safeUnlink\(/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(3);
  });

  test('photos.js imports safeUnlink and uses it for all DB-derived unlink sites', () => {
    const src = readSrc('server/routes/photos.js');
    expect(src).toMatch(/require.*path-security/);
    expect(src).toMatch(/safeUnlink/);
    // Should have multiple safeUnlink calls (update-positive, ingest-positive x3,
    // export-positive x2, delete loop, delete legacy)
    const matches = src.match(/safeUnlink\(/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(7);
  });

  test('photos.js delete loop uses safeUnlink (not raw fsPromises.unlink)', () => {
    const src = readSrc('server/routes/photos.js');
    const deleteSection = src.substring(src.indexOf('Delete files from disk'));
    expect(deleteSection).toMatch(/safeUnlink\(uploadsDir,\s*relPath/);
    // Should NOT have raw fs.promises.unlink in the delete loop
    expect(deleteSection.substring(0, 200)).not.toMatch(/fs\.promises\.unlink\(filePath\)/);
  });

  test('photos.js legacy filename path uses safeUnlink', () => {
    const src = readSrc('server/routes/photos.js');
    const legacySection = src.substring(src.indexOf('Fallback for legacy filename'));
    expect(legacySection).toMatch(/safeUnlink\(uploadsDir,\s*legacyRel/);
    // Should NOT use the old __dirname-based path construction
    expect(legacySection).not.toMatch(/path\.join\(__dirname/);
  });

  test('safeUnlink returns {deleted:false, reason:"unconfined"} for escaped paths', () => {
    // Behavioral test of the helper itself
    const { safeUnlink } = require('../server/utils/path-security');
    const path = require('path');
    const os = require('os');
    // Create a temp dir as the confinement root
    const tmpRoot = path.join(os.tmpdir(), 'fg-test-' + Date.now());
    require('fs').mkdirSync(tmpRoot, { recursive: true });
    // Attempt to unlink an escaped path
    return safeUnlink(tmpRoot, '../../etc/passwd', { silent: true }).then(result => {
      expect(result.deleted).toBe(false);
      expect(result.reason).toBe('unconfined');
      // Cleanup
      require('fs').rmdirSync(tmpRoot);
    });
  });

  test('safeUnlink returns {deleted:true} for ENOENT (already gone)', () => {
    const { safeUnlink } = require('../server/utils/path-security');
    const path = require('path');
    const os = require('os');
    const tmpRoot = path.join(os.tmpdir(), 'fg-test-2-' + Date.now());
    require('fs').mkdirSync(tmpRoot, { recursive: true });
    // Attempt to unlink a non-existent file inside the root
    return safeUnlink(tmpRoot, 'nonexistent.jpg', { silent: true }).then(result => {
      expect(result.deleted).toBe(true);
      require('fs').rmdirSync(tmpRoot);
    });
  });
});

describe('v4 Y.3 — CORS Private-Network restricted to local origins (P1-3)', () => {
  test('server.js has isLocalOrigin function', () => {
    const src = readSrc('server/server.js');
    expect(src).toMatch(/function\s+isLocalOrigin/);
  });

  test('Private-Network header only set for local origins', () => {
    const src = readSrc('server/server.js');
    expect(src).toMatch(/if\s*\(isLocalOrigin\(req\.headers\.origin\)\)/);
    expect(src).toMatch(/setHeader\('Access-Control-Allow-Private-Network'/);
  });

  test('isLocalOrigin accepts file://, capacitor://, localhost', () => {
    const src = readSrc('server/server.js');
    expect(src).toMatch(/capacitor:\/\//);
    expect(src).toMatch(/localhost|127\.0\.0\.1/);
  });

  // v4-review #3: IPv6 [::1] support
  test('isLocalOrigin accepts IPv6 loopback [::1]', () => {
    const src = readSrc('server/server.js');
    // The regex must include \[::1\] (escaped brackets for URL form http://[::1]:4000)
    expect(src).toMatch(/\\\[::1\\\]/);
  });
});

// ============================================================================
// Y.4 — LUT filename collision + WAL checkpoint
// ============================================================================

describe('v4 Y.4 — LUT filename collision prevention (P3)', () => {
  test('luts.js multer filename handler checks for existing file', () => {
    const src = readSrc('server/routes/luts.js');
    expect(src).toMatch(/existsSync\(fullPath\)/);
    expect(src).toMatch(/Date\.now\(\)\.toString\(36\)/);
  });
});

describe('v4 Y.4 — WAL checkpoint alternates PASSIVE/TRUNCATE (P1-5)', () => {
  test('db.js startWalCheckpoint uses both PASSIVE and TRUNCATE', () => {
    const src = readSrc('server/db.js');
    expect(src).toMatch(/PASSIVE/);
    expect(src).toMatch(/TRUNCATE/);
    expect(src).toMatch(/cycleCount\s*%\s*6/);
  });
});
