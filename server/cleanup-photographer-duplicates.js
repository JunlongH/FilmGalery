const sqlite3 = require('sqlite3').verbose();
const { getDbPath } = require('./config/db-config');

const dbPath = getDbPath();
console.log('Using database at:', dbPath);

const db = new sqlite3.Database(dbPath);

const runAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const queryAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

async function cleanupPhotographerDuplicates() {
  console.log('\n=== Cleaning up photographer duplicates ===\n');
  
  // Find all rolls with both "Junlong" and "Junlong Huang"
  const duplicateRolls = await queryAsync(`
    SELECT DISTINCT roll_id 
    FROM roll_gear 
    WHERE type = 'photographer' 
      AND value IN ('Junlong', 'Junlong Huang')
    GROUP BY roll_id
    HAVING COUNT(DISTINCT value) > 1
  `);

  console.log(`Found ${duplicateRolls.length} rolls with duplicate photographer names.`);

  let cleaned = 0;
  for (const row of duplicateRolls) {
    const rollId = row.roll_id;
    
    // Delete "Junlong Huang" if "Junlong" exists
    const result = await runAsync(
      `DELETE FROM roll_gear 
       WHERE roll_id = ? 
         AND type = 'photographer' 
         AND value = 'Junlong Huang'
         AND EXISTS (
           SELECT 1 FROM roll_gear 
           WHERE roll_id = ? 
             AND type = 'photographer' 
             AND value = 'Junlong'
         )`,
      [rollId, rollId]
    );
    
    if (result.changes > 0) {
      console.log(`Roll ${rollId}: Removed "Junlong Huang" (kept "Junlong")`);
      cleaned++;
    }
  }

  // Also find rolls with ONLY "Junlong Huang" and optionally rename them
  const onlyLongForm = await queryAsync(`
    SELECT roll_id 
    FROM roll_gear 
    WHERE type = 'photographer' 
      AND value = 'Junlong Huang'
      AND roll_id NOT IN (
        SELECT roll_id FROM roll_gear 
        WHERE type = 'photographer' AND value = 'Junlong'
      )
  `);

  console.log(`\nFound ${onlyLongForm.length} rolls with only "Junlong Huang".`);
  console.log('These will be kept as-is (user can manually change if desired).');

  console.log(`\n✅ Cleanup complete. Removed ${cleaned} duplicate entries.`);
}

cleanupPhotographerDuplicates()
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(() => {
    db.close();
  });
