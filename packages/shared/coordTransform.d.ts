// Type declarations for packages/shared/coordTransform (runtime: coordTransform.js).
// Enables type-safe imports from TypeScript consumers (mobile / watch-app).
//
// WGS-84 <-> GCJ-02 ("Mars coordinates") transformation, required for map
// services in China. Runtime is CommonJS (coordTransform.js).

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * WGS-84 -> GCJ-02. Points outside China are returned unchanged.
 */
export declare function wgs84ToGcj02(wgsLat: number, wgsLng: number): LatLng;

/**
 * GCJ-02 -> WGS-84 (iterative, < 0.5 m accuracy). Points outside China are
 * returned unchanged.
 */
export declare function gcj02ToWgs84(gcjLat: number, gcjLng: number): LatLng;

/** Rough bounding-box check for whether a point is inside China. */
export declare function isInChina(lat: number, lng: number): boolean;

/** Internal transform helpers (exported for testing). */
export declare function transformLat(x: number, y: number): number;
export declare function transformLng(x: number, y: number): number;
