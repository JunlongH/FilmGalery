const express = require('express');
const router = express.Router();
const { allAsync, paginateQuery } = require('../utils/db-helpers');
const { attachTagsToPhotos } = require('../services/tag-service');
const { asyncHandler } = require('../utils/async-handler');
const { buildSourceTypeClause } = require('../../packages/shared/photographyMode');

// tags listing
// Optional `mode` query param (film / digital / all): when present, photo
// counts and cover picks only consider photos of that source_type. Without
// it the response is identical to the pre-mode behavior.
router.get('/', asyncHandler(async (req, res) => {
  const { clause } = buildSourceTypeClause(req.query.mode);
  const modeFilter = clause ? `AND ${clause}` : '';
  const photoJoin = `LEFT JOIN photos p ON p.id = pt.photo_id AND p.deleted_at IS NULL ${modeFilter}`;
  const rows = await allAsync(`
    SELECT t.id, t.name, COUNT(p.id) AS photos_count,
           (SELECT COALESCE(p.positive_thumb_rel_path, p.thumb_rel_path) FROM photo_tags pt2 JOIN photos p ON p.id = pt2.photo_id WHERE pt2.tag_id = t.id AND p.deleted_at IS NULL ${modeFilter} ORDER BY p.id DESC LIMIT 1) as cover_thumb,
           (SELECT COALESCE(p.positive_rel_path, p.full_rel_path) FROM photo_tags pt2 JOIN photos p ON p.id = pt2.photo_id WHERE pt2.tag_id = t.id AND p.deleted_at IS NULL ${modeFilter} ORDER BY p.id DESC LIMIT 1) as cover_full
    FROM tags t
    LEFT JOIN photo_tags pt ON pt.tag_id = t.id
    ${photoJoin}
    GROUP BY t.id
    HAVING photos_count > 0
    ORDER BY t.name COLLATE NOCASE
  `);
  res.json(rows);
}));

// photos filtered by tag
// Y.1 (P0-4): opt-in pagination via ?page=N&pageSize=M
// Optional `mode` query param (film / digital / all) filters by source_type.
router.get('/:tagId/photos', asyncHandler(async (req, res) => {
  const tagId = req.params.tagId;
  const { clause } = buildSourceTypeClause(req.query.mode);
  let sql = `
    SELECT p.*, COALESCE(f.name, r.film_type) AS film_name, r.title AS roll_title
    FROM photo_tags pt
    JOIN photos p ON p.id = pt.photo_id
    LEFT JOIN rolls r ON r.id = p.roll_id
    LEFT JOIN films f ON f.id = r.filmId
    WHERE pt.tag_id = ? AND p.deleted_at IS NULL
  `;
  if (clause) sql += ` AND ${clause}`;
  sql += ` ORDER BY p.id DESC`;
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
