/**
 * Tests for the shared map utilities (packages/shared/mapUtils.js).
 *
 * Pins:
 *   - Coordinate range validation (isValidLatitude/Longitude/LatLng)
 *   - Coordinate formatting (decimal + DMS)
 *   - Tile layer URL resolution + fallback
 *   - Grid clustering correctness
 *   - clusterRadiusFromDelta heuristic
 */

const {
  MAP_PROVIDERS,
  TILE_LAYERS,
  buildTileLayerUrl,
  clusterRadiusFromDelta,
  gridCluster,
  isValidLatitude,
  isValidLongitude,
  isValidLatLng,
  formatLatLng,
} = require('../mapUtils');

describe('isValidLatitude', () => {
  test('accepts in-range numbers', () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(45.5)).toBe(true);
  });
  test('rejects out-of-range', () => {
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude(-91)).toBe(false);
    expect(isValidLatitude(200)).toBe(false);
  });
  test('rejects non-numbers', () => {
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude(Infinity)).toBe(false);
    expect(isValidLatitude('45')).toBe(false);
    expect(isValidLatitude(null)).toBe(false);
    expect(isValidLatitude(undefined)).toBe(false);
  });
});

describe('isValidLongitude', () => {
  test('accepts in-range numbers', () => {
    expect(isValidLongitude(0)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-74.006)).toBe(true);
  });
  test('rejects out-of-range and non-numbers', () => {
    expect(isValidLongitude(181)).toBe(false);
    expect(isValidLongitude(-181)).toBe(false);
    expect(isValidLongitude('0')).toBe(false);
    expect(isValidLongitude(null)).toBe(false);
  });
});

describe('isValidLatLng', () => {
  test('both null is valid (unset coordinates)', () => {
    expect(isValidLatLng(null, null)).toBe(true);
    expect(isValidLatLng(undefined, undefined)).toBe(true);
  });
  test('mixed null/non-null is invalid', () => {
    expect(isValidLatLng(45, null)).toBe(false);
    expect(isValidLatLng(null, 90)).toBe(false);
    expect(isValidLatLng(undefined, 90)).toBe(false);
  });
  test('both in-range is valid', () => {
    expect(isValidLatLng(45, -120)).toBe(true);
  });
  test('one out-of-range is invalid', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
  });
});

describe('formatLatLng', () => {
  test('decimal format (default) trims to 5 decimal places', () => {
    expect(formatLatLng(39.90766, 116.3915)).toBe('39.90766, 116.39150');
  });

  test('DMS format produces degrees/minutes/seconds with hemisphere', () => {
    // 39.90766 → 39°54'27.6"N, 116.39150 → 116°23'29.4"E
    expect(formatLatLng(39.90766, 116.3915, 'dms')).toBe(
      `39°54'27.6"N 116°23'29.4"E`
    );
  });

  test('DMS format for southern/western hemispheres', () => {
    expect(formatLatLng(-33.8688, -151.2093, 'dms')).toBe(
      `33°52'7.7"S 151°12'33.5"W`
    );
  });
});

describe('buildTileLayerUrl', () => {
  test('returns the OSM light URL by default', () => {
    expect(buildTileLayerUrl('osm', 'light')).toBe(TILE_LAYERS.osm.light);
  });

  test('returns the requested provider/style when defined', () => {
    expect(buildTileLayerUrl('osm', 'dark')).toBe(TILE_LAYERS.osm.dark);
    expect(buildTileLayerUrl('osm', 'satellite')).toBe(TILE_LAYERS.osm.satellite);
    expect(buildTileLayerUrl('amap', 'light')).toBe(TILE_LAYERS.amap.light);
    expect(buildTileLayerUrl('amap', 'satellite')).toBe(TILE_LAYERS.amap.satellite);
  });

  test('falls back to OSM light for unknown provider', () => {
    expect(buildTileLayerUrl('unknown', 'light')).toBe(TILE_LAYERS.osm.light);
  });

  test('falls back to OSM light for amap dark (no separate URL — CSS filter is used)', () => {
    // AMap dark mode is simulated via CSS filter on the tile container;
    // there is no separate dark URL in TILE_LAYERS.amap.
    expect(buildTileLayerUrl('amap', 'dark')).toBe(TILE_LAYERS.osm.light);
  });
});

describe('clusterRadiusFromDelta', () => {
  test('world view (large delta) → large radius', () => {
    expect(clusterRadiusFromDelta(50)).toBe(1.0);
  });
  test('street view (tiny delta) → tiny radius', () => {
    expect(clusterRadiusFromDelta(0.001)).toBe(0.001);
  });
  test('handles 0 / undefined → default delta (0.05)', () => {
    // |0| and undefined both fall back to 0.05 delta → 0.005 radius
    expect(clusterRadiusFromDelta(0)).toBe(0.005);
    expect(clusterRadiusFromDelta(undefined)).toBe(0.005);
  });
});

describe('gridCluster', () => {
  // Note: the algorithm uses Math.floor(lat/radius):Math.floor(lng/radius) as
  // the bucket key. Math.floor rounds toward -Infinity, so negative longitudes
  // that straddle a boundary (e.g. -74.0 and -74.001 with radius 0.005) can
  // land in different buckets. This matches the original MapScreen.tsx behavior;
  // test data below avoids boundary straddles.
  const points = [
    { id: 1, latitude: 40.0, longitude: 74.0, name: 'a' },
    { id: 2, latitude: 40.001, longitude: 74.001, name: 'b' }, // same bucket as #1 with radius 0.005
    { id: 3, latitude: 45.0, longitude: 120.0, name: 'c' }, // far from #1
  ];

  test('groups nearby points into a single cluster', () => {
    const clusters = gridCluster(points, { radius: 0.005 });
    expect(clusters).toHaveLength(2);
    const big = clusters.find((c) => c.count === 2);
    expect(big).toBeDefined();
    expect(big.count).toBe(2);
    expect(big.points).toHaveLength(2);
  });

  test('preserves up to maxPreview points in cluster.points', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      latitude: 40,
      longitude: 74,
    }));
    const clusters = gridCluster(many, { radius: 1, maxPreview: 4 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(10);
    expect(clusters[0].points).toHaveLength(4);
  });

  test('skips points with null coordinates', () => {
    const mixed = [
      { id: 1, latitude: 40, longitude: 74 },
      { id: 2, latitude: null, longitude: 74 },
      { id: 3, latitude: 40, longitude: null },
    ];
    const clusters = gridCluster(mixed, { radius: 1 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(1);
  });

  test('cluster centroid is the mean of member coordinates', () => {
    const pts = [
      { id: 1, latitude: 40, longitude: 74 },
      { id: 2, latitude: 44, longitude: 78 },
    ];
    const clusters = gridCluster(pts, { radius: 10 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].latitude).toBe(42);
    expect(clusters[0].longitude).toBe(76);
  });

  test('uses clusterRadiusFromDelta when radius is not given', () => {
    const closePoints = [
      { id: 1, latitude: 40.0, longitude: 74.0 },
      { id: 2, latitude: 40.001, longitude: 74.001 },
      { id: 3, latitude: 40.5, longitude: 74.5 },
    ];
    const clusters = gridCluster(closePoints, { latitudeDelta: 50 });
    // delta 50 → radius 1.0 → all 3 points in bucket (40, 74)
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
  });
});

describe('MAP_PROVIDERS', () => {
  test('contains osm and amap', () => {
    expect(MAP_PROVIDERS).toContain('osm');
    expect(MAP_PROVIDERS).toContain('amap');
  });
});
