/**
 * v4 Phase X — Algorithm correctness regression tests.
 *
 * Covers CPU/GPU rendering consistency fixes:
 *   X.1 (P0-3) — GLSL shoulder bound 0.25 → 0.5 (matches CPU)
 *   X.2 (P0-4) — WB luminance compensation BT.601 → BT.709
 *   X.3 (P0-8) — Custom film profile CPU path support
 *   X.4 (P1-1) — GLSL saturation negative clamp
 *   X.6 (P1-4) — GLSL dMax==dMin divide-by-zero protection
 *
 * Strategy: source-level checks (regex on GLSL strings) + behavioral checks
 * (RenderCore output for custom profiles matches built-in fallback).
 */

const fs = require('fs');
const path = require('path');
const { RenderCore } = require('../packages/shared/render/RenderCore');
const { computeWBGains } = require('../packages/shared/filmLabWhiteBalance');
const { FILM_CURVE_GLSL } = require('../packages/shared/shaders/filmCurve');
const { getSaturationGLSL } = require('../packages/shared/shaders/saturation');

function readSharedSrc(rel) {
  return fs.readFileSync(path.join(__dirname, '..', 'packages', rel), 'utf8');
}

describe('v4 X.1 — GLSL shoulder bound sync (P0-3)', () => {
  test('GPU shader uses 0.5 * shoulder (matches CPU filmLabCurve.js:172)', () => {
    // Before: `1.0 - 0.25 * shoulder` (only top 12.5% compressed)
    // After:  `1.0 - 0.5  * shoulder` (top 25% compressed, matches CPU)
    expect(FILM_CURVE_GLSL).toMatch(/1\.0\s*-\s*0\.5\s*\*\s*shoulder/);
    // Negative assertion: no 0.25 * shoulder in the shBound line
    // (0.25 * toe is still valid and must remain — toe is unchanged)
    const shBoundLine = FILM_CURVE_GLSL.match(/float\s+shBound[^;]+;/);
    expect(shBoundLine).not.toBeNull();
    expect(shBoundLine[0]).not.toMatch(/0\.25\s*\*\s*shoulder/);
  });

  test('CPU filmLabCurve.js uses 0.5 * shoulder (unchanged, source of truth)', () => {
    const src = readSharedSrc('shared/filmLabCurve.js');
    expect(src).toMatch(/shBound\s*=\s*1\.0\s*-\s*0\.5\s*\*\s*shoulder/);
  });

  test('GPU toeBound remains 0.25 * toe (only shoulder was fixed)', () => {
    expect(FILM_CURVE_GLSL).toMatch(/float\s+toeBound\s*=\s*0\.25\s*\*\s*toe/);
  });
});

describe('v4 X.2 — WB luminance compensation BT.709 (P0-4)', () => {
  test('computeWBGains uses BT.709 coefficients (0.2126/0.7152/0.0722)', () => {
    const src = readSharedSrc('shared/filmLabWhiteBalance.js');
    // Both Kelvin and legacy model paths must use BT.709 (the third match
    // is the explanatory comment).
    const matches = src.match(/0\.2126\s*\*\s*rGain\s*\+\s*0\.7152\s*\*\s*gGain\s*\+\s*0\.0722\s*\*\s*bGain/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2); // Kelvin + legacy (+ comment)
    // No BT.601 coefficients in WB compensation (edge detection is separate)
    expect(src).not.toMatch(/0\.299\s*\*\s*rGain\s*\+\s*0\.587\s*\*\s*gGain\s*\+\s*0\.114\s*\*\s*bGain/);
  });

  test('warm WB (temp=100) does not over-darken (BT.709 ≈ 2.7% drop, not 3.6%)', () => {
    // With BT.709, the luma-weighted gain for warm WB (rGain>1, bGain<1)
    // gives a smaller brightness compensation factor because green (the
    // dominant Rec.709 luma contributor) is unchanged. We verify the
    // resulting gains multiply to roughly preserve overall luminance.
    const gains = computeWBGains({ red: 1, green: 1, blue: 1, temp: 100, tint: 0 }, { useKelvinModel: true });
    const [rBal, gBal, bBal] = gains;
    // BT.709 luma of the gain vector should be ≈ 1.0 (luminance-preserving)
    const luma = 0.2126 * rBal + 0.7152 * gBal + 0.0722 * bBal;
    expect(luma).toBeGreaterThan(0.97);
    expect(luma).toBeLessThan(1.03);
  });

  test('neutral WB (temp=0) is identity', () => {
    const gains = computeWBGains({ red: 1, green: 1, blue: 1, temp: 0, tint: 0 }, { useKelvinModel: true });
    expect(gains[0]).toBeCloseTo(1, 5);
    expect(gains[1]).toBeCloseTo(1, 5);
    expect(gains[2]).toBeCloseTo(1, 5);
  });
});

