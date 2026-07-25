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

const { normalizeParams, deserializeLut } = require('../digital-develop-service');

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
