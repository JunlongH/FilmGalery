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

jest.mock('exiftool-vendored', () => ({
  exiftool: { read: jest.fn().mockResolvedValue(null) },
}));

// db-helpers.runAsync is used by execute()/processOne()/rollbackPartial;
// not touched by preview(), so safe to mock globally.
jest.mock('../../utils/db-helpers', () => ({
  runAsync: jest.fn(),
  allAsync: jest.fn(),
  getAsync: jest.fn(),
}));

// sharp is only used inside processOne() — preview() never touches it.
jest.mock('sharp', () => {
  const chain = {
    rotate: jest.fn().mockReturnThis(),
    clone: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue(undefined),
  };
  const factory = jest.fn(() => chain);
  factory.cache = jest.fn();
  return factory;
});

const PreparedStmt = require('../../utils/prepared-statements');
const dbHelpers = require('../../utils/db-helpers');
const digitalFileService = require('../digital-file-service');
const { exiftool } = require('exiftool-vendored');
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
    exiftool.read.mockReset();
    exiftool.read.mockResolvedValue(null);
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

  test('normalizes ExposureTime to canonical shutter strings', async () => {
    const cases = [
      ['1/125', '1/125'],   // exiftool fractional string — kept
      ['1/60', '1/60'],
      ['0.008', '1/125'],   // decimal-seconds string — converted
      [0.008, '1/125'],     // decimal-seconds number — converted
      [2.5, '2.5'],         // long exposure ≥ 1s — plain seconds
      ['30', '30'],
    ];
    const paths = await Promise.all(
      cases.map((_, i) => makeTmpFile(`sh-${i}`, `shutter-${i}`)),
    );
    tmpFiles = paths;
    cases.forEach(([raw], i) => {
      exiftool.read.mockResolvedValueOnce({ ExposureTime: raw });
    });

    const result = await service.preview(
      paths.map((p, i) => ({ path: p, originalname: `sh${i}.jpg`, size: 1 })),
    );

    expect(result.items.map((i) => i.exif && i.exif.exposureTime)).toEqual(
      cases.map(([, expected]) => expected),
    );
  });

  test('unparseable ExposureTime yields no exposureTime field (not NaN)', async () => {
    const fp = await makeTmpFile('bad-shutter', 'bad-shutter-content');
    tmpFiles = [fp];
    exiftool.read.mockResolvedValueOnce({ ExposureTime: 'Bulb' });

    const result = await service.preview([
      { path: fp, originalname: 'bad.jpg', size: 1 },
    ]);

    expect(result.items[0].exif).not.toBeNull();
    expect(result.items[0].exif.exposureTime).toBeUndefined();
  });
});