describe('v4 X.3 — Custom film profile CPU path (P0-8)', () => {
  test('_prepareFilmCurveContext falls back to DEFAULT_FILM_CURVE for unknown profile', () => {
    // A custom profile name not in FILM_CURVE_PROFILES should NOT disable
    // the film curve — it should fall back to DEFAULT_FILM_CURVE so that
    // explicit filmCurveGamma etc. params still drive the curve.
    const core = new RenderCore({
      inverted: true,
      filmCurveEnabled: true,
      filmCurveProfile: 'my-custom-profile', // not in FILM_CURVE_PROFILES
      filmCurveGamma: 0.55,
      filmCurveDMin: 0.15,
      filmCurveDMax: 2.8,
      filmCurveToe: 0.2,
      filmCurveShoulder: 0.3,
    });
    core.prepareLUTs();
    expect(core.luts.filmCurveCtx.enabled).toBe(true);
    expect(core.luts.filmCurveCtx.lutFloatR).toBeDefined();
    expect(core.luts.filmCurveCtx.lutFloatG).toBeDefined();
    expect(core.luts.filmCurveCtx.lutFloatB).toBeDefined();
  });

  test('explicit filmCurveGamma overrides DEFAULT_FILM_CURVE fallback', () => {
    // Two cores: one with gamma=0.4, one with gamma=0.8. Same unknown profile.
    // Their LUTs should differ (proves the explicit param is respected).
    const coreA = new RenderCore({
      inverted: true, filmCurveEnabled: true, filmCurveProfile: 'unknown',
      filmCurveGamma: 0.4,
    });
    coreA.prepareLUTs();
    const coreB = new RenderCore({
      inverted: true, filmCurveEnabled: true, filmCurveProfile: 'unknown',
      filmCurveGamma: 0.8,
    });
    coreB.prepareLUTs();
    // Mid-tone LUT entry should differ between the two gammas
    const mid = 512; // 1024/2
    expect(coreA.luts.filmCurveCtx.lutFloatR[mid]).not.toBeCloseTo(
      coreB.luts.filmCurveCtx.lutFloatR[mid], 3
    );
  });

  test('custom profile params produce finite output (no NaN/Infinity)', () => {
    const core = new RenderCore({
      inverted: true,
      filmCurveEnabled: true,
      filmCurveProfile: 'my-custom',
      filmCurveGamma: 0.6,
      filmCurveGammaR: 0.65,
      filmCurveGammaG: 0.55,
      filmCurveGammaB: 0.6,
      filmCurveDMin: 0.12,
      filmCurveDMax: 2.9,
      filmCurveToe: 0.15,
      filmCurveShoulder: 0.25,
    });
    core.prepareLUTs();
    for (let i = 0; i < 8; i++) {
      const v = i / 7;
      const [r, g, b] = core.processPixelFloat(v, v, v);
      expect(Number.isFinite(r)).toBe(true);
      expect(Number.isFinite(g)).toBe(true);
      expect(Number.isFinite(b)).toBe(true);
    }
  });

  test('built-in profiles still work (regression check)', () => {
    // 'standard' or 'default' should still resolve from FILM_CURVE_PROFILES
    const core = new RenderCore({
      inverted: true,
      filmCurveEnabled: true,
      filmCurveProfile: 'standard',
    });
    core.prepareLUTs();
    expect(core.luts.filmCurveCtx.enabled).toBe(true);
  });

  // v4-review #5: fallback should warn when profile name is unknown
  test('unknown profile name triggers console.warn (not silent fallback)', () => {
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    try {
      const core = new RenderCore({
        inverted: true,
        filmCurveEnabled: true,
        filmCurveProfile: 'definitely-not-a-real-profile-name',
      });
      core.prepareLUTs();
      // Should still produce a working LUT (fallback to DEFAULT_FILM_CURVE)
      expect(core.luts.filmCurveCtx.enabled).toBe(true);
      // Should have warned about the unknown profile name
      const profileWarn = warnings.find(w => w.includes('definitely-not-a-real-profile-name'));
      expect(profileWarn).toBeDefined();
    } finally {
      console.warn = origWarn;
    }
  });
});

describe('v4 X.4 — GLSL saturation negative clamp (P1-1)', () => {
  test('GPU shader clamps s to >= 0 (matches CPU)', () => {
    const glsl = getSaturationGLSL();
    // Before: `float s = 1.0 + u_saturation / 100.0;`
    // After:  `float s = max(0.0, 1.0 + u_saturation / 100.0);`
    expect(glsl).toMatch(/float\s+s\s*=\s*max\(0\.0,\s*1\.0\s*\+\s*u_saturation\s*\/\s*100\.0\)/);
  });

  test('CPU applySaturationFloat clamps s to >= 0 (regression check)', () => {
    const src = readSharedSrc('shared/filmLabSaturation.js');
    expect(src).toMatch(/Math\.max\(0,\s*1\s*\+\s*strength\s*\/\s*100\)/);
  });
});

describe('v4 X.6 — GLSL dMax==dMin divide-by-zero protection (P1-4)', () => {
  test('GPU shader guards dRange with max(..., 1e-6)', () => {
    // Before: `float densityNorm = clamp((density - dMin) / (dMax - dMin), 0.0, 1.0);`
    // After:  precompute `float dRange = max(dMax - dMin, 1e-6);` then divide
    expect(FILM_CURVE_GLSL).toMatch(/float\s+dRange\s*=\s*max\(dMax\s*-\s*dMin,\s*1e-6\)/);
    expect(FILM_CURVE_GLSL).toMatch(/\/\s*dRange/);
  });

  test('CPU filmLabCurve.js guards dRange (regression check)', () => {
    const src = readSharedSrc('shared/filmLabCurve.js');
    expect(src).toMatch(/Math\.max\(dMax\s*-\s*dMin,\s*1e-6\)/);
  });
});
