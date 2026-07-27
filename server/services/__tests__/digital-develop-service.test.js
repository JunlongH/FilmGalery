/**
 * Tests for digital-develop-service normalizeParams / deserializeLut.
 *
 * Locks the param-shaping contract the DigitalDevelop panel relies on:
 *   - crop → cropRect alias (legacy client key), crop key removed
 *   - inverted / filmCurveEnabled forced false (digital has no inversion/film curve)
 *   - temperature → temp alias (RenderCore WB key); explicit temp wins
 *   - lut1/lut2 payloads deserialized to Float32Array (photos.js parity)
 *   - curves / hslParams / splitToning pass through untouched
 *   - garbage JSON → {} (with forced flags)
 *
 * db-helpers is mocked so no SQLite connection is opened (roll-service.test.js pattern).
 */

jest.mock('../../utils/db-helpers', () => ({
  runAsync: jest.fn(),
  allAsync: jest.fn(),
  getAsync: jest.fn(),
}));

jest.mock('../../db', () => ({
  all: jest.fn((_sql, _params, cb) => cb(null, [])),
}));

jest.mock('../exif-service', () => ({
  buildExifData: jest.fn(() => ({ Make: 'Canon' })),
  writeExifWithExiftool: jest.fn().mockResolvedValue(true),
}));

jest.mock('../download-service', () => ({
  getPhotoWithRoll: jest.fn().mockResolvedValue({ id: 1, camera: 'Canon EOS R5' }),
}));

// Stub fs.promises so the helper does no real disk I/O. Default behavior
// simulates a successful round-trip: reads back the same buffer that was
// "written".
const mockFsp = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(null),
  unlink: jest.fn().mockResolvedValue(undefined),
};
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, promises: mockFsp };
});

const os = require('os');
const path = require('path');
const { normalizeParams, deserializeLut, attachExifToJpegBuffer } = require('../digital-develop-service');
const exifService = require('../exif-service');
const downloadService = require('../download-service');

