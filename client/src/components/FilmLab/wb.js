// White Balance utility: compute per-channel gains from base gains and temp/tint.
// Keeps behavior consistent across CPU, WebGL, and server, with safety clamps.

export function computeWBGains({ red = 1, green = 1, blue = 1, temp = 0, tint = 0 }, options = {}) {
  const minGain = options.minGain ?? 0.05;
  const maxGain = options.maxGain ?? 8.0;
  let r = red + (temp / 200) + (tint / 200);
  let g = green + (temp / 200) - (tint / 200);
  let b = blue - (temp / 200);
  // Safety clamp to avoid negative/zero gains that cause black output
  r = Math.max(minGain, Math.min(maxGain, r));
  g = Math.max(minGain, Math.min(maxGain, g));
  b = Math.max(minGain, Math.min(maxGain, b));
  return [r, g, b];
}

// Given a sampled color (after inversion), derive normalized gains with preserved luminance.
export function gainsFromSample(rgb) {
  const eps = 2.0; // avoid division by near-zero values
  const safe = [Math.max(eps, rgb[0]), Math.max(eps, rgb[1]), Math.max(eps, rgb[2])];
  let k = [1 / safe[0], 1 / safe[1], 1 / safe[2]];
  const avg = (k[0] + k[1] + k[2]) / 3;
  if (avg > 0) k = k.map(v => v / avg);
  return k;
}
