// conflict-resolver.js
// Detect and merge OneDrive conflict copies of film.db
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

/**
 * Detect OneDrive conflict copies (e.g., film-DESKTOP-XXX.db)
 * @param {string} dataDir - Directory containing film.db
 * @returns {Array<{path: string, mtime: Date, hostname: string}>}
 */
function detectConflictCopies(dataDir) {
  const files = fs.readdirSync(dataDir);
  const conflicts = [];
  
  const pattern = /^film-(.+)\.db$/;
  files.forEach(f => {
    const match = f.match(pattern);
    if (match) {
      const fullPath = path.join(dataDir, f);
      const stat = fs.statSync(fullPath);
      conflicts.push({
        path: fullPath,
        filename: f,
        hostname: match[1],
        mtime: stat.mtime,
        size: stat.size
      });
    }
  });
  
  return conflicts.sort((a, b) => b.mtime - a.mtime); // newest first
}

/**
 * Compare two databases and identify conflicting records
 * @param {string} mainDbPath 
 * @param {string} conflictDbPath 
 * @returns {Promise<Object>} - Conflict summary with detailed record info
 */
function compareDBs(mainDbPath, conflictDbPath) {
  return new Promise((resolve, reject) => {
    const main = new sqlite3.Database(mainDbPath, sqlite3.OPEN_READONLY);
    const conflict = new sqlite3.Database(conflictDbPath, sqlite3.OPEN_READONLY);
    
    const result = {
      mainRecords: {},
      conflictRecords: {},
      conflicts: [],
      recordsToMerge: [] // New: records that should be imported
    };
    
    // Compare critical tables: rolls, photos, tags
    const tables = ['rolls', 'photos', 'tags'];
    let pending = tables.length * 2;
    
    const checkDone = () => {
      if (--pending === 0) {
        main.close();
        conflict.close();
        
        // Identify actual conflicts and determine merge strategy
        tables.forEach(table => {
          const mainRecs = result.mainRecords[table] || {};
          const conflictRecs = result.conflictRecords[table] || {};
          
          const mainIds = Object.keys(mainRecs);
          const conflictIds = Object.keys(conflictRecs);
          
          const onlyInMain = mainIds.filter(id => !conflictIds.includes(id));
          const onlyInConflict = conflictIds.filter(id => !mainIds.includes(id));
          const inBoth = mainIds.filter(id => conflictIds.includes(id));
          
          // Find records to merge based on timestamp
          const toImport = [];
          const toUpdate = [];
          
          // Records only in conflict → import
          onlyInConflict.forEach(id => {
            toImport.push({ table, record: conflictRecs[id] });
          });
          
          // Records in both → compare timestamps
          inBoth.forEach(id => {
            const mainRec = mainRecs[id];
            const confRec = conflictRecs[id];
            
            // Compare updated_at or created_at timestamps
            const mainTime = new Date(mainRec.updated_at || mainRec.created_at || 0).getTime();
            const confTime = new Date(confRec.updated_at || confRec.created_at || 0).getTime();
            
            if (confTime > mainTime) {
              // Conflict record is newer → update main
              toUpdate.push({ table, id, record: confRec });
            }
          });
          
          result.conflicts.push({
            table,
            onlyInMain: onlyInMain.length,
            onlyInConflict: onlyInConflict.length,
            inBoth: inBoth.length,
            toImport: toImport.length,
            toUpdate: toUpdate.length,
            needsMerge: toImport.length > 0 || toUpdate.length > 0
          });
          
          result.recordsToMerge.push(...toImport, ...toUpdate);
        });
        
        resolve(result);
      }
    };
    
    tables.forEach(table => {
      main.all(`SELECT * FROM ${table}`, (err, rows) => {
        if (err) {
          console.error(`[compareDBs] Error reading main.${table}:`, err.message);
          result.mainRecords[table] = {};
        } else {
          result.mainRecords[table] = Object.fromEntries(rows.map(r => [r.id, r]));
        }
        checkDone();
      });
      
      conflict.all(`SELECT * FROM ${table}`, (err, rows) => {
        if (err) {
          console.error(`[compareDBs] Error reading conflict.${table}:`, err.message);
          result.conflictRecords[table] = {};
        } else {
          result.conflictRecords[table] = Object.fromEntries(rows.map(r => [r.id, r]));
        }
        checkDone();
      });
    });
  });
}

/**
 * Merge conflict database into main using timestamp-based strategy
 * @param {string} mainDbPath 
 * @param {string} conflictDbPath 
 * @param {boolean} autoMerge - If false, only analyze without merging
 */
