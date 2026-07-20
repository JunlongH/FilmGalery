const express = require('express');
const router = express.Router();
const { allAsync } = require('../utils/db-helpers');
const { asyncHandler } = require('../utils/async-handler');

// simple search endpoint
router.get('/', asyncHandler(async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const rows = await allAsync(
    `SELECT * FROM rolls WHERE title LIKE ? OR camera LIKE ? OR photographer LIKE ? OR film_type LIKE ? ORDER BY start_date DESC`,
    [q, q, q, q]
  );
  res.json(rows);
}));

module.exports = router;
