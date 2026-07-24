const express = require('express');
const router = express.Router();
const { allAsync, paginateQuery } = require('../utils/db-helpers');
const { attachTagsToPhotos } = require('../services/tag-service');
const { asyncHandler } = require('../utils/async-handler');

// tags listing
router.get('/', asyncHandler(async (req, res) => {
  const rows = await allAsync(`
    SELECT t.id, t.name, COUNT(pt.photo_id) AS photos_count,
           (SELECT COALESCE(p.positive_thumb_rel_path, p.thumb_rel_path) FROM photo_tags pt2 JOIN photos p ON p.id = pt2.photo_id WHERE pt2.tag_id = t.id ORDER BY p.id DESC LIMIT 1) as cover_thumb,
           (SELECT COALESCE(p.positive_rel_path, p.full_rel_path) FROM photo_tags pt2 JOIN photos p ON p.id = pt2.photo_id WHERE pt2.tag_id = t.id ORDER BY p.id DESC LIMIT 1) as cover_full
    FROM tags t
    LEFT JOIN photo_tags pt ON pt.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name COLLATE NOCASE
  `);
  res.json(rows);
}));

// photos filtered by tag
// Y.1 (P0-4): opt-in pagination via ?page=N&pageSize=M
router.get('/:tagId/photos', asyncHandler(async (req, res) => {
  const tagId = req.params.tagId;
  const sql = `
    SELECT p.*, COALESCE(f.name, r.film_type) AS film_name, r.title AS roll_title
    FROM photo_tags pt
    JOIN photos p ON p.id = pt.photo_id
    LEFT JOIN rolls r ON r.id = p.roll_id
    LEFT JOIN films f ON f.id = r.filmId
    WHERE pt.tag_id = ?
    ORDER BY p.id DESC
  `;
  const pageResult = await paginateQuery(sql, [tagId], req.query);
  const rows = pageResult.rows || (pageResult.payload && pageResult.payload.data) || [];
  const withTags = await attachTagsToPhotos(rows);
  if (pageResult.paginated) {
    res.json({ ...pageResult.payload, data: withTags });
  } else {
    res.setHeader('X-Total-Count', String(withTags.length));
    res.json(withTags);
  }
}));

module.exports = router;
