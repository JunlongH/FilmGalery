---
description: "Diagnose and fix rendering issues in the film processing pipeline — color shifts, banding, inconsistency between CPU and GPU paths"
agent: "rendering-expert"
argument-hint: "Describe the rendering issue, e.g. 'Highlights are clipping to pure white after white balance adjustment'"
---
Diagnose and fix a rendering pipeline issue in FilmGallery.

Investigation steps:
1. Identify which pipeline stage is causing the issue
2. Check the Float32 path in `packages/shared/render/` for precision loss
3. Compare the GLSL shader in `packages/shared/shaders/` with the JS implementation
4. Verify uniform consistency between CPU and GPU paths
5. Run `npm test` to check all 5 rendering consistency test suites

Pipeline order for reference:
```
FilmCurve → Base → Density → Inversion → 3DLUT → WB →
Exposure → Contrast → B/W → S/H → RollOff → Curves →
HSL → SplitTone
```

Common issues:
- 8-bit truncation in intermediate steps (must stay Float32)
- Uniform name mismatch between JS and GLSL
- Late clipping not applied (clamp only at final output)
- LUT interpolation method inconsistency
