#!/usr/bin/env node
/**
 * Digital Mode Data Integrity Check
 *
 * Runs 7 consistency checks against the digital-mode schema.
 * Exits with code 1 if any check fails.
 *
 * Usage: node scripts/digital-integrity-check.js [dbPath]
 */

const sqlite3 = require('sqlite3');
const path = require('path');
const { getDbPath } = require('../config/db-config');

const dbPath = process.argv[2] || getDbPath();

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || { cnt: 0 });
    });
  });
}

const checks = [
  {
    name: '1. All photos have source_type (no NULL)',
    sql: `SELECT COUNT(*) AS cnt FROM photos WHERE source_type IS NULL`,
    expect: 0,
  },
  {
    name: '2. Digital photos have NULL roll_id',
    sql: `SELECT COUNT(*) AS cnt FROM photos WHERE source_type='digital' AND roll_id IS NOT NULL`,
    expect: 0,
  },
  {
    name: '3. Film photos have NULL session_id',
    sql: `SELECT COUNT(*) AS cnt FROM photos WHERE source_type='film' AND session_id IS NOT NULL`,
    expect: 0,
  },
  {
    name: '4. No orphan album_photos (photo missing)',
    sql: `SELECT COUNT(*) AS cnt FROM album_photos ap LEFT JOIN photos p ON ap.photo_id=p.id WHERE p.id IS NULL`,
    expect: 0,
  },
  {
    name: '5. No orphan album_photos (album missing)',
    sql: `SELECT COUNT(*) AS cnt FROM album_photos ap LEFT JOIN albums a ON ap.album_id=a.id WHERE a.id IS NULL`,
    expect: 0,
  },
  {
    name: '6. digital_sessions.file_count matches actual photos (total incl. deleted)',
    sql: `SELECT COUNT(*) AS cnt FROM digital_sessions ds WHERE ds.file_count != (SELECT COUNT(*) FROM photos WHERE session_id=ds.id) AND ds.deleted_at IS NULL`,
    expect: 0,
  },
  {
    name: '7. Digital cameras have NULL format_id (no film format)',
    sql: `SELECT COUNT(*) AS cnt FROM equip_cameras WHERE is_digital=1 AND format_id IS NOT NULL`,
    expect: 0,
  },
];

async function run() {
  console.log(`\n  Digital Mode Integrity Check`);
  console.log(`  DB: ${dbPath}\n`);
  console.log(`${'─'.repeat(60)}`);

  let failures = 0;

  for (const check of checks) {
    try {
      const row = await getAsync(check.sql);
      const cnt = row.cnt;
      const pass = cnt === check.expect;
      const status = pass ? 'PASS' : 'FAIL';
      if (!pass) failures++;
      console.log(`  [${status}] ${check.name}: ${cnt} (expected ${check.expect})`);
    } catch (err) {
      failures++;
      console.log(`  [FAIL] ${check.name}: ERROR — ${err.message}`);
    }
  }

  console.log(`${'─'.repeat(60)}`);
  const total = checks.length;
  const passed = total - failures;
  console.log(`  Result: ${passed}/${total} PASS, ${failures} FAIL\n`);

  db.close();
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal:', err);
  db.close();
  process.exit(1);
});
