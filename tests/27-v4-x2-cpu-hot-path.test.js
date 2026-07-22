/**
 * v4 Phase X2 — CPU hot path optimization regression tests.
 *
 * Covers:
 *   X2.1 — prepareLUTs precomputes frame-level _tone constants
 *          (no per-pixel Math.pow / Number() in processPixelFloat)
 *   X2.2 — processPixelFloat accepts optional `out` buffer (no array alloc)
 *   X2.3 — _sampleCurveLUTFloatHQ no longer clamps internally (caller does)
 *   X2.5 — applySaturationFloat accepts optional `out` buffer
 *   P1-23 — contrast clamp to [-258, 258] prevents division by zero
 *
 * Strategy: behavioral equivalence between old (no `out`) and new (with `out`)
 * paths — every existing test still calls processPixelFloat without `out`,
 * so this file focuses on the new opt-in paths and edge cases.
 */

const { RenderCore } = require('../packages/shared/render/RenderCore');
const { processBlock } = require('../packages/shared/renderChunked');
const { applySaturationFloat } = require('../packages/shared/filmLabSaturation');

describe('v4 X2.1 — prepareLUTs precomputes _tone', () => {
  test('prepareLUTs exposes a _tone object with all expected fields', () => {
    const core = new RenderCore({
      exposure: 10, contrast: 25, blacks: -50, whites: 30,
      shadows: -20, highlights: 15,
    });
    core.prepareLUTs();
    const t = core.luts._tone;
    expect(t).toBeDefined();
    expect(typeof t.expFactor).toBe('number');
    expect(typeof t.ctr).toBe('number');
    expect(typeof t.contrastFactor).toBe('number');
    expect(typeof t.blackPoint).toBe('number');
    expect(typeof t.whitePoint).toBe('number');
    expect(typeof t.range).toBe('number');
    expect(typeof t.sFactor).toBe('number');
    expect(typeof t.hFactor).toBe('number');
  });

  test('expFactor matches Math.pow(2, exposure/50)', () => {
    const core = new RenderCore({ exposure: 25 });
    core.prepareLUTs();
    expect(core.luts._tone.expFactor).toBeCloseTo(Math.pow(2, 25 / 50), 10);
  });

  test('ctr derives from contrast * 2.55', () => {
    const core = new RenderCore({ contrast: 40 });
    core.prepareLUTs();
    expect(core.luts._tone.ctr).toBeCloseTo(40 * 2.55, 10);
  });

  test('P1-23: ctr clamped to [-258, 258] for out-of-range contrast', () => {
    // contrast=200 → ctr raw = 510, must clamp to 258 (prevents /0)
    const core = new RenderCore({ contrast: 200 });
    core.prepareLUTs();
    expect(core.luts._tone.ctr).toBe(258);
    // contrast=-200 → ctr raw = -510, must clamp to -258
    const coreNeg = new RenderCore({ contrast: -200 });
    coreNeg.prepareLUTs();
    expect(coreNeg.luts._tone.ctr).toBe(-258);
  });

  test('P1-23: extreme contrast does not produce NaN/Infinity in output', () => {
    // Without clamp, contrast=200 → ctr=510 → denominator 255*(259-510) < 0 →
    // either Infinity or tone inversion. With clamp, output is finite.
    const core = new RenderCore({ contrast: 200 });
    core.prepareLUTs();
    const [r, g, b] = core.processPixelFloat(0.5, 0.5, 0.5);
    expect(Number.isFinite(r)).toBe(true);
    expect(Number.isFinite(g)).toBe(true);
    expect(Number.isFinite(b)).toBe(true);
  });
});

