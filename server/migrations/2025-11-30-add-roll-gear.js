const db = require('../db');

const runAsync = (sql, params=[]) => new Promise((resolve,reject)=>{
  db.run(sql, params, function(err){ if(err) reject(err); else resolve(this); });
});
const allAsync = (sql, params=[]) => new Promise((resolve,reject)=>{
  db.all(sql, params, (err, rows)=>{ if(err) reject(err); else resolve(rows); });
});

async function up(){
  try {
    // First, ensure the table exists (no transaction for DDL)
    await runAsync(`
      CREATE TABLE IF NOT EXISTS roll_gear (
        roll_id INTEGER NOT NULL,
        type TEXT NOT NULL, -- 'camera' | 'lens' | 'photographer'
        value TEXT NOT NULL,
        PRIMARY KEY (roll_id, type, value)
      )
    `);
    
    // Always try to backfill. INSERT OR IGNORE handles duplicates.
    // This ensures that if new rolls were added or migration was partial, we catch up.
    
    await runAsync('BEGIN');
    
    // Backfill from rolls
    const rolls = await allAsync('SELECT id, camera, lens, photographer FROM rolls');
    for (const r of rolls){
      if (r.camera) await runAsync('INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?,?,?)', [r.id, 'camera', r.camera]);
      if (r.lens) await runAsync('INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?,?,?)', [r.id, 'lens', r.lens]);
      if (r.photographer) await runAsync('INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?,?,?)', [r.id, 'photographer', r.photographer]);
    }

    // Backfill from photos - only for photos that have a valid roll_id in rolls table
    const photos = await allAsync(`
      SELECT DISTINCT p.roll_id, p.camera, p.lens, p.photographer 
      FROM photos p
      INNER JOIN rolls r ON p.roll_id = r.id
      WHERE p.roll_id IS NOT NULL
    `);
    for (const p of photos){
      if (p.camera) await runAsync('INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?,?,?)', [p.roll_id, 'camera', p.camera]);
      if (p.lens) await runAsync('INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?,?,?)', [p.roll_id, 'lens', p.lens]);
      if (p.photographer) await runAsync('INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?,?,?)', [p.roll_id, 'photographer', p.photographer]);
    }

    await runAsync('COMMIT');
    console.log('[MIGRATION] roll_gear backfill completed');
  } catch(e){
    try { await runAsync('ROLLBACK'); } catch{}
    throw e;
  }
}

async function down(){
  await runAsync('BEGIN');
  try {
    await runAsync('DROP TABLE IF EXISTS roll_gear');
    await runAsync('COMMIT');
  } catch(e){
    try { await runAsync('ROLLBACK'); } catch{}
    throw e;
  }
}

module.exports = { up, down };