const express = require('express');
const router = express.Router();
const path = require('path');
const conflictResolver = require('../conflict-resolver');
const { asyncHandler } = require('../utils/async-handler');

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
router.get('/', asyncHandler(async (req, res) => {
  const dataDir = getDataDir();
  const status = await conflictResolver.getConflictStatus(dataDir);
  res.json(status);
}));

// POST /api/conflicts/resolve - Trigger auto-merge
router.post('/resolve', asyncHandler(async (req, res) => {
  const dataDir = getDataDir();
  console.log('[CONFLICTS API] Triggering auto-cleanup...');
  const count = await conflictResolver.autoCleanup(dataDir);
  res.json({ ok: true, conflictsProcessed: count });
}));

module.exports = router;
