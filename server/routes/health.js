// Health check endpoint for database and system monitoring
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDbPath } = require('../config/db-config');
const PreparedStmt = require('../utils/prepared-statements');
const db = require('../db');

/**
 * GET /api/health/database
 * Returns database health status including WAL file info
 */
router.get('/database', (req, res) => {
  const dbPath = getDbPath();
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  const journalPath = dbPath + '-journal';
  const isWriteThrough = db.meta && db.meta.writeThrough;
  
  const health = {
    timestamp: new Date().toISOString(),
    database: {
      path: dbPath,
      exists: fs.existsSync(dbPath),
      size: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
      modified: fs.existsSync(dbPath) ? fs.statSync(dbPath).mtime : null,
    },
    wal: isWriteThrough ? {
      mode: 'TRUNCATE',
      walFile: { exists: false, size: 0, modified: null },
      shmFile: { exists: false, size: 0 }
    } : {
      mode: 'WAL',
      walFile: {
        exists: fs.existsSync(walPath),
        size: fs.existsSync(walPath) ? fs.statSync(walPath).size : 0,
        modified: fs.existsSync(walPath) ? fs.statSync(walPath).mtime : null,
      },
      shmFile: {
        exists: fs.existsSync(shmPath),
        size: fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0,
      }
    },
    legacyJournal: {
      exists: fs.existsSync(journalPath),
      size: fs.existsSync(journalPath) ? fs.statSync(journalPath).size : 0,
      warning: (!isWriteThrough && fs.existsSync(journalPath)) ? 'Legacy journal file detected - should not exist in WAL mode' : null,
    },
    preparedStatements: PreparedStmt.getStats(),
    oneDriveCompatibility: isWriteThrough ? {
      mode: 'TRUNCATE',
      status: 'write-through',
      notes: 'Write-through mode keeps changes in film.db immediately (no WAL/SHM)'
    } : {
      mode: 'WAL',
      status: 'optimized',
      notes: 'WAL mode allows OneDrive to sync main DB file while app is running'
    }
  };
  
  // Determine overall health status
  let status = 'healthy';
  const warnings = [];
  
  if (!isWriteThrough && fs.existsSync(journalPath)) {
    status = 'warning';
    warnings.push('Legacy journal file exists - database may not be in WAL mode');
  }
  
  if (!isWriteThrough && fs.existsSync(walPath)) {
    const walStats = fs.statSync(walPath);
    const walAge = Date.now() - walStats.mtimeMs;
    if (walAge > 600000) { // 10 minutes
      warnings.push(`WAL file has not been checkpointed in ${Math.round(walAge / 60000)} minutes`);
    }
    if (walStats.size > 50 * 1024 * 1024) { // 50MB
      status = 'warning';
      warnings.push(`WAL file is large (${Math.round(walStats.size / 1024 / 1024)}MB) - consider manual checkpoint`);
    }
  }
  
  res.json({
    status,
    warnings: warnings.length > 0 ? warnings : undefined,
    ...health
  });
});

/**
 * POST /api/health/checkpoint
 * Manually trigger WAL checkpoint
 */
router.post('/checkpoint', async (req, res) => {
  try {
    const db = require('../db');
    const result = await db.walCheckpoint();
    res.json({
      success: true,
      message: 'WAL checkpoint completed',
      changes: result.changes
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
