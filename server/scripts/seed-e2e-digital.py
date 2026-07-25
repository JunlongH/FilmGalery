import sqlite3, os, math
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'film.db')
UP = os.path.join(ROOT, 'uploads', 'digital', '2026-07')
os.makedirs(os.path.join(UP, 'thumb'), exist_ok=True)

db = sqlite3.connect(DB)
db.execute("DELETE FROM photos WHERE source_type='digital'")
db.execute("DELETE FROM digital_sessions")
db.execute("DELETE FROM album_photos")
db.execute("DELETE FROM albums")

db.execute(
    "INSERT INTO digital_sessions (id, import_batch, session_date, label, file_count, total_size_bytes, import_source, created_at, updated_at) VALUES (1, 'e2e-batch-1', '2026-07-19', 'E2E Seed Import', 9, 12345678, 'e2e', datetime('now'), datetime('now'))")

colors = [(196,80,80),(80,130,196),(90,160,100),(210,170,60),(150,90,180),(70,170,170),(220,120,80),(120,120,120),(180,140,110)]
gps = [(44.0,9.0),(44.01,9.01),(44.02,9.0),None,(45.5,9.2),None,None,(44.05,9.05),None]
cams = [('Sony','ILCE-7M4','FE 35mm F1.4 GM'),('Fujifilm','X-T5','XF23mmF1.4 R LM WR'),('Canon','EOS R6','RF50mm F1.8 STM')]

ids = []
for i in range(9):
    n = i + 1
    cur = db.execute(
        """INSERT INTO photos (filename, source_type, session_id, date_taken, taken_at, camera, lens,
           source_make, source_model, source_lens, iso, aperture, shutter_speed, focal_length,
           latitude, longitude, rating, created_at, updated_at, original_filename)
           VALUES (?, 'digital', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)""",
        (f'e2e_{n:02d}.jpg', f'2026-07-{10+n:02d}', f'2026-07-{10+n:02d}T{10+n}:30:00',
         cams[i%3][1], cams[i%3][2], cams[i%3][0], cams[i%3][1], cams[i%3][2],
         [100,200,400,800][i%4], round(1.4+0.5*(i%5),1), ['1/125','1/250','1/60','1/500'][i%4], [23,35,50,85][i%4],
         gps[i][0] if gps[i] else None, gps[i][1] if gps[i] else None,
         5 if i%3==0 else 0, f'e2e_{n:02d}.jpg'))
    pid = cur.lastrowid
    ids.append(pid)

    img = Image.new('RGB', (1200, 800), colors[i])
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 1160, 760], outline=(255,255,255), width=8)
    d.text((80, 80), f'E2E {n:02d}', fill=(255,255,255))
    img.save(os.path.join(UP, f'{pid}_original.jpg'), quality=88)
    img.save(os.path.join(UP, f'{pid}_display.jpg'), quality=88)
    img.resize((400, 267)).save(os.path.join(UP, 'thumb', f'{pid}_thumb.jpg'), quality=85)

    db.execute(
        "UPDATE photos SET original_rel_path=?, positive_rel_path=?, thumb_rel_path=? WHERE id=?",
        (f'digital/2026-07/{pid}_original.jpg', f'digital/2026-07/{pid}_display.jpg',
         f'digital/2026-07/thumb/{pid}_thumb.jpg', pid))

db.execute("INSERT INTO albums (id, title, parent_id, cover_photo_id, created_at, updated_at) VALUES (1, 'E2E Travel', NULL, ?, datetime('now'), datetime('now'))", (ids[0],))
db.execute("INSERT INTO albums (id, title, parent_id, cover_photo_id, created_at, updated_at) VALUES (2, 'E2E Coast', 1, ?, datetime('now'), datetime('now'))", (ids[1],))
for j, pid in enumerate(ids[:5]):
    db.execute('INSERT INTO album_photos (album_id, photo_id, sort_order) VALUES (1, ?, ?)', (pid, j))
for j, pid in enumerate(ids[1:4]):
    db.execute('INSERT INTO album_photos (album_id, photo_id, sort_order) VALUES (2, ?, ?)', (pid, j))

db.commit()
print('digital photos:', db.execute("SELECT COUNT(*) FROM photos WHERE source_type='digital'").fetchone()[0], 'ids', ids)
print('albums:', db.execute('SELECT id, title, parent_id FROM albums').fetchall())
print('album_photos:', db.execute('SELECT COUNT(*) FROM album_photos').fetchone()[0])
print('sessions:', db.execute('SELECT id, label, file_count FROM digital_sessions').fetchall())
