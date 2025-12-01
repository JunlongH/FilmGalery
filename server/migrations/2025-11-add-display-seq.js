/**
 * Migration: Add display_seq to rolls and backfill ranking.
 */
module.exports = {
  up: async (db) => {
    // Add column display_seq if not exists
    await db.run(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS display_seq INTEGER NOT NULL DEFAULT 0`);

    // Helpful ordering index
    await db.run(`CREATE INDEX IF NOT EXISTS idx_rolls_order ON rolls(end_date, start_date, created_at, id)`);

    // Backfill: compute order and assign display_seq
    const rows = await new Promise((resolve, reject) => db.all(`
      SELECT id
      FROM rolls
      ORDER BY 
        CASE WHEN end_date IS NULL THEN 1 ELSE 0 END,
        end_date ASC,
        CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
        start_date ASC,
        CASE WHEN created_at IS NULL THEN 1 ELSE 0 END,
        created_at ASC,
        id ASC
    `, [], (err, rows) => err ? reject(err) : resolve(rows || [])));

    await db.run('BEGIN');
    try {
      let seq = 1;
      for (const r of rows) {
        await db.run(`UPDATE rolls SET display_seq = ? WHERE id = ?`, [seq, r.id]);
        seq++;
      }
      await db.run('COMMIT');
    } catch (e) {
      try { await db.run('ROLLBACK'); } catch(_) {}
      throw e;
    }
  },
  down: async (db) => {
    // Drop index and column (if your sqlite wrapper supports it)
    await db.run(`DROP INDEX IF EXISTS idx_rolls_order`);
    // SQLite cannot DROP COLUMN easily; set display_seq back to 0
    await db.run(`UPDATE rolls SET display_seq = 0`);
  }
};
