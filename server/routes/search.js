const express = require('express');
const router = express.Router();
const db = require('../db');

// simple search endpoint
router.get('/', (req, res) => {
  const q = `%${(req.query.q||'').trim()}%`;
  db.all(`SELECT * FROM rolls WHERE title LIKE ? OR camera LIKE ? OR photographer LIKE ? OR film_type LIKE ? ORDER BY start_date DESC`, [q,q,q,q], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

module.exports = router;
