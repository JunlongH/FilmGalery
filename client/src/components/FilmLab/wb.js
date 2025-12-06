// White Balance utility: compute per-channel gains from base gains and temp/tint.
// Keeps behavior consistent across CPU, WebGL, and server, with safety clamps.

export function computeWBGains({ red = 1, green = 1, blue = 1, temp = 0, tint = 0 }, options = {}) {
  const minGain = options.minGain ?? 0.05;
  const maxGain = options.maxGain ?? 50.0;
  
  // Safety: Ensure inputs are numbers
  const R = Number.isFinite(red) ? red : 1;
  const G = Number.isFinite(green) ? green : 1;
  const B = Number.isFinite(blue) ? blue : 1;
  const T = Number.isFinite(temp) ? temp : 0;
  const N = Number.isFinite(tint) ? tint : 0;

  const t = T / 200;
  const n = N / 200;
  
  let r = R * (1 + t + n);
  let g = G * (1 + t - n);
  let b = B * (1 - t);
  
  // Safety: Check for NaN before clamping
  if (!Number.isFinite(r)) r = 1;
  if (!Number.isFinite(g)) g = 1;
  if (!Number.isFinite(b)) b = 1;

  r = Math.max(minGain, Math.min(maxGain, r));
  g = Math.max(minGain, Math.min(maxGain, g));
  b = Math.max(minGain, Math.min(maxGain, b));
  
  return [r, g, b];
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Solve for temp/tint sliders (range -100..100) that neutralize the sampled color
// given the current manual channel gains. This keeps film-base corrections intact.
// Uses Multiplicative model: Gain = Base * (1 + t +/- n)
export function solveTempTintFromSample(sampleRgb, baseGains = {}) {
  // Safety: Ensure inputs are valid
  if (!Array.isArray(sampleRgb) || sampleRgb.length < 3) return { temp: 0, tint: 0 };
  
  const safeSample = sampleRgb.map(v => {
    const val = Number(v);
    return Number.isFinite(val) ? Math.max(1, val) : 128; // Avoid 0 or NaN, default to mid-gray
  });

  const base = {
    red: Math.max(0.05, Number.isFinite(baseGains.red) ? baseGains.red : 1),
    green: Math.max(0.05, Number.isFinite(baseGains.green) ? baseGains.green : 1),
    blue: Math.max(0.05, Number.isFinite(baseGains.blue) ? baseGains.blue : 1)
  };

  const [rS, gS, bS] = safeSample;
  
  // Goal: Find temp and tint such that after applying WB gains,
  // the three channels become approximately equal (neutral gray).
  //
  // Current state: rS, gS, bS (sampled inverted color)
  // After WB: rS * base.red * (1+t+n), gS * base.green * (1+t-n), bS * base.blue * (1-t)
  //
  // We want these three values to be equal to their average.
  // Let's use a simple target: make them equal to the current green channel 
  // (green is typically the most stable/accurate in most sensors).
  
  // Target: All channels should equal green after WB
  // rS * R * (1+t+n) = gS * G * (1+t-n)
  // bS * B * (1-t)   = gS * G * (1+t-n)
  
  // From first equation:
  // rS*R*(1+t+n) = gS*G*(1+t-n)
  // rS*R + rS*R*t + rS*R*n = gS*G + gS*G*t - gS*G*n
  // t*(rS*R - gS*G) + n*(rS*R + gS*G) = gS*G - rS*R
  
  // From second equation:
  // bS*B*(1-t) = gS*G*(1+t-n)
  // bS*B - bS*B*t = gS*G + gS*G*t - gS*G*n
  // -t*(bS*B + gS*G) + n*gS*G = gS*G - bS*B
  // t*(bS*B + gS*G) - n*gS*G = bS*B - gS*G
  
  const R = base.red;
  const G = base.green;
  const B = base.blue;
  
  const A11 = rS*R - gS*G;
  const A12 = rS*R + gS*G;
  const C1  = gS*G - rS*R;
  
  const A21 = bS*B + gS*G;
  const A22 = -gS*G;
  const C2  = bS*B - gS*G;
  
  const det = A11 * A22 - A21 * A12;
  
  // Fallback: If determinant is too small or color is already near-gray, return 0
  if (Math.abs(det) < 1e-6) {
    return { temp: 0, tint: 0 };
  }
  
  const t = (C1 * A22 - C2 * A12) / det;
  const n = (A11 * C2 - A21 * C1) / det;
  
  if (!Number.isFinite(t) || !Number.isFinite(n)) {
    return { temp: 0, tint: 0 };
  }
  
  // Clamp to slider range and verify the resulting gains are reasonable
  let tempOut = clamp(t * 200, -100, 100);
  let tintOut = clamp(n * 200, -100, 100);
  
  // Safety check: Verify the computed WB gains don't go to extremes
  const testGains = computeWBGains({ red: R, green: G, blue: B, temp: tempOut, tint: tintOut });
  const [testR, testG, testB] = testGains;
  
  // If any gain is too extreme (close to minGain or maxGain), it means the sample was too extreme
  // In this case, scale back the temp/tint to avoid black/blown highlights
  const isExtreme = testR < 0.1 || testR > 10 || testG < 0.1 || testG > 10 || testB < 0.1 || testB > 10;
  
  if (isExtreme) {
    console.warn('[WB Solver] Extreme gains, scaling back 50%:', { before: testGains, tempOut, tintOut });
    tempOut *= 0.5;
    tintOut *= 0.5;
  }
  
  return {
    temp: tempOut,
    tint: tintOut
  };
}