describe('v4 X2.2 — processPixelFloat out parameter', () => {
  test('without out: returns a fresh array (backward compat)', () => {
    const core = new RenderCore({});
    const result = core.processPixelFloat(0.5, 0.5, 0.5);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
    // Each call returns a NEW array (no shared buffer)
    const result2 = core.processPixelFloat(0.5, 0.5, 0.5);
    expect(result).not.toBe(result2);
  });

  test('with out: writes into out and returns the same buffer', () => {
    const core = new RenderCore({});
    const out = [0, 0, 0];
    const ret = core.processPixelFloat(0.5, 0.5, 0.5, out);
    expect(ret).toBe(out); // same reference
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[0]).toBeLessThanOrEqual(1);
  });

  test('out and non-out paths produce identical output across params', () => {
    const paramsList = [
      {},
      { exposure: 25, contrast: 30 },
      { inverted: true, inversionMode: 'log', filmCurveEnabled: true, filmCurveProfile: 'standard' },
      { saturation: 50, temp: 30, tint: -10 },
      { highlights: 40, shadows: -30, blacks: -20, whites: 15 },
    ];
    for (const params of paramsList) {
      const coreNoOut = new RenderCore(params);
      const coreOut = new RenderCore(params);
      coreNoOut.prepareLUTs();
      coreOut.prepareLUTs();
      const out = [0, 0, 0];
      for (let i = 0; i < 64; i++) {
        const r = i / 63, g = (63 - i) / 63, b = (i % 8) / 7;
        const expected = coreNoOut.processPixelFloat(r, g, b);
        coreOut.processPixelFloat(r, g, b, out);
        expect(out[0]).toBeCloseTo(expected[0], 8);
        expect(out[1]).toBeCloseTo(expected[1], 8);
        expect(out[2]).toBeCloseTo(expected[2], 8);
      }
    }
  });

  test('processBlock uses out-buffer path without behavior change', () => {
    // Two identical blocks processed via processBlock should match a direct
    // processPixelFloat call (validates the outBuf pre-allocation works).
    const core = new RenderCore({ exposure: 10, contrast: 20, saturation: 25 });
    core.prepareLUTs();
    const data = new Uint8ClampedArray(8); // 2 pixels RGBA
    data[0] = 128; data[1] = 64; data[2] = 192; data[3] = 255;
    data[4] = 200; data[5] = 100; data[6] = 50; data[7] = 255;
    const dataCopy = new Uint8ClampedArray(data);

    processBlock(data, core);

    // Recompute expected values directly
    const expected1 = core.processPixelFloat(dataCopy[0] / 255, dataCopy[1] / 255, dataCopy[2] / 255);
    const expected2 = core.processPixelFloat(dataCopy[4] / 255, dataCopy[5] / 255, dataCopy[6] / 255);
    expect(data[0]).toBeCloseTo(Math.min(255, Math.max(0, Math.round(expected1[0] * 255))), 0);
    expect(data[1]).toBeCloseTo(Math.min(255, Math.max(0, Math.round(expected1[1] * 255))), 0);
    expect(data[2]).toBeCloseTo(Math.min(255, Math.max(0, Math.round(expected1[2] * 255))), 0);
    expect(data[4]).toBeCloseTo(Math.min(255, Math.max(0, Math.round(expected2[0] * 255))), 0);
    expect(data[5]).toBeCloseTo(Math.min(255, Math.max(0, Math.round(expected2[1] * 255))), 0);
    expect(data[6]).toBeCloseTo(Math.min(255, Math.max(0, Math.round(expected2[2] * 255))), 0);
  });

  test('transparent pixels (alpha=0) are skipped', () => {
    const core = new RenderCore({});
    core.prepareLUTs();
    const data = new Uint8ClampedArray(8);
    data[0] = 100; data[1] = 100; data[2] = 100; data[3] = 0;   // transparent
    data[4] = 200; data[5] = 200; data[6] = 200; data[7] = 255;  // opaque
    processBlock(data, core);
    // Transparent pixel untouched
    expect(data[0]).toBe(100);
    expect(data[1]).toBe(100);
    expect(data[2]).toBe(100);
    // Opaque pixel processed (may differ from 200)
    // (just check it didn't crash and value is in valid range)
    expect(data[4]).toBeGreaterThanOrEqual(0);
    expect(data[4]).toBeLessThanOrEqual(255);
  });
});

describe('v4 X2.3 — _sampleCurveLUTFloatHQ no internal clamp', () => {
  test('returns identical output for input already in [0,1]', () => {
    const core = new RenderCore({ curves: { rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
    core.prepareLUTs();
    const lut = core.luts.lutRGBf;
    expect(lut).toBeDefined();
    // Input 0.5 — caller (processPixelFloat) clamps before calling
    const out = core._sampleCurveLUTFloatHQ(0.5, lut);
    expect(out).toBeGreaterThanOrEqual(0);
    expect(out).toBeLessThanOrEqual(1);
  });

  test('does NOT silently clamp out-of-range input (caller responsibility)', () => {
    const core = new RenderCore({});
    core.prepareLUTs();
    const lut = core.luts.lutRGBf;
    // Construct a synthetic lut to test bounds: 1024 entries, identity
    const synth = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) synth[i] = i / 1023;
    // val=-0.5 with clamp would yield lut[0]=0; without clamp, pos=-0.5*1023=-511.5
    // Math.floor(-511.5) = -512, hi = min(1023, -511) = -511
    // (1 - frac) * lut[-512] + frac * lut[-511] → undefined (out of bounds)
    // We don't assert specific value — just that the function doesn't normalize it to 0.
    // The key property: the function no longer has `Math.max(0, Math.min(1, val))`.
    const src = require('fs').readFileSync(
      require.resolve('../packages/shared/render/RenderCore.js'),
      'utf8'
    );
    const methodSig = '_sampleCurveLUTFloatHQ(val, lut)';
    const idx = src.indexOf(methodSig);
    expect(idx).toBeGreaterThan(-1);
    const bodyEnd = src.indexOf('// 8-bit Pipeline Helper', idx);
    const body = src.substring(idx, bodyEnd === -1 ? idx + 400 : bodyEnd);
    // No clamp inside the body
    expect(body).not.toMatch(/Math\.max\(0,\s*Math\.min\(1,\s*val\)\)/);
  });
});

describe('v4 X2.5 — applySaturationFloat out parameter', () => {
  test('without out: returns a fresh array (backward compat)', () => {
    const result = applySaturationFloat(0.5, 0.5, 0.5, 50);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });

  test('with out: writes into out and returns the same buffer', () => {
    const out = [0, 0, 0];
    const ret = applySaturationFloat(0.7, 0.5, 0.3, 50, out);
    expect(ret).toBe(out);
  });

  test('out and non-out paths produce identical output', () => {
    for (const strength of [-100, -50, 0, 50, 100]) {
      for (const [r, g, b] of [[0.1, 0.5, 0.9], [0.7, 0.2, 0.4], [0.5, 0.5, 0.5]]) {
        const expected = applySaturationFloat(r, g, b, strength);
        const out = [0, 0, 0];
        applySaturationFloat(r, g, b, strength, out);
        expect(out[0]).toBeCloseTo(expected[0], 10);
        expect(out[1]).toBeCloseTo(expected[1], 10);
        expect(out[2]).toBeCloseTo(expected[2], 10);
      }
    }
  });

  test('strength=0 is identity (out path)', () => {
    const out = [0, 0, 0];
    applySaturationFloat(0.3, 0.6, 0.9, 0, out);
    expect(out[0]).toBeCloseTo(0.3, 10);
    expect(out[1]).toBeCloseTo(0.6, 10);
    expect(out[2]).toBeCloseTo(0.9, 10);
  });
});
