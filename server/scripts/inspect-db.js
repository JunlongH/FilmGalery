// Inspect SQLite film.db: list tables, counts, and sample photo paths
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

function resolveDbPath() {
  // Allow explicit override via CLI: --db=<path> or env DB_PATH
  const arg = process.argv.find(a => a.startsWith('--db='));
  if (arg) {
    const p = arg.slice('--db='.length);
    if (fs.existsSync(p)) return p;
    console.warn('[INSPECT] --db path not found:', p);
  }
  if (process.env.DB_PATH && fs.existsSync(process.env.DB_PATH)) return process.env.DB_PATH;
  const candidates = [];
  if (process.env.DATA_ROOT) candidates.push(path.join(process.env.DATA_ROOT, 'film.db'));
  if (process.env.USER_DATA) candidates.push(path.join(process.env.USER_DATA, 'film.db'));
  candidates.push(path.join(__dirname, '..', 'film.db'));
  candidates.push(path.join(process.cwd(), 'film.db'));
  candidates.push(path.join(path.dirname(__dirname), 'film.db'));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

(async () => {
  const dbPath = resolveDbPath();
  console.log('[INSPECT] DB path:', dbPath, fs.existsSync(dbPath) ? '(exists)' : '(missing)');
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) { console.error('Open DB error:', err.message); process.exit(1); }
  });

  function all(sql, params=[]) { return new Promise((resolve, reject) => db.all(sql, params, (e, rows)=> e?reject(e):resolve(rows))); }
  function get(sql, params=[]) { return new Promise((resolve, reject) => db.get(sql, params, (e, row)=> e?reject(e):resolve(row))); }

  try {
    const tables = await all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log('[INSPECT] Tables:', tables.map(t=>t.name).join(', '));

    const counts = {};
    for (const t of tables) {
      try {
        const r = await get(`SELECT COUNT(*) AS c FROM ${t.name}`);
        counts[t.name] = r.c;
      } catch {}
    }
    console.log('[INSPECT] Counts:', counts);

    // Sample photos
    const photos = await all('SELECT id, roll_id, filename, full_rel_path, positive_rel_path, negative_rel_path, thumb_rel_path, positive_thumb_rel_path, negative_thumb_rel_path FROM photos ORDER BY id LIMIT 10');
    console.log('[INSPECT] Sample photos (top 10):');
    photos.forEach(p => console.log(p));

    // Check a specific roll if provided via env ROLL_ID
    const rollId = process.env.ROLL_ID || null;
    if (rollId) {
      const rphotos = await all('SELECT id, filename, full_rel_path, positive_rel_path, negative_rel_path FROM photos WHERE roll_id = ? ORDER BY frame_number', [rollId]);
      console.log(`[INSPECT] Roll ${rollId} photos:`, rphotos.length);
      rphotos.forEach(p => console.log(p));
    }

    // Sample rolls covers
    const rolls = await all('SELECT id, title, cover_photo, coverPath, folderName FROM rolls ORDER BY id LIMIT 10');
    console.log('[INSPECT] Sample rolls (top 10):');
    rolls.forEach(r => console.log(r));

  } catch (e) {
    console.error('Inspect error:', e.message);
  } finally {
    db.close();
  }
})();
