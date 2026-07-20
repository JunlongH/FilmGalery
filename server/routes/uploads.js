const express = require('express');
const router = express.Router();
const { uploadTmp } = require('../config/multer');

// New endpoint: upload multiple files to tmp (for preview)
// POST /api/uploads  (multipart form, field name "files")
// returns { ok:true, files: [{ originalName, tmpName, url }] }
router.post('/', uploadTmp.array('files', 100), (req, res, next) => {
  try {
    const uploaded = (req.files || []).map(f => ({
      originalName: f.originalname,
      tmpName: f.filename,
      tmpPath: f.path,
      url: `/uploads/tmp/${f.filename}`
    }));
    res.json({ ok: true, files: uploaded });
  } catch (err) {
    console.error('POST /api/uploads error', err);
    next(err);
  }
});

module.exports = router;
