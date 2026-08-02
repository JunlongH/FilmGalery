/**
 * Albums Route — CRUD, nested hierarchy, M2M photos.
 *
 * GET    /api/albums                         — list (optional ?parent_id=, ?photo_id=, ?include_deleted=)
 * GET    /api/albums/:id                     — single
 * GET    /api/albums/:id/photos              — photos in album
 * POST   /api/albums                         — create
 * PUT    /api/albums/:id                     — update
 * DELETE /api/albums/:id                     — soft delete (or ?hard=true)
 * POST   /api/albums/:id/restore             — restore soft-deleted
 * POST   /api/albums/:id/cover               — set cover photo
 * POST   /api/albums/:id/photos              — batch add photos
 * DELETE /api/albums/:id/photos/:photoId     — remove photo from album
 * PUT    /api/albums/:id/photos/sort         — reorder photos
 *
 * @module server/routes/albums
 */

const express = require('express');
const router = express.Router();
const PreparedStmt = require('../utils/prepared-statements');
const { runAsync, getAsync, allAsync } = require('../utils/db-helpers');
const { attachTagsToPhotos } = require('../services/tag-service');

// ── Cycle detection ─────────────────────────────────────────────────────────

/**
 * Walk the parent_id chain to detect a cycle.
 * @param {number} albumId - the album whose parent is being set
 * @param {number|null} newParentId - the proposed parent
 * @returns {Promise<boolean>}
 */
async function detectCycle(albumId, newParentId) {
  if (newParentId == null) return false;
  let cur = newParentId;
  const seen = new Set();
  while (cur != null && !seen.has(cur)) {
    if (cur === albumId) return true;
    seen.add(cur);
    const row = await getAsync('SELECT parent_id FROM albums WHERE id = ?', [cur]);
    cur = row ? row.parent_id : null;
  }
  return false;
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    let parentId;
    if (req.query.parent_id === 'null' || req.query.parent_id === undefined) {
      parentId = null;
    } else {
      parentId = Number(req.query.parent_id);
      if (!Number.isFinite(parentId)) {
        return res.status(400).json({ error: 'parent_id must be a number or null' });
      }
    }
    const includeDeleted = req.query.include_deleted === 'true';
    if (req.query.photo_id !== undefined) {
      const photoId = Number(req.query.photo_id);
      if (!Number.isFinite(photoId)) {
        return res.status(400).json({ error: 'photo_id must be a number' });
      }
      const rows = await allAsync(
        `SELECT a.*,
                (SELECT thumb_rel_path FROM photos WHERE id = a.cover_photo_id) AS cover_thumb,
                (SELECT COUNT(*) FROM album_photos apc
                 JOIN photos pc ON pc.id = apc.photo_id AND pc.deleted_at IS NULL
                 WHERE apc.album_id = a.id) AS photo_count
         FROM albums a
         JOIN album_photos ap ON ap.album_id = a.id AND ap.photo_id = ?
         WHERE (? = 1 OR a.deleted_at IS NULL) AND (? IS NULL OR a.parent_id = ?)
         ORDER BY a.sort_order, a.updated_at DESC`,
        [photoId, includeDeleted ? 1 : 0, parentId, parentId]
      );
      return res.json(rows);
    }
    const rows = await PreparedStmt.allAsync('albums.list', [includeDeleted ? 1 : 0, parentId, parentId]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── Single ──────────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const album = await getAsync(
      `SELECT * FROM albums WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!album) return res.status(404).json({ error: 'Album not found' });
    res.json(album);
  } catch (err) {
    next(err);
  }
});

// ── Photos in album ─────────────────────────────────────────────────────────

router.get('/:id/photos', async (req, res, next) => {
  try {
    let rows;
    if (req.query.recursive === '1') {
      // Aggregated photos from this album AND all descendants (parent_id tree).
      // Depth cap (32) defends against legacy cycles; deleted descendants are
      // pruned. DISTINCT because a photo may belong to multiple sub-albums.
      // Note: ap columns are intentionally NOT selected — they would break
      // dedup (same photo, different per-album sort_order/added_at).
      rows = await allAsync(
        `WITH RECURSIVE sub(id, depth) AS (
            SELECT ?, 0
            UNION
            SELECT a.id, sub.depth + 1
            FROM albums a JOIN sub ON a.parent_id = sub.id
            WHERE sub.depth < 31 AND a.deleted_at IS NULL
         )
         SELECT DISTINCT p.*,
                r.title AS roll_title,
                ds.label AS session_label, ds.session_date
         FROM sub
         JOIN album_photos ap ON ap.album_id = sub.id
         JOIN photos p ON ap.photo_id = p.id
         LEFT JOIN rolls r ON p.roll_id = r.id
         LEFT JOIN digital_sessions ds
           ON p.session_id = ds.id AND ds.deleted_at IS NULL
         WHERE p.deleted_at IS NULL
         ORDER BY p.date_taken ASC NULLS LAST, p.id ASC`,
        [req.params.id]
      );
    } else if (req.query.sort === 'date_taken') {
      rows = await allAsync(
        `SELECT p.*, ap.sort_order AS album_sort_order, ap.added_at AS album_added_at,
                r.title AS roll_title,
                ds.label AS session_label, ds.session_date
         FROM album_photos ap
         JOIN photos p ON ap.photo_id = p.id
         LEFT JOIN rolls r ON p.roll_id = r.id
         LEFT JOIN digital_sessions ds
           ON p.session_id = ds.id AND ds.deleted_at IS NULL
         WHERE ap.album_id = ? AND p.deleted_at IS NULL
         ORDER BY p.date_taken ASC NULLS LAST, p.id ASC`,
        [req.params.id]
      );
    } else {
      rows = await PreparedStmt.allAsync('albums.photos', [req.params.id]);
    }
    res.json(await attachTagsToPhotos(rows));
  } catch (err) {
    next(err);
  }
});

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { title, description, parent_id, date_start, date_end, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    const pid = parent_id != null ? Number(parent_id) : null;
    if (pid != null) {
      const exists = await getAsync('SELECT id FROM albums WHERE id = ? AND deleted_at IS NULL', [pid]);
      if (!exists) return res.status(400).json({ error: 'Parent album not found' });
    }

    const result = await runAsync(
      `INSERT INTO albums (title, description, parent_id, date_start, date_end, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description || null, pid, date_start || null, date_end || null, sort_order || 0]
    );
    const album = await getAsync('SELECT * FROM albums WHERE id = ?', [result.lastID]);
    res.status(201).json(album);
  } catch (err) {
    next(err);
  }
});