describe('digital-develop-service normalizeParams', () => {
  test('crop alias maps to cropRect and removes crop key', () => {
    const out = normalizeParams({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } });
    expect(out.cropRect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(out.crop).toBeUndefined();
  });

  test('explicit cropRect wins over crop', () => {
    const out = normalizeParams({
      cropRect: { x: 0, y: 0, w: 0.25, h: 0.25 },
      crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    });
    expect(out.cropRect).toEqual({ x: 0, y: 0, w: 0.25, h: 0.25 });
  });

  test('crop: null (crop-tool full-frame preview) yields no cropRect', () => {
    const out = normalizeParams({ crop: null });
    expect(out.cropRect).toBeUndefined();
    expect(out.crop).toBeUndefined();
  });

  test('forces inverted=false and filmCurveEnabled=false', () => {
    const out = normalizeParams({ inverted: true, filmCurveEnabled: true });
    expect(out.inverted).toBe(false);
    expect(out.filmCurveEnabled).toBe(false);
  });

  test('temperature maps to temp and is removed', () => {
    const out = normalizeParams({ temperature: 35, tint: -10 });
    expect(out.temp).toBe(35);
    expect(out.temperature).toBeUndefined();
    expect(out.tint).toBe(-10);
  });

  test('explicit temp wins over temperature', () => {
    const out = normalizeParams({ temp: -20, temperature: 50 });
    expect(out.temp).toBe(-20);
    expect(out.temperature).toBeUndefined();
  });

  test('curves / hslParams / splitToning pass through by reference', () => {
    const curves = { rgb: [{ x: 0, y: 0 }, { x: 255, y: 200 }] };
    const hslParams = { red: { hue: 10, saturation: 5, luminance: 0 } };
    const splitToning = { highlights: { hue: 40, saturation: 20 }, shadows: { hue: 220, saturation: 15 }, balance: 10 };
    const out = normalizeParams({ curves, hslParams, splitToning });
    expect(out.curves).toBe(curves);
    expect(out.hslParams).toBe(hslParams);
    expect(out.splitToning).toBe(splitToning);
  });

  test('lut1 data array → Float32Array, intensity preserved, lut1Intensity derived', () => {
    const data = Array.from({ length: 3 * 2 * 2 * 2 }, (_, i) => (i % 6) / 2 * 0.5);
    const out = normalizeParams({ lut1: { name: 'a.cube', size: 2, data, intensity: 0.7 } });
    expect(out.lut1.size).toBe(2);
    expect(out.lut1.data).toBeInstanceOf(Float32Array);
    expect(Array.from(out.lut1.data)).toEqual(data);
    expect(out.lut1.intensity).toBe(0.7);
    expect(out.lut1Intensity).toBe(0.7);
  });

  test('explicit lut1Intensity wins over lut.intensity', () => {
    const out = normalizeParams({
      lut1: { size: 2, data: new Array(24).fill(0), intensity: 0.7 },
      lut1Intensity: 0.3,
    });
    expect(out.lut1Intensity).toBe(0.3);
  });

  test('invalid lut1 (no data) → null + neutral intensity', () => {
    const out = normalizeParams({ lut1: { name: 'broken.cube' } });
    expect(out.lut1).toBeNull();
    expect(out.lut1Intensity).toBe(1.0);
  });

  test('lut2 deserialized like lut1', () => {
    const out = normalizeParams({ lut2: { size: 2, data: new Array(24).fill(0) } });
    expect(out.lut2.data).toBeInstanceOf(Float32Array);
    expect(out.lut2Intensity).toBe(1.0);
  });

  test('JSON string input is parsed', () => {
    const out = normalizeParams(JSON.stringify({ exposure: 15, temperature: 10 }));
    expect(out.exposure).toBe(15);
    expect(out.temp).toBe(10);
  });

  test('object input is defensively copied (caller object not mutated)', () => {
    const input = { crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, temperature: 20 };
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = normalizeParams(input);
    expect(input).toEqual(snapshot);
    expect(out.cropRect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  });

  test('garbage input → defaults with forced flags', () => {
    for (const input of ['{not json', null, undefined]) {
      const out = normalizeParams(input);
      expect(out.inverted).toBe(false);
      expect(out.filmCurveEnabled).toBe(false);
      expect(out.cropRect).toBeUndefined();
    }
  });
});

describe('digital-develop-service deserializeLut', () => {
  test('keeps Float32Array data as-is', () => {
    const f32 = new Float32Array([0.1, 0.2, 0.3]);
    const lut = deserializeLut({ size: 1, data: f32 });
    expect(lut.data).toBe(f32);
  });

  test('null / missing fields → null', () => {
    expect(deserializeLut(null)).toBeNull();
    expect(deserializeLut({})).toBeNull();
    expect(deserializeLut({ size: 2 })).toBeNull();
    expect(deserializeLut({ data: [1, 2, 3] })).toBeNull();
  });

  test('data shorter than 3 * size^3 → null (truncated LUT guard)', () => {
    expect(deserializeLut({ size: 2, data: [0, 0, 0, 1, 1, 1] })).toBeNull();
    expect(deserializeLut({ size: 2, data: new Array(24).fill(0) })).not.toBeNull();
  });
});

describe('digital-develop-service attachExifToJpegBuffer', () => {
  const inputBuf = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02, 0x03]);

  beforeEach(() => {
    jest.clearAllMocks();
    downloadService.getPhotoWithRoll.mockResolvedValue({ id: 1, camera: 'Canon EOS R5' });
    exifService.buildExifData.mockReturnValue({ Make: 'Canon', Model: 'EOS R5' });
    exifService.writeExifWithExiftool.mockResolvedValue(true);
    mockFsp.readFile.mockResolvedValue(inputBuf);
  });

  test('happy path: writes temp file, builds EXIF, writes via exiftool, returns rewritten buffer', async () => {
    const rewritten = Buffer.concat([inputBuf, Buffer.from('EXIF-OK')]);
    mockFsp.readFile.mockResolvedValue(rewritten);

    const out = await attachExifToJpegBuffer(inputBuf, 42);

    expect(out).toBeInstanceOf(Buffer);
    expect(out).toBe(rewritten);
    expect(downloadService.getPhotoWithRoll).toHaveBeenCalledWith(42);
    expect(exifService.buildExifData).toHaveBeenCalledWith({ id: 1, camera: 'Canon EOS R5' }, null, {});
    expect(exifService.writeExifWithExiftool).toHaveBeenCalledTimes(1);
    const [tempPath, exifData, opts] = exifService.writeExifWithExiftool.mock.calls[0];
    expect(tempPath).toContain(path.join(os.tmpdir(), 'filmgallery-export'));
    expect(tempPath).toMatch(/photo_42_\d+_[0-9a-f]{8}\.jpg$/);
    expect(exifData).toEqual({ Make: 'Canon', Model: 'EOS R5' });
    expect(opts).toMatchObject({ keywords: [] });
    expect(mockFsp.writeFile).toHaveBeenCalledWith(tempPath, inputBuf);
    expect(mockFsp.unlink).toHaveBeenCalledWith(tempPath);
  });

  test('EXIF write failure → returns the ORIGINAL buffer (export never fails on metadata)', async () => {
    exifService.writeExifWithExiftool.mockRejectedValue(new Error('exiftool missing'));

    const out = await attachExifToJpegBuffer(inputBuf, 7);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(inputBuf.length);
  });

  test('photo not found → returns ORIGINAL buffer without attempting EXIF write', async () => {
    downloadService.getPhotoWithRoll.mockResolvedValue(null);

    const out = await attachExifToJpegBuffer(inputBuf, 99);
    expect(out.length).toBe(inputBuf.length);
    expect(exifService.writeExifWithExiftool).not.toHaveBeenCalled();
  });

  test('temp dir path matches download-service convention', async () => {
    await attachExifToJpegBuffer(inputBuf, 5);
    const mkdirPath = mockFsp.mkdir.mock.calls[0][0];
    expect(mkdirPath).toBe(path.join(os.tmpdir(), 'filmgallery-export'));
  });
});
