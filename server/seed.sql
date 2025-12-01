-- seed.sql (idempotent, FK-safe)

INSERT INTO films (name, iso, category, thumbPath)
SELECT 'Kodak Portra 400', 400, 'color-negative', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM films WHERE name = 'Kodak Portra 400' AND iso = 400 AND category = 'color-negative'
);

INSERT INTO rolls (title, start_date, end_date, camera, lens, photographer, filmId, film_type, exposures, coverPath, folderName, notes)
SELECT 'Sardinia trip', '2024-09-12','2024-09-12', 'Nikon FM2', '50mm 1.8', 'Junlong', f.id, NULL, NULL, NULL, NULL, 'Bright daylight, coastal'
FROM films f
WHERE f.name = 'Kodak Portra 400' AND f.iso = 400 AND f.category = 'color-negative'
  AND NOT EXISTS (SELECT 1 FROM rolls WHERE title = 'Sardinia trip')
LIMIT 1;

INSERT INTO photos (roll_id, frame_number, filename, full_rel_path, thumb_rel_path, caption, taken_at, rating)
SELECT r.id, '01', 'sardinia-01.jpg', 'rolls/roll-PLACEHOLDER/full/sardinia-01.jpg', 'rolls/roll-PLACEHOLDER/thumb/sardinia-01-thumb.jpg', 'Harbor morning', '2024-09-12T08:10:00', 4
FROM rolls r
WHERE r.title = 'Sardinia trip'
  AND NOT EXISTS (
    SELECT 1 FROM photos p WHERE p.roll_id = r.id AND p.filename = 'sardinia-01.jpg'
  );

INSERT INTO photos (roll_id, frame_number, filename, full_rel_path, thumb_rel_path, caption, taken_at, rating)
SELECT r.id, '02', 'sardinia-02.jpg', 'rolls/roll-PLACEHOLDER/full/sardinia-02.jpg', 'rolls/roll-PLACEHOLDER/thumb/sardinia-02-thumb.jpg', 'Old wall texture', '2024-09-12T09:02:00', 5
FROM rolls r
WHERE r.title = 'Sardinia trip'
  AND NOT EXISTS (
    SELECT 1 FROM photos p WHERE p.roll_id = r.id AND p.filename = 'sardinia-02.jpg'
  );

INSERT INTO tags (name)
SELECT '旅行'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE name = '旅行');

INSERT INTO photo_tags (photo_id, tag_id)
SELECT p.id, t.id
FROM photos p, tags t, rolls r
WHERE p.filename = 'sardinia-01.jpg'
  AND r.id = p.roll_id AND r.title = 'Sardinia trip'
  AND t.name = '旅行'
  AND NOT EXISTS (
    SELECT 1 FROM photo_tags pt WHERE pt.photo_id = p.id AND pt.tag_id = t.id
  );