// ── Update ──────────────────────────────────────────────────────────────────

router.put('/:id', async (req, res, next) => {
  try {
    const albumId = Number(req.params.id);
    const existing = await getAsync('SELECT * FROM albums WHERE id = ? AND deleted_at IS NULL', [albumId]);
    if (!existing) return res.status(404).json({ error: 'Album not found' });

    const { title, description, date_start, date_end, sort_order } = req.body;
    let pid;
    if (!Object.prototype.hasOwnProperty.call(req.body, 'parent_id')) {
      pid = existing.parent_id;
    } else if (req.body.parent_id === null) {
      pid = null;
    } else {
      pid = Number(req.body.parent_id);
      if (!Number.isFinite(pid)) {
        return res.status(400).json({ error: 'parent_id must be a number or null' });
      }
    }

    if (pid != null && pid !== existing.parent_id) {
      const exists = await getAsync('SELECT id FROM albums WHERE id = ? AND deleted_at IS NULL', [pid]);
      if (!exists) return res.status(400).json({ error: 'Parent album not found' });
      if (await detectCycle(albumId, pid)) {
        return res.status(400).json({ error: 'Circular parent reference detected' });
      }
    }

    await runAsync(
      `UPDATE albums SET title = ?, description = ?, parent_id = ?, date_start = ?, date_end = ?,
         sort_order = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        title != null ? title : existing.title,
        description != null ? description : existing.description,
        pid,
        date_start != null ? date_start : existing.date_start,
        date_end != null ? date_end : existing.date_end,
        sort_order != null ? sort_order : existing.sort_order,
        albumId,
      ]
    );
    const album = await getAsync('SELECT * FROM albums WHERE id = ?', [albumId]);
    res.json(album);
  } catch (err) {
    next(err);
  }
});

// ── Delete (soft or hard) ───────────────────────────────────────────────────

router.delete('/:id', async (req, res, next) => {
  try {
    const albumId = Number(req.params.id);
    if (req.query.hard === 'true') {
      const existing = await getAsync('SELECT id FROM albums WHERE id = ?', [albumId]);
      if (!existing) return res.status(404).json({ error: 'Album not found' });
      await runAsync('DELETE FROM album_photos WHERE album_id = ?', [albumId]);
      await runAsync('UPDATE albums SET parent_id = NULL WHERE parent_id = ?', [albumId]);
      await runAsync('DELETE FROM albums WHERE id = ?', [albumId]);
    } else {
      const result = await runAsync(
        'UPDATE albums SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [albumId]
      );
      if (result.changes === 0) return res.status(404).json({ error: 'Album not found' });
    }
    res.json({ ok: true, id: albumId });
  } catch (err) {
    next(err);
  }
});

// ── Restore ─────────────────────────────────────────────────────────────────

router.post('/:id/restore', async (req, res, next) => {
  try {
    const albumId = Number(req.params.id);
    await runAsync(
      'UPDATE albums SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [albumId]
    );
    const album = await getAsync('SELECT * FROM albums WHERE id = ?', [albumId]);
    res.json(album);
  } catch (err) {
    next(err);
  }
});

// ── Set cover ───────────────────────────────────────────────────────────────

router.post('/:id/cover', async (req, res, next) => {
  try {
    const albumId = Number(req.params.id);
    const photoId = req.body.photo_id;
    if (!photoId) return res.status(400).json({ error: 'photo_id required' });
    await runAsync(
      'UPDATE albums SET cover_photo_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [photoId, albumId]
    );
    res.json({ ok: true, albumId, cover_photo_id: photoId });
  } catch (err) {
    next(err);
  }
});

// ── Batch add photos ────────────────────────────────────────────────────────

router.post('/:id/photos', async (req, res, next) => {
  try {
    const albumId = Number(req.params.id);
    const photoIds = Array.isArray(req.body.photo_ids) ? req.body.photo_ids : [];
    if (photoIds.length === 0) {
      return res.status(400).json({ error: 'photo_ids array required' });
    }
    const placeholders = photoIds.map(() => '?').join(',');
    const countRow = await getAsync(
      `SELECT COUNT(*) AS cnt FROM photos WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      photoIds
    );
    const validCount = countRow ? countRow.cnt : 0;
    await runAsync('BEGIN');
    let inserted = 0;
    try {
      for (const pid of photoIds) {
        const r = await runAsync(
          'INSERT OR IGNORE INTO album_photos (album_id, photo_id, sort_order) VALUES (?, ?, 0)',
          [albumId, pid]
        );
        if (r.changes > 0) inserted++;
      }
      await runAsync('COMMIT');
    } catch (e) {
      await runAsync('ROLLBACK').catch(() => {});
      throw e;
    }
    res.json({ ok: true, added: inserted, requested: photoIds.length, valid_photos: validCount });
  } catch (err) {
    next(err);
  }
});

// ── Remove photo from album ─────────────────────────────────────────────────

router.delete('/:id/photos/:photoId', async (req, res, next) => {
  try {
    const result = await runAsync(
      'DELETE FROM album_photos WHERE album_id = ? AND photo_id = ?',
      [Number(req.params.id), Number(req.params.photoId)]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Photo not in album' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Reorder photos ──────────────────────────────────────────────────────────

router.put('/:id/photos/sort', async (req, res, next) => {
  try {
    const albumId = Number(req.params.id);
    const photoIds = Array.isArray(req.body.photo_ids) ? req.body.photo_ids : [];
    if (photoIds.length === 0) {
      return res.status(400).json({ error: 'photo_ids array required' });
    }
    await runAsync('BEGIN');
    try {
      for (let i = 0; i < photoIds.length; i++) {
        await runAsync(
          'UPDATE album_photos SET sort_order = ? WHERE album_id = ? AND photo_id = ?',
          [i, albumId, photoIds[i]]
        );
      }
      await runAsync('COMMIT');
    } catch (e) {
      await runAsync('ROLLBACK').catch(() => {});
      throw e;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
