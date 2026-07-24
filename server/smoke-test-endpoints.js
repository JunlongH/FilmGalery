#!/usr/bin/env node
'use strict';

/**
 * Integration test: starts the server, verifies all endpoints affected
 * by the Part 1 digital-mode changes still return valid data.
 * Run from server/ directory.
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const https = require('https');

const BASE_HTTP = 'http://127.0.0.1:4001/api';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer(maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(`${BASE_HTTP}/photos?limit=1`);
      if (r.status === 200) return true;
    } catch (e) { /* not ready yet */ }
    await sleep(500);
  }
  return false;
}

async function main() {
  let serverProc;
  let pass = 0, fail = 0;
  const results = [];

  function check(name, cond, detail = '') {
    cond ? pass++ : fail++;
    results.push(`${cond ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
  }

  try {
    // Kill any leftover server
    try { execSync('pkill -f "node server.js"', { stdio: 'ignore' }); } catch (e) {}
    await sleep(1000);

    console.log('Starting server...');
    serverProc = spawn('node', ['server.js'], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', () => {});
    serverProc.stderr.on('data', () => {});

    const ready = await waitForServer();
    if (!ready) throw new Error('Server did not start within timeout');

    console.log('Server ready. Testing endpoints...\n');

    // --- Test all endpoints affected by Part 1 changes ---

    // 1. GET /photos (6 LEFT JOIN changes, list endpoint)
    let r = await fetch(`${BASE_HTTP}/photos?limit=2`);
    let body = JSON.parse(r.body);
    check('GET /photos (list)', r.status === 200 && Array.isArray(body) && body.length > 0,
      `status=${r.status} count=${Array.isArray(body) ? body.length : '?'}`);

    // 2. GET /photos?mode=film (source_type filter — should return same results)
    r = await fetch(`${BASE_HTTP}/photos?limit=2&mode=film`);
    body = JSON.parse(r.body);
    check('GET /photos?mode=film', r.status === 200 && Array.isArray(body) && body.length > 0,
      `status=${r.status} count=${Array.isArray(body) ? body.length : '?'}`);

    // 3. GET /photos/random (LEFT JOIN change)
    r = await fetch(`${BASE_HTTP}/photos/random?limit=2`);
    body = JSON.parse(r.body);
    check('GET /photos/random', r.status === 200 && Array.isArray(body),
      `status=${r.status} count=${Array.isArray(body) ? body.length : '?'}`);

    // 4. GET /photos/favorites (LEFT JOIN change)
    r = await fetch(`${BASE_HTTP}/photos/favorites`);
    body = JSON.parse(r.body);
    check('GET /photos/favorites', r.status === 200 && Array.isArray(body),
      `status=${r.status} count=${Array.isArray(body) ? body.length : '?'}`);

    // 5. GET /photos/negatives (INNER JOIN + source_type guard)
    r = await fetch(`${BASE_HTTP}/photos/negatives`);
    body = JSON.parse(r.body);
    check('GET /photos/negatives', r.status === 200 && Array.isArray(body),
      `status=${r.status} count=${Array.isArray(body) ? body.length : '?'}`);

    // 6. GET /photos/single/:id (LEFT JOIN change)
    r = await fetch(`${BASE_HTTP}/photos/single/1`);
    body = JSON.parse(r.body);
    check('GET /photos/single/1', r.status === 200 && body && body.id === 1,
      `status=${r.status} id=${body && body.id}`);

    // 7. GET /photos/geo (was already LEFT JOIN — regression check)
    r = await fetch(`${BASE_HTTP}/photos/geo`);
    check('GET /photos/geo', r.status === 200,
      `status=${r.status}`);

    // 8. GET /stats/gear (3 LEFT JOIN changes)
    r = await fetch(`${BASE_HTTP}/stats/gear`);
    body = JSON.parse(r.body);
    check('GET /stats/gear', r.status === 200 && typeof body === 'object',
      `status=${r.status} keys=${typeof body === 'object' ? Object.keys(body).slice(0,3) : '?'}`);

    // 9. GET /stats/activity (no change, regression)
    r = await fetch(`${BASE_HTTP}/stats/activity`);
    check('GET /stats/activity', r.status === 200,
      `status=${r.status}`);

    // 10. GET /tags (for tags.js LEFT JOIN)
    r = await fetch(`${BASE_HTTP}/tags`);
    body = JSON.parse(r.body);
    check('GET /tags', r.status === 200 && Array.isArray(body),
      `status=${r.status} count=${Array.isArray(body) ? body.length : '?'}`);

    // 11. Verify photo data has source_type field
    r = await fetch(`${BASE_HTTP}/photos?limit=1`);
    body = JSON.parse(r.body);
    const hasSourceType = Array.isArray(body) && body[0] && 'source_type' in body[0];
    check('photos have source_type field', hasSourceType,
      hasSourceType ? `value=${body[0].source_type}` : 'field missing');

    // Print results
    console.log(results.join('\n'));

  } finally {
    if (serverProc) {
      console.log('\nShutting down server...');
      try { process.kill(-serverProc.pid, 'SIGTERM'); } catch (e) {
        try { serverProc.kill('SIGTERM'); } catch (e2) {}
      }
      // Fallback
      try { execSync('pkill -f "node server.js"', { stdio: 'ignore' }); } catch (e) {}
    }
  }

  console.log(`\n=========================================`);
  console.log(`  INTEGRATION TEST: ${pass} passed, ${fail} failed`);
  console.log(`=========================================\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
