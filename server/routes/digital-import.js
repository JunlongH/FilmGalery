/**
 * Digital Import Route — two-phase import wizard backend.
 *
 * POST   /api/digital/import/preview          — multipart files → EXIF + hash + dedup + RAW probe
 * POST   /api/digital/import/execute          — async import (returns jobId)
 * GET    /api/digital/import/:jobId/progress  — poll job status
 * POST   /api/digital/import/:jobId/cancel    — cancel running job
 * POST   /api/digital/import/check-hash       — single-file duplicate check
 *
 * @module server/routes/digital-import
 */

const express = require('express');
const router = express.Router();
const { uploadTmp } = require('../config/multer');
const digitalImportService = require('../services/digital-import-service');
const importJobs = require('../services/import-job-registry');
const PreparedStmt = require('../utils/prepared-statements');

// POST /preview — multipart upload (files[]), returns preview analysis
router.post('/preview', (req, res, next) => {
  const cpUpload = uploadTmp.array('files', 500);
  cpUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }
      const result = await digitalImportService.preview(req.files);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
});

// POST /execute — async import (body: {items, session_title, album_id?})
router.post('/execute', async (req, res, next) => {
  try {
    const { items, session_title, album_id } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }
    const jobId = importJobs.create({ total: items.length });
    // Fire-and-forget — client polls progress
    digitalImportService
      .execute({ items, session_title, album_id }, jobId, importJobs)
      .catch((e) => {
        try {
          const msg = e && e.message ? e.message : String(e);
          importJobs.fail(jobId, msg);
        } catch (_) {
          console.error(`[digital-import] Failed to record failure for job ${jobId}:`, e);
        }
      });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    next(err);
  }
});

// GET /:jobId/progress
router.get('/:jobId/progress', async (req, res, next) => {
  try {
    const job = importJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(importJobs.status(req.params.jobId));
  } catch (err) {
    next(err);
  }
});

// POST /:jobId/cancel
router.post('/:jobId/cancel', async (req, res, next) => {
  try {
    const cancelled = importJobs.cancel(req.params.jobId);
    if (!cancelled) {
      return res.status(404).json({ error: 'Job not found or already completed' });
    }
    res.json({ ok: true, jobId: req.params.jobId });
  } catch (err) {
    next(err);
  }
});

// POST /check-hash — body: { hash }
router.post('/check-hash', async (req, res, next) => {
  try {
    const { hash } = req.body;
    if (!hash) return res.status(400).json({ error: 'hash required' });
    const existing = await PreparedStmt.getAsync('photos.checkHash', [hash]);
    res.json({ duplicate: !!existing, existingId: existing ? existing.id : null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