async function mergeConflict(mainDbPath, conflictDbPath, autoMerge = true) {
  const comparison = await compareDBs(mainDbPath, conflictDbPath);
  
  console.log('[CONFLICT-RESOLVER] Comparison:', JSON.stringify(comparison.conflicts, null, 2));
  
  const needsMerge = comparison.conflicts.some(c => c.needsMerge);
  if (!needsMerge) {
    console.log('[CONFLICT-RESOLVER] No new records in conflict DB, safe to delete');
    return { merged: false, safe: true, conflicts: comparison.conflicts };
  }
  
  if (!autoMerge) {
    console.log('[CONFLICT-RESOLVER] Auto-merge disabled, returning analysis only');
    return { 
      merged: false, 
      safe: false, 
      needsManualReview: true,
      conflicts: comparison.conflicts,
      recordsToMerge: comparison.recordsToMerge
    };
  }
  
  // Execute merge
  console.log(`[CONFLICT-RESOLVER] Auto-merging ${comparison.recordsToMerge.length} records...`);
  
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(mainDbPath);
    let merged = 0;
    let failed = 0;
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      comparison.recordsToMerge.forEach(({ table, id, record }) => {
        const columns = Object.keys(record).filter(k => k !== 'id');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(k => record[k]);
        
        if (id) {
          // Update existing record
          const setClause = columns.map(k => `${k} = ?`).join(', ');
          const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`;
          db.run(sql, [...values, id], (err) => {
            if (err) {
              console.error(`[CONFLICT-RESOLVER] Failed to update ${table}#${id}:`, err.message);
              failed++;
            } else {
              console.log(`[CONFLICT-RESOLVER] Updated ${table}#${id}`);
              merged++;
            }
          });
        } else {
          // Insert new record (without id, let autoincrement handle it)
          const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
          db.run(sql, values, function(err) {
            if (err) {
              console.error(`[CONFLICT-RESOLVER] Failed to insert into ${table}:`, err.message);
              failed++;
            } else {
              console.log(`[CONFLICT-RESOLVER] Inserted into ${table}, new id: ${this.lastID}`);
              merged++;
            }
          });
        }
      });
      
      db.run('COMMIT', (err) => {
        if (err) {
          console.error('[CONFLICT-RESOLVER] Commit failed:', err.message);
          db.run('ROLLBACK');
          db.close();
          resolve({ merged: false, safe: false, error: err.message });
        } else {
          console.log(`[CONFLICT-RESOLVER] Merge complete: ${merged} records merged, ${failed} failed`);
          db.close();
          resolve({ 
            merged: true, 
            safe: true, 
            recordsMerged: merged,
            recordsFailed: failed,
            conflicts: comparison.conflicts
          });
        }
      });
    });
  });
}

/**
 * Auto-cleanup: detect, compare, and optionally merge conflicts
 * @param {string} dataDir 
 */
async function autoCleanup(dataDir) {
  const mainDbPath = path.join(dataDir, 'film.db');
  if (!fs.existsSync(mainDbPath)) {
    console.error('[CONFLICT-RESOLVER] Main database not found:', mainDbPath);
    return;
  }
  
  const conflicts = detectConflictCopies(dataDir);
  if (conflicts.length === 0) {
    console.log('[CONFLICT-RESOLVER] No conflict copies found');
    return;
  }
  
  console.log(`[CONFLICT-RESOLVER] Found ${conflicts.length} conflict(s):`, conflicts.map(c => c.filename));
  
  for (const conf of conflicts) {
    console.log(`[CONFLICT-RESOLVER] Analyzing ${conf.filename}...`);
    const result = await mergeConflict(mainDbPath, conf.path, true); // autoMerge = true
    
    if (result.merged) {
      console.log(`[CONFLICT-RESOLVER] Successfully merged ${result.recordsMerged} records`);
      // Backup merged file before removing
      const backupPath = conf.path + '.merged';
      fs.renameSync(conf.path, backupPath);
      console.log(`[CONFLICT-RESOLVER] Conflict file backed up to ${backupPath}`);
    } else if (result.safe) {
      // No conflicts, safe to backup
      const backupPath = conf.path + '.bak';
      fs.renameSync(conf.path, backupPath);
      console.log(`[CONFLICT-RESOLVER] No new data, backed up to ${backupPath}`);
    } else if (result.needsManualReview) {
      console.warn(`[CONFLICT-RESOLVER] Keep ${conf.filename} for manual review`);
    } else if (result.error) {
      console.error(`[CONFLICT-RESOLVER] Merge failed: ${result.error}`);
      console.warn(`[CONFLICT-RESOLVER] Keep ${conf.filename} due to error`);
    }
  }
  
  return conflicts.length;
}

/**
 * Get current conflict status without modifying anything
 * @param {string} dataDir 
 */
async function getConflictStatus(dataDir) {
  const mainDbPath = path.join(dataDir, 'film.db');
  if (!fs.existsSync(mainDbPath)) {
    return { hasConflicts: false, conflicts: [] };
  }
  
  const conflicts = detectConflictCopies(dataDir);
  if (conflicts.length === 0) {
    return { hasConflicts: false, conflicts: [] };
  }
  
  const details = [];
  for (const conf of conflicts) {
    const result = await mergeConflict(mainDbPath, conf.path, false); // analyze only
    details.push({
      filename: conf.filename,
      hostname: conf.hostname,
      mtime: conf.mtime,
      size: conf.size,
      analysis: result.conflicts,
      needsMerge: result.recordsToMerge ? result.recordsToMerge.length > 0 : false
    });
  }
  
  return { hasConflicts: true, conflicts: details };
}

module.exports = { detectConflictCopies, compareDBs, mergeConflict, autoCleanup, getConflictStatus };

// CLI usage
if (require.main === module) {
  const dataDir = process.argv[2] || path.join(__dirname, '../');
  autoCleanup(dataDir).catch(err => {
    console.error('[CONFLICT-RESOLVER] Error:', err);
    process.exit(1);
  });
}
