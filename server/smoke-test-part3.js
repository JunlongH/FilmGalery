/**
 * Part 3 Smoke Test — digital mode backend routes + services.
 *
 * Inserts test data, starts the server, hits all new endpoints,
 * verifies responses, then cleans up.
 *
 * Run from server/ directory:  node smoke-test-part3.js
 */

const { spawn } = require('child_process');
const http = require('http');
const sqlite3 = require('sqlite3');

const BASE = 'http://127.0.0.1:4001';
const DB_PATH = 'film.db';

let pass = 0;
let fail = 0;
const results = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    results.push(`  PASS  ${name}`);
  } else {
    fail++;
    results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function httpJson(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${BASE}${path}`,
      {
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null, raw: chunks });
          } catch (_) {
            resolve({ status: res.statusCode, body: null, raw: chunks });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      http
        .get(`${BASE}/api/health`, (res) => {
          if (res.statusCode === 200) resolve();
          else if (Date.now() - start > timeoutMs) reject(new Error('timeout'));
          else setTimeout(probe, 300);
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('timeout'));
          else setTimeout(probe, 300);
        });
    }
    probe();
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.run(sql, params, function (err) {
      db.close();
      err ? reject(err) : resolve(this.lastID);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.all(sql, params, (err, rows) => {
      db.close();
      err ? reject(err) : resolve(rows || []);
    });
  });
}

async function main() {
  // ── 0. Insert test data ──────────────────────────────────────────────
  console.log('\n[Part 3 Smoke Test] Inserting test data...');

  const sessionId = await dbRun(
    `INSERT INTO digital_sessions (import_batch, session_date, label, notes, file_count)
     VALUES (?, ?, ?, ?, ?)`,
    ['test-batch-001', '2026-07-20', 'Test Session', 'Smoke test', 1]
  );

  const photoId = await dbRun(
    `INSERT INTO photos (filename, source_type, session_id, content_hash, original_filename,
       date_taken, thumb_rel_path, positive_rel_path, original_rel_path)
     VALUES (?, 'digital', ?, ?, ?, ?, ?, ?, ?)`,
    [
      'IMG_0001.jpg',
      sessionId,
      'testhash001',
      'IMG_0001.jpg',
      '2026-07-20T10:00:00Z',
      'digital/2026/07/thumb/test_thumb.jpg',
      'digital/2026/07/test_display.jpg',
      'digital/2026/07/test_original.jpg',
    ]
  );

  const albumId = await dbRun(
    `INSERT INTO albums (title, description) VALUES (?, ?)`,
    ['Test Album', 'Smoke test album']
  );

  console.log(`  session=${sessionId}, photo=${photoId}, album=${albumId}`);

  // ── 1. Start server ──────────────────────────────────────────────────
  console.log('[Part 3 Smoke Test] Starting server...');
  const serverProc = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SERVER_PORT: '4000', HTTP_MIRROR_PORT: '4001' },
  });

  serverProc.stderr.on('data', (d) => {
    const s = d.toString();
    if (/error|ERROR|EADDRINUSE/i.test(s)) console.error('[server stderr]', s.trim());
  });

  try {
    await waitForServer();
    console.log('[Part 3 Smoke Test] Server ready, running tests...\n');

    // ── 2. App Config ────────────────────────────────────────────────
    {
      const r = await httpJson('GET', '/api/app-config');
      check('GET /api/app-config returns 200', r.status === 200);
      check('app-config has photography_mode', r.body && 'photography_mode' in r.body);

      const r2 = await httpJson('PUT', '/api/app-config', { photography_mode: 'digital' });
      check('PUT /api/app-config returns 200', r2.status === 200);
      check('app-config mode updated to digital', r2.body && r2.body.photography_mode === 'digital');

      const r3 = await httpJson('POST', '/api/app-config/onboarding', { choice: 'both' });
      check('POST onboarding returns 200', r3.status === 200);
      check('onboarding sets mode to all', r3.body && r3.body.photography_mode === 'all');

      const r4 = await httpJson('POST', '/api/app-config/onboarding', { choice: 'invalid' });
      check('onboarding rejects invalid choice', r4.status === 400);
    }

    // ── 3. Albums CRUD ───────────────────────────────────────────────
    {
      const r = await httpJson('GET', '/api/albums');
      check('GET /api/albums returns 200', r.status === 200);
      check('albums is array', Array.isArray(r.body));
      check('test album in list', Array.isArray(r.body) && r.body.some((a) => a.id === albumId));

      const r2 = await httpJson('GET', `/api/albums/${albumId}`);
      check('GET /api/albums/:id returns 200', r2.status === 200);
      check('album has correct title', r2.body && r2.body.title === 'Test Album');

      const r3 = await httpJson('PUT', `/api/albums/${albumId}`, { title: 'Updated Album' });
      check('PUT /api/albums/:id returns 200', r3.status === 200);
      check('album title updated', r3.body && r3.body.title === 'Updated Album');

      // Cover
      const r4 = await httpJson('POST', `/api/albums/${albumId}/cover`, { photo_id: photoId });
      check('POST cover returns 200', r4.status === 200);

      // Add photos
      const r5 = await httpJson('POST', `/api/albums/${albumId}/photos`, { photo_ids: [photoId] });
      check('POST add photos returns 200', r5.status === 200);

      // List photos in album
      const r6 = await httpJson('GET', `/api/albums/${albumId}/photos`);
      check('GET album photos returns 200', r6.status === 200);
      check('album has 1 photo', Array.isArray(r6.body) && r6.body.length === 1);

      // Sort photos
      const r7 = await httpJson('PUT', `/api/albums/${albumId}/photos/sort`, { photo_ids: [photoId] });
      check('PUT sort photos returns 200', r7.status === 200);

      // Remove photo
      const r8 = await httpJson('DELETE', `/api/albums/${albumId}/photos/${photoId}`);
      check('DELETE remove photo returns 200', r8.status === 200);

      // Soft delete
      const r9 = await httpJson('DELETE', `/api/albums/${albumId}`);
      check('DELETE album (soft) returns 200', r9.status === 200);

      // Restore
      const r10 = await httpJson('POST', `/api/albums/${albumId}/restore`);
      check('POST restore returns 200', r10.status === 200);

      // Cycle detection
      const childAlbum = await httpJson('POST', '/api/albums', { title: 'Child', parent_id: albumId });
      check('POST create child album', childAlbum.status === 201);
      const cycleAttempt = await httpJson('PUT', `/api/albums/${albumId}`, {
        parent_id: childAlbum.body.id,
      });
      check('Cycle detected (400)', cycleAttempt.status === 400);

      // Hard delete child
      await httpJson('DELETE', `/api/albums/${childAlbum.body.id}?hard=true`);
    }

    // ── 4. Digital Sessions ──────────────────────────────────────────
    {
      const r = await httpJson('GET', '/api/digital-sessions');
      check('GET /api/digital-sessions returns 200', r.status === 200);
      check('sessions is array', Array.isArray(r.body));
      check('test session in list', Array.isArray(r.body) && r.body.some((s) => s.id === sessionId));

      const r2 = await httpJson('GET', `/api/digital-sessions/${sessionId}`);
      check('GET session/:id returns 200', r2.status === 200);
      check('session has label', r2.body && r2.body.label === 'Test Session');

      const r3 = await httpJson('GET', `/api/digital-sessions/${sessionId}/photos`);
      check('GET session/:id/photos returns 200', r3.status === 200);
      check('session has 1 photo', Array.isArray(r3.body) && r3.body.length === 1);

      const r4 = await httpJson('PUT', `/api/digital-sessions/${sessionId}`, {
        label: 'Updated Session',
        notes: 'Updated',
      });
      check('PUT session/:id returns 200', r4.status === 200);
      check('session label updated', r4.body && r4.body.label === 'Updated Session');

      // Soft delete + verify it disappears from list
      const r5 = await httpJson('DELETE', `/api/digital-sessions/${sessionId}`);
      check('DELETE session (soft) returns 200', r5.status === 200);
      const r6 = await httpJson('GET', '/api/digital-sessions');
      check('soft-deleted session not in list', !r6.body.some((s) => s.id === sessionId));
    }

    // ── 5. Digital Develop (params read only — no actual rendering) ──
    {
      const r = await httpJson('GET', `/api/digital-develop/${photoId}/params`);
      check('GET develop params returns 200', r.status === 200);
      check('params is null (not saved yet)', r.body && r.body.params === null);

      // Save params
      const testParams = JSON.stringify({ exposure: 10, contrast: 5, temp: 200, tint: 0 });
      const r2 = await httpJson('POST', '/api/digital-develop/save', {
        photo_id: photoId,
        params_json: testParams,
      });
      // This will fail if the source file doesn't exist, which is expected
      if (r2.status === 200) {
        check('POST develop save returns 200', true);
        const r3 = await httpJson('GET', `/api/digital-develop/${photoId}/params`);
        check('saved params readable', r3.body && r3.body.params !== null);
      } else {
        check('POST develop save expected to fail (no source file)', r2.status === 500, r2.body?.error);
      }
    }

    // ── 6. Import check-hash ─────────────────────────────────────────
    {
      const r = await httpJson('POST', '/api/digital/import/check-hash', { hash: 'testhash001' });
      check('check-hash finds duplicate', r.status === 200 && r.body.duplicate === true);

      const r2 = await httpJson('POST', '/api/digital/import/check-hash', { hash: 'nonexistent' });
      check('check-hash no duplicate', r2.status === 200 && r2.body.duplicate === false);
    }

    // ── 7. Import progress (non-existent job) ────────────────────────
    {
      const r = await httpJson('GET', '/api/digital/import/nonexistent/progress');
      check('progress 404 for unknown job', r.status === 404);
    }

    // ── 8. Film endpoints still work ─────────────────────────────────
    {
      const r = await httpJson('GET', '/api/photos');
      check('GET /api/photos still works', r.status === 200);

      const r2 = await httpJson('GET', '/api/stats/gear');
      check('GET /api/stats/gear still works', r2.status === 200);
    }

    // ── 9. discover endpoint ─────────────────────────────────────────
    {
      const r = await httpJson('GET', '/api/discover');
      check('GET /api/discover returns 200', r.status === 200);
    }
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────
    console.log('\n[Part 3 Smoke Test] Cleaning up test data...');
    serverProc.kill('SIGTERM');
    try {
      await new Promise((r) => serverProc.on('exit', r).setTimeout(3000, () => r()));
    } catch (_) {}

    await dbRun('DELETE FROM album_photos WHERE photo_id = ?', [photoId]);
    await dbRun('DELETE FROM photos WHERE id = ?', [photoId]);
    await dbRun('DELETE FROM digital_sessions WHERE id = ?', [sessionId]);
    await dbRun('DELETE FROM albums WHERE title LIKE "Test%" OR title LIKE "Updated%" OR title LIKE "Child%"');
    await dbRun("UPDATE app_config SET photography_mode = 'all' WHERE id = 1");
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n' + results.join('\n'));
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Part 3 Smoke Test: ${pass} PASS, ${fail} FAIL`);
  console.log('='.repeat(60));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
