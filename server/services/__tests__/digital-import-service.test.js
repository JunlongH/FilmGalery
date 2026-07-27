/**
 * Tests for digital-import-service.preview() — the server-side analysis step
 * that hashes + dedups + EXIFs each uploaded file.
 *
 * Locks the multi-file contract: preview() must iterate ALL files
 * deterministically (single-shape loop, no shared mutable state that breaks
 * under batch). Regression guard for the mobile "multi-photo import fails to
 * reach reviewing" symptom — the service side must not be the cause.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

jest.mock('../../utils/prepared-statements', () => ({
  getAsync: jest.fn().mockResolvedValue(null),
  allAsync: jest.fn().mockResolvedValue([]),
}));

const PreparedStmt = require('../../utils/prepared-statements');
const service = require('../digital-import-service');

async function makeTmpFile(name, content) {
  const filePath = path.join(os.tmpdir(), `dit-${Date.now()}-${name}`);
  await fs.promises.writeFile(filePath, Buffer.from(content));
  return filePath;
}

describe('digital-import-service.preview — multi-file', () => {
  let tmpFiles = [];
  afterEach(async () => {
    await Promise.all(
      tmpFiles.map((f) => fs.promises.unlink(f).catch(() => {})),
    );
    tmpFiles = [];
    PreparedStmt.getAsync.mockReset();
    PreparedStmt.getAsync.mockResolvedValue(null);
  });

  test('processes multiple JPEG files, returns correct per-item shape', async () => {
    const paths = await Promise.all([
      makeTmpFile('a.jpg', 'jpeg-bytes-A'),
      makeTmpFile('b.jpg', 'jpeg-bytes-B'),
      makeTmpFile('c.jpg', 'jpeg-bytes-C'),
    ]);
    tmpFiles = paths;

    const files = paths.map((p, i) => ({
      path: p,
      originalname: `photo${i + 1}.jpg`,
      size: 12,
    }));

    const result = await service.preview(files);

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.duplicates).toBe(0);
    expect(result.jpeg).toBe(3);
    expect(result.raws).toBe(0);
    expect(result.rawUnsupported).toBe(0);
    result.items.forEach((item, i) => {
      expect(item.file.originalname).toBe(`photo${i + 1}.jpg`);
      expect(typeof item.hash).toBe('string');
      expect(item.hash).toHaveLength(64); // sha256 hex
      expect(item.duplicate).toBe(false);
      expect(item.existingId).toBe(null);
      expect(item.isRaw).toBe(false);
      expect(item.rawSupported).toBe(null);
    });
  });

  test('computes distinct sha256 hashes per distinct file content', async () => {
    const paths = await Promise.all([
      makeTmpFile('u1', 'unique-content-one'),
      makeTmpFile('u2', 'unique-content-two'),
    ]);
    tmpFiles = paths;

    const result = await service.preview(
      paths.map((p, i) => ({ path: p, originalname: `u${i}.jpg`, size: 1 })),
    );

    const hashes = result.items.map((i) => i.hash);
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  test('flags duplicate when PreparedStmt returns an existing row', async () => {
    const fp = await makeTmpFile('dup', 'dup-content');
    tmpFiles = [fp];
    PreparedStmt.getAsync.mockResolvedValueOnce({ id: 42 });

    const result = await service.preview([
      { path: fp, originalname: 'dup.jpg', size: 1 },
    ]);

    expect(result.duplicates).toBe(1);
    expect(result.items[0].duplicate).toBe(true);
    expect(result.items[0].existingId).toBe(42);
  });

  test('excludes duplicates from exif_summary', async () => {
    const a = await makeTmpFile('sum-a', 'content-a');
    const b = await makeTmpFile('sum-b', 'content-b');
    tmpFiles = [a, b];
    PreparedStmt.getAsync
      .mockResolvedValueOnce({ id: 7 }) // first is dup
      .mockResolvedValueOnce(null); // second is new

    const result = await service.preview([
      { path: a, originalname: 'a.jpg', size: 1 },
      { path: b, originalname: 'b.jpg', size: 1 },
    ]);

    expect(result.duplicates).toBe(1);
    // summarizeExif runs on non-duplicates only — must not crash and must
    // return a summary object. With EXIF unavailable/empty the camera name
    // falls back to 'Unknown'; we only assert shape here, not specific values.
    expect(result.exif_summary).toEqual(
      expect.objectContaining({ dateRange: null, hasGps: false }),
    );
    expect(Array.isArray(result.exif_summary.cameras)).toBe(true);
  });

  test('handles a large batch (20 files) without state corruption', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `batch-${i}.jpg`);
    const paths = await Promise.all(
      names.map((n, i) => makeTmpFile(n, `content-${i}`)),
    );
    tmpFiles = paths;

    const result = await service.preview(
      paths.map((p, i) => ({ path: p, originalname: names[i], size: 10 })),
    );

    expect(result.total).toBe(20);
    expect(result.items).toHaveLength(20);
    // Every item must have a hash and an originalname
    expect(result.items.every((i) => i.hash && i.file.originalname)).toBe(true);
    // Filenames preserved in order
    expect(result.items.map((i) => i.file.originalname)).toEqual(names);
  });
});
