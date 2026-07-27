/**
 * Digital Develop Route — light color grading for digital photos.
 *
 * POST /api/digital-develop/preview      — render preview JPEG
 * POST /api/digital-develop/save         — persist develop params + overwrite positive/thumb
 * POST /api/digital-develop/export       — render export-quality JPEG for download
 * GET  /api/digital-develop/:photoId/params — read saved develop params
 *
 * @module server/routes/digital-develop
 */

const express = require('express');
const router = express.Router();
const digitalDevelopService = require('../services/digital-develop-service');

// Render failures (missing source, decode/encode errors) are
// user-actionable — surface the real message instead of the masked 5xx.
function exposeRenderError(err, next) {
  if (err && typeof err === 'object' && !err.status) {
    err.status = 422;
  }
  next(err);
}

// POST /preview — body: { photo_id, params_json }
router.post('/preview', async (req, res, next) => {
  try {
    const { photo_id, params_json } = req.body;
    if (!photo_id) return res.status(400).json({ error: 'photo_id required' });
    const jpegBuf = await digitalDevelopService.renderPreview(photo_id, params_json);
    res.type('image/jpeg').send(jpegBuf);
  } catch (err) {
    exposeRenderError(err, next);
  }
});

// POST /save — body: { photo_id, params_json }
router.post('/save', async (req, res, next) => {
  try {
    const { photo_id, params_json } = req.body;
    if (!photo_id) return res.status(400).json({ error: 'photo_id required' });
    const result = await digitalDevelopService.save(photo_id, params_json);
    res.json({ ok: true, ...result });
  } catch (err) {
    exposeRenderError(err, next);
  }
});

// POST /export — body: { photo_id, params_json }
router.post('/export', async (req, res, next) => {
  try {
    const { photo_id, params_json } = req.body;
    if (!photo_id) return res.status(400).json({ error: 'photo_id required' });
    const { buffer } = await digitalDevelopService.renderExport(photo_id, params_json);
    const outBuffer = await digitalDevelopService.attachExifToJpegBuffer(buffer, photo_id);
    res.type('image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="photo_${photo_id}_export.jpg"`);
    res.send(outBuffer);
  } catch (err) {
    exposeRenderError(err, next);
  }
});

// GET /:photoId/params — read saved develop_params_json
router.get('/:photoId/params', async (req, res, next) => {
  try {
    const params = await digitalDevelopService.getParams(Number(req.params.photoId));
    res.json({ params });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
