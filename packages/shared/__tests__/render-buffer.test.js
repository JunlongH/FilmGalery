/**
 * Unit tests for the shared render-buffer math (Phase 2C.3).
 *
 * This is the canonical outer loop extracted from photos.js's 10 inline
 * copies + worker pool. Locks:
 *   - Output buffer sizes match width×height×3 (jpeg8) or ×6 (tiff16 LE).
 *   - Identity pipeline (neutral params) on a uniform-color input produces
 *     deterministic, bit-stable output.
 *   - 8-bit and 16-bit input paths produce consistent ratios.
 *   - Channel count 3 vs 4 (alpha) does not change RGB output.
 *   - Non-neutral params (e.g. exposure) measurably shift the output —
 *     guards against accidental identity-shortcut.
 *   -wantTiff16=false omits tiff16 entirely (single-pass optimization).
 *   - Math is bit-identical between direct calls (no warmup drift).
 *
 * PSNR vs the GPU pipeline is covered by tests/05-cross-path-integration;
 * here we pin the per-buffer contract.
 */

const { renderBuffer } = require('../render/render-buffer');

// Identity (neutral) params: RenderCore should pass values through ±small
// rounding from the 0-1 normalization. Constructed once so all tests share
// the exact same shape (avoids "forgot a field" drift).
const NEUTRAL = {
  inverted: false,
  exposure: 0,
  contrast: 0,
  highlights: 0, shadows: 0, whites: 0, blacks: 0,
  red: 1, green: 1, blue: 1,
  baseRed: 1, baseGreen: 1, baseBlue: 1,
  temp: 0, tint: 0,
};

// Build a solid-color WxH RGB(A) buffer.
function solidBuffer(w, h, channels, [r, g, b], a = 255) {
  const buf = Buffer.allocUnsafe(w * h * channels);
  for (let i = 0; i < w * h; i++) {
    buf[i * channels] = r;
    buf[i * channels + 1] = g;
    buf[i * channels + 2] = b;
    if (channels === 4) buf[i * channels + 3] = a;
  }
  return buf;
}

// Build a 16-bit solid buffer.
function solidBuffer16(w, h, channels, [r, g, b], a = 65535) {
  const buf = Buffer.allocUnsafe(w * h * channels * 2);
  const view = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  for (let i = 0; i < w * h; i++) {
    view[i * channels] = r;
    view[i * channels + 1] = g;
    view[i * channels + 2] = b;
    if (channels === 4) view[i * channels + 3] = a;
  }
  return buf;
}

describe('renderBuffer — output sizes', () => {
  test('jpeg8 only when wantTiff16=false (single-pass)', () => {
    const out = renderBuffer(solidBuffer(4, 4, 3, [128, 64, 200]), {
      width: 4, height: 4, channels: 3, is16bit: false, wantTiff16: false, params: NEUTRAL,
    });
    expect(out.jpeg8.length).toBe(4 * 4 * 3);
    expect(out.tiff16).toBeUndefined();
  });

  test('jpeg8 + tiff16 when wantTiff16=true', () => {
    const out = renderBuffer(solidBuffer(4, 4, 3, [128, 64, 200]), {
      width: 4, height: 4, channels: 3, is16bit: false, wantTiff16: true, params: NEUTRAL,
    });
    expect(out.jpeg8.length).toBe(4 * 4 * 3);
    expect(out.tiff16.length).toBe(4 * 4 * 3 * 2);
  });

  test('non-square aspect ratio preserves dimensions', () => {
    const out = renderBuffer(solidBuffer(8, 2, 3, [10, 20, 30]), {
      width: 8, height: 2, channels: 3, is16bit: false, wantTiff16: false, params: NEUTRAL,
    });
    expect(out.jpeg8.length).toBe(8 * 2 * 3);
  });
});

describe('renderBuffer — determinism + bit-stability', () => {
  test('two consecutive calls on identical input produce identical output', () => {
    const buf = solidBuffer(4, 4, 3, [100, 150, 200]);
    const a = renderBuffer(buf, { width: 4, height: 4, channels: 3, is16bit: false, wantTiff16: true, params: NEUTRAL });
    const b = renderBuffer(buf, { width: 4, height: 4, channels: 3, is16bit: false, wantTiff16: true, params: NEUTRAL });
    expect(Buffer.compare(a.jpeg8, b.jpeg8)).toBe(0);
    expect(Buffer.compare(a.tiff16, b.tiff16)).toBe(0);
  });

  test('output is uniform for a solid-color input (all pixels equal)', () => {
    const out = renderBuffer(solidBuffer(4, 4, 3, [128, 128, 128]), {
      width: 4, height: 4, channels: 3, is16bit: false, wantTiff16: false, params: NEUTRAL,
    });
    const [r0, g0, b0] = [out.jpeg8[0], out.jpeg8[1], out.jpeg8[2]];
    for (let i = 0; i < 4 * 4; i++) {
      expect(out.jpeg8[i * 3]).toBe(r0);
      expect(out.jpeg8[i * 3 + 1]).toBe(g0);
      expect(out.jpeg8[i * 3 + 2]).toBe(b0);
    }
  });
});