// ── execute() — cancellation cleanup ────────────────────────────────────────
//
// Cancellation mid-batch must not orphan files or leave a ghost session:
//   - per-photo: unlink display/thumb/original (best-effort) + hard-DELETE row
//   - session: soft-DELETE so it disappears from list/getById (filtered by
//     deleted_at IS NULL in prepared-statements.js)
//   - temp files: unlinked as usual
//
// fs.promises is left real for the preview tests above; we spyOn the methods
// processOne/rollbackPartial/cleanupTempFiles touch, scoped to this block.
describe('digital-import-service.execute — cancellation cleanup', () => {
  const fsp = fs.promises;
  let fspSpies;
  let ensureDirsSpy;
  let jobRegistry;

  beforeEach(() => {
    fspSpies = {
      access: jest.spyOn(fsp, 'access').mockResolvedValue(undefined),
      mkdir: jest.spyOn(fsp, 'mkdir').mockResolvedValue(undefined),
      copyFile: jest.spyOn(fsp, 'copyFile').mockResolvedValue(undefined),
      readFile: jest.spyOn(fsp, 'readFile').mockResolvedValue(Buffer.from('img-bytes')),
      unlink: jest.spyOn(fsp, 'unlink').mockResolvedValue(undefined),
    };
    ensureDirsSpy = jest.spyOn(digitalFileService, 'ensureDigitalDirs').mockResolvedValue(undefined);

    let photoId = 1;
    dbHelpers.runAsync.mockImplementation((sql) => {
      if (/INSERT INTO digital_sessions/.test(sql)) {
        return Promise.resolve({ lastID: 9001, changes: 1 });
      }
      if (/INSERT INTO photos/.test(sql)) {
        return Promise.resolve({ lastID: photoId++, changes: 1 });
      }
      return Promise.resolve({ changes: 1 });
    });

    jobRegistry = {
      start: jest.fn(),
      tick: jest.fn(),
      isCancelled: jest.fn().mockReturnValue(false),
      markCancelled: jest.fn(),
      complete: jest.fn(),
      fail: jest.fn(),
      recordError: jest.fn(),
      get: jest.fn().mockReturnValue(null),
    };
  });

  afterEach(() => {
    fspSpies.access.mockRestore();
    fspSpies.mkdir.mockRestore();
    fspSpies.copyFile.mockRestore();
    fspSpies.readFile.mockRestore();
    fspSpies.unlink.mockRestore();
    ensureDirsSpy.mockRestore();
    dbHelpers.runAsync.mockReset();
  });

  test('mid-batch cancel: unlinks 3 files per processed photo, hard-deletes rows, soft-deletes session, cleans tmp', async () => {
    // isCancelled is checked at the top of each loop iteration. Configure it
    // to return false twice (process photos 1 and 2), then true on the 3rd
    // check — triggering the cancel branch before item C is processed.
    let cancelCalls = 0;
    jobRegistry.isCancelled.mockImplementation(() => {
      cancelCalls += 1;
      return cancelCalls >= 3;
    });

    const items = [
      { file: { path: '/tmp/di-a.jpg', originalname: 'a.jpg', size: 10 }, hash: 'h1', duplicate: false, exif: {} },
      { file: { path: '/tmp/di-b.jpg', originalname: 'b.jpg', size: 10 }, hash: 'h2', duplicate: false, exif: {} },
      { file: { path: '/tmp/di-c.jpg', originalname: 'c.jpg', size: 10 }, hash: 'h3', duplicate: false, exif: {} },
    ];

    await service.execute({ items }, 'job-cancel-1', jobRegistry);

    // (a) Each processed photo's 3 relPaths were unlinked with abs paths.
    //     photoIds are assigned by the runAsync mock: 1, 2.
    for (const id of [1, 2]) {
      expect(fspSpies.unlink).toHaveBeenCalledWith(
        expect.stringContaining(`${id}_display.jpg`),
      );
      expect(fspSpies.unlink).toHaveBeenCalledWith(
        expect.stringContaining(`${id}_original.jpg`),
      );
      expect(fspSpies.unlink).toHaveBeenCalledWith(
        expect.stringContaining(`thumb/${id}_thumb.jpg`),
      );
    }

    // (b) Photos rows hard-deleted (DELETE, not UPDATE deleted_at).
    const deleteCalls = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /^DELETE FROM photos WHERE id = \?/.test(sql),
    );
    expect(deleteCalls).toHaveLength(2);
    const softDeleteCalls = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /^UPDATE photos SET deleted_at = CURRENT_TIMESTAMP WHERE id/.test(sql),
    );
    expect(softDeleteCalls).toHaveLength(0);

    // (c) Session soft-deleted by id.
    const sessionDelCalls = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /^UPDATE digital_sessions SET deleted_at = CURRENT_TIMESTAMP WHERE id = \? AND deleted_at IS NULL/.test(sql),
    );
    expect(sessionDelCalls).toHaveLength(1);
    expect(sessionDelCalls[0][1]).toEqual([9001]);

    // (d) Temp files cleaned for ALL items (including the unprocessed C).
    for (const p of ['/tmp/di-a.jpg', '/tmp/di-b.jpg', '/tmp/di-c.jpg']) {
      expect(fspSpies.unlink).toHaveBeenCalledWith(p);
    }

    // (e) Total unlink count: 2 photos × 3 files (rollback) + 3 temp files.
    expect(fspSpies.unlink).toHaveBeenCalledTimes(9);

    // Job is marked cancelled, not completed.
    expect(jobRegistry.markCancelled).toHaveBeenCalledWith('job-cancel-1');
    expect(jobRegistry.complete).not.toHaveBeenCalled();
  });

  test('cancel with zero photos processed: no file/row cleanup, session still soft-deleted', async () => {
    // isCancelled true on the very first check — nothing processed yet.
    jobRegistry.isCancelled.mockReturnValue(true);

    const items = [
      { file: { path: '/tmp/di-x.jpg', originalname: 'x.jpg', size: 10 }, hash: 'h1', duplicate: false, exif: {} },
    ];

    await service.execute({ items }, 'job-cancel-empty', jobRegistry);

    // No photo rows to delete, no display/thumb/original to unlink.
    const deleteCalls = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /^DELETE FROM photos WHERE id = \?/.test(sql),
    );
    expect(deleteCalls).toHaveLength(0);

    // Session was created, so it must be soft-deleted to avoid a ghost row.
    const sessionDelCalls = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /^UPDATE digital_sessions SET deleted_at = CURRENT_TIMESTAMP WHERE id = \? AND deleted_at IS NULL/.test(sql),
    );
    expect(sessionDelCalls).toHaveLength(1);

    // Temp cleanup still runs.
    expect(fspSpies.unlink).toHaveBeenCalledWith('/tmp/di-x.jpg');
    expect(jobRegistry.markCancelled).toHaveBeenCalledWith('job-cancel-empty');
  });

  test('processOne failure: hard-deletes orphan photo row, unlinks its 3 files, records error, continues to next item', async () => {
    // Make the FIRST sharp encode (item 1's display JPEG) reject. The chain
    // is a module-level singleton, so mockRejectedValueOnce serves exactly
    // one rejection; item 2's calls revert to the default resolved mock and
    // succeed — proving the loop continues past per-file failures.
    const sharpMock = require('sharp');
    sharpMock().toFile.mockRejectedValueOnce(new Error('sharp encode failed'));

    const items = [
      { file: { path: '/tmp/di-fail.jpg', originalname: 'fail.jpg', size: 10 }, hash: 'h1', duplicate: false, exif: {} },
      { file: { path: '/tmp/di-ok.jpg', originalname: 'ok.jpg', size: 10 }, hash: 'h2', duplicate: false, exif: {} },
    ];

    await service.execute({ items }, 'job-fail-1', jobRegistry);

    // (a) The orphan photo row from item 1 (photoId=1) was hard-deleted
    //     by processOne's self-cleanup; no soft-delete of photos.
    const deleteCalls = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /^DELETE FROM photos WHERE id = \?/.test(sql),
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][1]).toEqual([1]);
    const photoSoftDel = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /^UPDATE photos SET deleted_at = CURRENT_TIMESTAMP WHERE id/.test(sql),
    );
    expect(photoSoftDel).toHaveLength(0);

    // (b) Self-cleanup unlinked the 3 candidate abs paths for photoId=1.
    expect(fspSpies.unlink).toHaveBeenCalledWith(
      expect.stringContaining('1_display.jpg'),
    );
    expect(fspSpies.unlink).toHaveBeenCalledWith(
      expect.stringContaining('1_original.jpg'),
    );
    expect(fspSpies.unlink).toHaveBeenCalledWith(
      expect.stringContaining('thumb/1_thumb.jpg'),
    );

    // (c) recordError was called for item 1 with the underlying message.
    expect(jobRegistry.recordError).toHaveBeenCalledWith(
      'job-fail-1',
      'fail.jpg',
      expect.stringContaining('sharp encode failed'),
    );

    // (d) The loop continued to item 2 (photoId=2), which was published and
    //     had its paths UPDATE'd — proving the job doesn't abort on a single
    //     per-file failure.
    const photoUpdates = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /UPDATE photos SET original_rel_path/.test(sql),
    );
    expect(photoUpdates).toHaveLength(1);
    expect(photoUpdates[0][1]).toEqual([
      expect.stringContaining('2_original.jpg'),
      expect.stringContaining('2_display.jpg'),
      expect.stringContaining('thumb/2_thumb.jpg'),
      2,
    ]);

    // (e) Job completes (photoRows.length === 1, not 0 → no fail).
    expect(jobRegistry.complete).toHaveBeenCalledWith(
      'job-fail-1',
      expect.objectContaining({ imported: 1 }),
    );
    expect(jobRegistry.fail).not.toHaveBeenCalled();

    // (f) Total unlink count: 3 (self-cleanup of photoId=1) + 2 temp files.
    expect(fspSpies.unlink).toHaveBeenCalledTimes(5);
  });

  test('processOne splits EXIF datetime into date_taken/time_taken and stores canonical shutter speed', async () => {
    const items = [
      {
        file: { path: '/tmp/di-dt.jpg', originalname: 'dt.jpg', size: 10 },
        hash: 'h1',
        duplicate: false,
        exif: { dateTimeOriginal: '2026-08-07 14:30:05', exposureTime: '1/125' },
      },
      {
        file: { path: '/tmp/di-nodt.jpg', originalname: 'nodt.jpg', size: 10 },
        hash: 'h2',
        duplicate: false,
        exif: {},
      },
    ];

    await service.execute({ items }, 'job-dt-1', jobRegistry);

    const insertCalls = dbHelpers.runAsync.mock.calls.filter(
      ([sql]) => /INSERT INTO photos/.test(sql),
    );
    expect(insertCalls).toHaveLength(2);

    // Param order: sessionId, hash, filename, original_filename, date_taken,
    // time_taken, focal_length, aperture, shutter_speed, iso, ...
    const withDt = insertCalls[0][1];
    expect(withDt[4]).toBe('2026-08-07');
    expect(withDt[5]).toBe('14:30:05');
    expect(withDt[8]).toBe('1/125');

    const noDt = insertCalls[1][1];
    expect(noDt[4]).toBe(null);
    expect(noDt[5]).toBe(null);
    expect(noDt[8]).toBe(null);
  });
});
