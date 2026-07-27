/**
 * Digital Sessions Route — import batch / shooting day metadata.
 *
 * GET    /api/digital-sessions               — list (optional ?import_batch=)
 * GET    /api/digital-sessions/:id           — single
 * GET    /api/digital-sessions/:id/photos    — photos in session (404 if session is soft-deleted or missing)
 * PUT    /api/digital-sessions/:id           — update label/notes
 * DELETE /api/digital-sessions/:id           — soft delete (photos untouched)
 *
 * POST is NOT exposed — sessions are created internally by the import service.
 *
 * @module server/routes/digital-sessions
 */

const express = require('express');
const router = express.Router();
const PreparedStmt = require('../utils/prepared-statements');
const { runAsync, allAsync, getAsync } = require('../utils/db-helpers');

router.get('/', async (req, res, next) => {
  try {
    const importBatch = req.query.import_batch || null;
    const rows = await PreparedStmt.allAsync('digitalSessions.list', [importBatch, importBatch]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await PreparedStmt.getAsync('digitalSessions.getById', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Session not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/photos', async (req, res, next) => {
  try {
    const session = await PreparedStmt.getAsync('digitalSessions.getById', [req.params.id]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const rows = await allAsync(
      `SELECT p.*, ds.label AS session_label
       FROM photos p
       LEFT JOIN digital_sessions ds
         ON p.session_id = ds.id AND ds.deleted_at IS NULL
       WHERE p.session_id = ? AND p.deleted_at IS NULL
       ORDER BY p.date_taken ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { label, notes } = req.body;
    const existing = await getAsync('SELECT * FROM digital_sessions WHERE id = ? AND deleted_at IS NULL', [
      req.params.id,
    ]);
    if (!existing) return res.status(404).json({ error: 'Session not found' });

    await runAsync(
      `UPDATE digital_sessions SET label = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [
        label != null ? label : existing.label,
        notes != null ? notes : existing.notes,
        req.params.id,
      ]
    );
    const row = await getAsync('SELECT * FROM digital_sessions WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await runAsync(
      'UPDATE digital_sessions SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [req.params.id]
    );
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