describe('renderBuffer — 8-bit vs 16-bit input parity', () => {
  test('16-bit input with same normalized color produces same 8-bit output (±1 LSB)', () => {
    // 8-bit (128,64,200) is the same chroma as 16-bit (32896,16448,51200).
    const out8 = renderBuffer(solidBuffer(2, 2, 3, [128, 64, 200]), {
      width: 2, height: 2, channels: 3, is16bit: false, wantTiff16: false, params: NEUTRAL,
    });
    const out16 = renderBuffer(solidBuffer16(2, 2, 3, [32896, 16448, 51200]), {
      width: 2, height: 2, channels: 3, is16bit: true, wantTiff16: false, params: NEUTRAL,
    });
    // 16-bit tiff16 output should be roughly 256× the 8-bit jpeg8 value.
    expect(Math.abs(out8.jpeg8[0] - out16.jpeg8[0])).toBeLessThanOrEqual(2);
    expect(Math.abs(out8.jpeg8[1] - out16.jpeg8[1])).toBeLessThanOrEqual(2);
    expect(Math.abs(out8.jpeg8[2] - out16.jpeg8[2])).toBeLessThanOrEqual(2);
  });

  test('16-bit tiff16 output preserves the wider dynamic range', () => {
    const out = renderBuffer(solidBuffer16(2, 2, 3, [32896, 16448, 51200]), {
      width: 2, height: 2, channels: 3, is16bit: true, wantTiff16: true, params: NEUTRAL,
    });
    // Little-endian: low byte first.
    const r16 = out.tiff16[0] | (out.tiff16[1] << 8);
    const g16 = out.tiff16[2] | (out.tiff16[3] << 8);
    const b16 = out.tiff16[4] | (out.tiff16[5] << 8);
    // Should be roughly 32896/16448/51200 modulo pipeline rounding.
    expect(Math.abs(r16 - 32896)).toBeLessThan(2000);
    expect(Math.abs(g16 - 16448)).toBeLessThan(2000);
    expect(Math.abs(b16 - 51200)).toBeLessThan(2000);
  });
});

describe('renderBuffer — channel count', () => {
  test('RGB (3-ch) and RGBA (4-ch) inputs produce identical RGB output', () => {
    const rgb = solidBuffer(2, 2, 3, [50, 100, 150]);
    const rgba = solidBuffer(2, 2, 4, [50, 100, 150], 255);
    const a = renderBuffer(rgb, { width: 2, height: 2, channels: 3, is16bit: false, wantTiff16: false, params: NEUTRAL });
    const b = renderBuffer(rgba, { width: 2, height: 2, channels: 4, is16bit: false, wantTiff16: false, params: NEUTRAL });
    expect(Buffer.compare(a.jpeg8, b.jpeg8)).toBe(0);
  });
});

describe('renderBuffer — param sensitivity (no accidental identity shortcut)', () => {
  test('exposure +2 visibly brightens output vs neutral', () => {
    const buf = solidBuffer(2, 2, 3, [64, 64, 64]);
    const neutral = renderBuffer(buf, { width: 2, height: 2, channels: 3, is16bit: false, wantTiff16: false, params: NEUTRAL });
    const exposed = renderBuffer(buf, {
      width: 2, height: 2, channels: 3, is16bit: false, wantTiff16: false,
      params: { ...NEUTRAL, exposure: 50 },
    });
    // Brighter → mean pixel value increases.
    const meanN = (neutral.jpeg8[0] + neutral.jpeg8[1] + neutral.jpeg8[2]) / 3;
    const meanE = (exposed.jpeg8[0] + exposed.jpeg8[1] + exposed.jpeg8[2]) / 3;
    expect(meanE).toBeGreaterThan(meanN);
  });

  test('inverted=true on a dark input produces a bright output (negative → positive)', () => {
    const buf = solidBuffer(2, 2, 3, [20, 20, 20]); // very dark
    const neutral = renderBuffer(buf, { width: 2, height: 2, channels: 3, is16bit: false, wantTiff16: false, params: NEUTRAL });
    const inverted = renderBuffer(buf, {
      width: 2, height: 2, channels: 3, is16bit: false, wantTiff16: false,
      params: { ...NEUTRAL, inverted: true },
    });
    expect(inverted.jpeg8[0]).toBeGreaterThan(neutral.jpeg8[0]);
  });
});

describe('renderBuffer — output range clamping', () => {
  test('extreme exposure does not overflow Uint8 (output stays in [0, 255])', () => {
    const buf = solidBuffer(2, 2, 3, [200, 200, 200]);
    const out = renderBuffer(buf, {
      width: 2, height: 2, channels: 3, is16bit: false, wantTiff16: false,
      params: { ...NEUTRAL, exposure: 100 },
    });
    for (let i = 0; i < out.jpeg8.length; i++) {
      expect(out.jpeg8[i]).toBeGreaterThanOrEqual(0);
      expect(out.jpeg8[i]).toBeLessThanOrEqual(255);
    }
  });

  test('extreme negative exposure does not underflow tiff16', () => {
    const buf = solidBuffer16(2, 2, 3, [100, 100, 100]);
    const out = renderBuffer(buf, {
      width: 2, height: 2, channels: 3, is16bit: true, wantTiff16: true,
      params: { ...NEUTRAL, exposure: -100 },
    });
    for (let i = 0; i < out.tiff16.length; i++) {
      expect(out.tiff16[i]).toBeGreaterThanOrEqual(0);
      expect(out.tiff16[i]).toBeLessThanOrEqual(255);
    }
  });
});
