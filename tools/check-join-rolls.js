#!/usr/bin/env node
/**
 * Anti-regression lint rule: forbid bare "JOIN rolls" (INNER JOIN).
 *
 * After the digital-mode migration, roll_id is nullable. Any INNER JOIN rolls
 * silently drops digital photos (NULL roll_id) from the result set. Only
 * LEFT JOIN is safe for shared queries.
 *
 * Whitelisted exceptions (film-only code paths with explicit source_type guards):
 *   - server/services/render-service.js  (FilmLab rendering, film-only)
 *   - server/routes/photos.js            (GET /negatives, film-only)
 *   - server/scripts/check-lens-data.js  (one-off maintenance script)
 *
 * Exit code 1 if any non-whitelisted INNER JOIN rolls is found.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['server/routes', 'server/services', 'server/utils'];
const FILE_EXT = '.js';

const WHITELIST = new Set([
  'server/services/render-service.js',
  'server/routes/photos.js',
]);

const BARE_JOIN_RE = /(?<!LEFT\s)JOIN\s+rolls\s+\w+\s+ON/i;

function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.name.endsWith(FILE_EXT)) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkFile(filePath) {
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, i) => {
    if (BARE_JOIN_RE.test(line)) {
      violations.push({ file: relPath, line: i + 1, text: line.trim() });
    }
  });

  return { relPath, violations };
}

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    files.push(...walkDir(path.join(ROOT, dir)));
  }

  let totalViolations = 0;
  const flagged = [];

  for (const file of files) {
    const { violations } = checkFile(file);
    for (const v of violations) {
      if (WHITELIST.has(v.file)) continue;
      flagged.push(v);
      totalViolations++;
    }
  }

  if (totalViolations === 0) {
    console.log('[check-join-rolls] PASS — no non-whitelisted INNER JOIN rolls found.');
    process.exit(0);
  }

  console.error('[check-join-rolls] FAIL — bare "JOIN rolls" must be "LEFT JOIN rolls":\n');
  for (const v of flagged) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}\n`);
  }
  console.error('If this is a film-only code path, add a source_type guard');
  console.error('and add the file to the whitelist in tools/check-join-rolls.js.\n');
  process.exit(1);
}

main();
