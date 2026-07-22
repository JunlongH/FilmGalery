/**
 * GLSL Film Curve Functions
 * 
 * 胶片特性曲线（H&D 密度模型）
 * 用于模拟胶片的密度-曝光响应特性
 * 
 * 算法匹配 CPU filmLabCurve.js：
 * - 3段 S-曲线 (toe/straight/shoulder) + Hermite 混合
 * - 逐通道 gamma (Q13: per-channel gamma)
 * - toe 区域 gamma×1.5, shoulder 区域 gamma×0.6
 * - 过渡窗口 tw=0.08
 * 
 * @version 2.0.0 — 添加 3-segment S-curve + per-channel gamma
 */

const FILM_CURVE_GLSL = `
// ============================================================================
// Film Curve: H&D Density Model (Q13: 3-segment S-curve)
// ============================================================================

// Hermite smoothstep for toe/shoulder blending
float filmHermite(float t) {
  float c = clamp(t, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

// Three-segment gamma mapping (matches CPU _applyThreeSegmentGamma)
float threeSegGamma(float d, float gamma, float toe, float shoulder) {
  float toeBound = 0.25 * toe;
  // X.1 (P0-3): sync with CPU filmLabCurve.js:172 — P2-shoulder fix changed
  // shBound from (1 - 0.25*shoulder) to (1 - 0.5*shoulder) to widen the
  // shoulder compression range. The GPU shader was never updated, causing
  // WebGL preview to compress only the top 12.5% (8-bit rarely triggers)
  // while CPU export compresses the top 25% — visible divergence between
  // preview and saved images.
  float shBound  = 1.0 - 0.5 * shoulder;
  float gammaToe = gamma * 1.5;
  float gammaSh  = gamma * 0.6;
  float tw = 0.08;

  if (d < toeBound) {
    return pow(d, gammaToe);
  } else if (d < toeBound + tw && toeBound > 0.0) {
    float t = (d - toeBound) / tw;
    float blend = filmHermite(t);
    return mix(pow(d, gammaToe), pow(d, gamma), blend);
  } else if (d > shBound) {
    return pow(d, gammaSh);
  } else if (d > shBound - tw && shoulder > 0.0) {
    float t = (d - (shBound - tw)) / tw;
    float blend = filmHermite(t);
    return mix(pow(d, gamma), pow(d, gammaSh), blend);
  } else {
    return pow(d, gamma);
  }
}

// Full film curve: per-channel gamma + toe/shoulder S-curve
float applyFilmCurve(float value, float gamma, float dMin, float dMax,
                      float toe, float shoulder) {
  float normalized = clamp(value, 0.001, 1.0);
  float density = -log(normalized) / log(10.0);
  // X.6 (P1-4): guard against dMax==dMin (custom profile edge case) to match
  // CPU filmLabCurve.js:88 Math.max(dMax - dMin, 1e-6). Without this, the
  // division produces Infinity → clamp to 1.0 on GPU while CPU clamps to 0.0
  // (density - dMin == 0 → 0/1e-6 = 0) → completely different output.
  float dRange = max(dMax - dMin, 1e-6);
  float densityNorm = clamp((density - dMin) / dRange, 0.0, 1.0);

  float gammaApplied;
  if (toe <= 0.0 && shoulder <= 0.0) {
    gammaApplied = pow(densityNorm, gamma);
  } else {
    gammaApplied = threeSegGamma(densityNorm, gamma, toe, shoulder);
  }

  float adjustedDensity = dMin + gammaApplied * (dMax - dMin);
  float outputT = pow(10.0, -adjustedDensity);
  return clamp(outputT, 0.0, 1.0);
}

// Legacy single-gamma overload (backward compat — used when toe=shoulder=0)
float applyFilmCurveLegacy(float value) {
  return applyFilmCurve(value, u_filmCurveGamma, u_filmCurveDMin, u_filmCurveDMax, 0.0, 0.0);
}
`;

export { FILM_CURVE_GLSL };