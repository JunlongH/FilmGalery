const express = require('express');
const router = express.Router();
const path = require('path');
const conflictResolver = require('../conflict-resolver');

// Get data directory from db.js logic
function getDataDir() {
  if (process.env.DATA_ROOT) {
    return process.env.DATA_ROOT;
  } else if (process.env.USER_DATA) {
    return process.env.USER_DATA;
  } else {
    return path.join(__dirname, '../');
  }
}

// GET /api/conflicts - Check for database conflicts
router.get('/', async (req, res) => {
  try {
    const dataDir = getDataDir();
    const status = await conflictResolver.getConflictStatus(dataDir);
    res.json(status);
  } catch (err) {
    console.error('[CONFLICTS API] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conflicts/resolve - Trigger auto-merge
router.post('/resolve', async (req, res) => {
  try {
    const dataDir = getDataDir();
    console.log('[CONFLICTS API] Triggering auto-cleanup...');
    const count = await conflictResolver.autoCleanup(dataDir);
    res.json({ ok: true, conflictsProcessed: count });
  } catch (err) {
    console.error('[CONFLICTS API] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
