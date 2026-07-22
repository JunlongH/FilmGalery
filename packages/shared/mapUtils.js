/**
 * Shared map utilities: tile-layer config, grid clustering, coordinate
 * validation, and coordinate formatting.
 *
 * Eliminates tile-URL duplication between desktop PhotoMap.jsx, mobile
 * leaftletHtml.ts, and the new LocationPicker components. Also provides the
 * single source of truth for lat/lng range validation consumed by both the
 * client (input UI) and the server (PUT /api/photos/:id etc.).
 */

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Supported map/geocoding providers. */
const MAP_PROVIDERS = ['osm', 'amap'];

// ---------------------------------------------------------------------------
// Tile layers
// ---------------------------------------------------------------------------

/**
 * Tile-layer URLs keyed by provider → style. Leaflet's {x}{y}{z} are tile
 * indices (coordinate-system independent); markers, not tiles, need
 * WGS-84↔GCJ-02 conversion when overlaying AMap tiles.
 *
 * AMap dark mode is simulated via CSS filter on the tile container (see
 * leafletHtml.ts / PhotoMap.jsx); we don't emit a separate dark URL here.
 */
const TILE_LAYERS = {
  osm: {
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    satellite:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  amap: {
    light:
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    satellite:
      'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  },
};

/**
 * Resolve a tile URL for a provider + style. Falls back to OSM light so a
 * misconfigured amap/dark combo never produces an empty map.
 *
 * @param {'osm'|'amap'} provider
 * @param {'light'|'dark'|'satellite'} style
 * @returns {string}
 */
function buildTileLayerUrl(provider, style) {
  const layers = TILE_LAYERS[provider] || TILE_LAYERS.osm;
  return layers[style] || TILE_LAYERS.osm.light;
}

// ---------------------------------------------------------------------------
// Grid clustering
// ---------------------------------------------------------------------------

/**
 * Derive a cluster radius (in degrees of latitude) from a map's latitudeDelta.
 *
 * Mirrors the heuristic previously inlined in mobile MapScreen.tsx: world view
 * clusters by country, street view barely clusters. Exposed so callers can
 * compute the radius once and pass it to gridCluster.
 *
 * @param {number} latitudeDelta - Current map span (degrees).
 * @returns {number} Cluster radius in degrees.
 */
function clusterRadiusFromDelta(latitudeDelta) {
  const delta = Math.abs(latitudeDelta) || 0.05;
  if (delta > 5) return 1.0;
  if (delta > 1) return 0.3;
  if (delta > 0.3) return 0.08;
  if (delta > 0.1) return 0.02;
  if (delta > 0.02) return 0.005;
  return 0.001;
}

/**
 * O(n) grid-based clustering: bucket points into cells of `radius` degrees,
 * merge each cell into one cluster. Replaces the O(n²) pairwise scan.
 *
 * Extracted from mobile/src/screens/map/MapScreen.tsx so future map surfaces
 * (e.g. shot-log path map) can reuse it. Desktop PhotoMap.jsx still uses
 * react-leaflet-cluster (DOM-based) and is not migrated here.
 *
 * @param {Array<{ id: string|number, latitude: number, longitude: number, [k: string]: any }>} points
 * @param {object} opts
 * @param {number} [opts.radius] - Cluster radius in degrees. Defaults to a
 *   value derived from `opts.latitudeDelta` (or 0.05 if neither is given).
 * @param {number} [opts.latitudeDelta] - Map span; used to derive radius.
 * @param {number} [opts.maxPreview] - Max points kept in `cluster.points`
 *   (for mosaic previews). Default 4.
 * @returns {Array<{ id, latitude, longitude, count, points: any[], representative: any }>}
 */
function gridCluster(points, opts = {}) {
  const radius =
    opts.radius != null
      ? opts.radius
      : clusterRadiusFromDelta(opts.latitudeDelta);
  const maxPreview = opts.maxPreview != null ? opts.maxPreview : 4;

  const buckets = new Map();
  for (const p of points) {
    if (!p || p.latitude == null || p.longitude == null) continue;
    const key = `${Math.floor(p.latitude / radius)}:${Math.floor(p.longitude / radius)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p);
    else buckets.set(key, [p]);
  }

  const result = [];
  buckets.forEach((cluster) => {
    const count = cluster.length;
    const latitude = cluster.reduce((s, p) => s + p.latitude, 0) / count;
    const longitude = cluster.reduce((s, p) => s + p.longitude, 0) / count;
    result.push({
      id: cluster[0].id,
      latitude,
      longitude,
      count,
      points: cluster.slice(0, maxPreview),
      representative: cluster[0],
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Coordinate validation (shared by client UI and server route guards)
// ---------------------------------------------------------------------------

/**
 * @param {*} n
 * @returns {boolean}
 */
function isValidLatitude(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= -90 && n <= 90;
}

/**
 * @param {*} n
 * @returns {boolean}
 */
function isValidLongitude(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= -180 && n <= 180;
}

/**
 * A latitude/longitude pair is valid when both are null (unset) OR both are
 * in-range numbers. Mixed null/non-null or out-of-range values are invalid.
 *
 * @param {*} lat
 * @param {*} lng
 * @returns {boolean}
 */
function isValidLatLng(lat, lng) {
  if (lat == null && lng == null) return true;
  if (lat == null || lng == null) return false;
  return isValidLatitude(lat) && isValidLongitude(lng);
}

// ---------------------------------------------------------------------------
// Coordinate formatting
// ---------------------------------------------------------------------------

function toDms(value, isLat) {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = ((minFloat - min) * 60).toFixed(1);
  const dir = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${deg}°${min}'${sec}"${dir}`;
}

/**
 * Format a coordinate pair for display.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {'decimal'|'dms'} format - 'decimal' (default) or 'dms' (degrees/min/sec).
 * @returns {string}
 */
function formatLatLng(lat, lng, format = 'decimal') {
  if (format === 'dms') {
    return `${toDms(lat, true)} ${toDms(lng, false)}`;
  }
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

module.exports = {
  MAP_PROVIDERS,
  TILE_LAYERS,
  buildTileLayerUrl,
  clusterRadiusFromDelta,
  gridCluster,
  isValidLatitude,
  isValidLongitude,
  isValidLatLng,
  formatLatLng,
};
