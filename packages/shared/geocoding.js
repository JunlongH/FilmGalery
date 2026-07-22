/**
 * Unified geocoding module — forward (address → coords) and reverse
 * (coords → address) with a provider chain.
 *
 * Eliminates the three-way duplication that previously existed between
 *   - client/src/utils/geocoding.js (desktop, AMap/Photon/Nominatim)
 *   - mobile/src/services/locationService.native.ts (AMap/BigDataCloud/Expo)
 *   - packages/shared/geocode.js (BigDataCloud only)
 *
 * Design:
 *   - Pure functions: provider config is injected via opts, never read from
 *     localStorage/AsyncStorage here. Each platform reads its own storage and
 *     passes { provider, amapKey } in. Keeps the module testable.
 *   - All coordinates in/out are WGS-84. AMap's GCJ-02 is converted at the
 *     provider boundary (searchWithAmap / reverseWithAmap) using coordTransform.
 *   - reverseGeocode NEVER throws on "no address found" — returns an empty
 *     GeocodeResult (coords echoed, strings ''). searchAddress returns [] on
 *     total failure. Individual provider functions DO throw on transport error
 *     so the public chain can fall through to the next provider.
 *   - Nominatim is rate-limited (1.1s between calls, per their usage policy).
 *   - BigDataCloud is used as the final reverse-geocode fallback (no key,
 *     works in China) — reuses packages/shared/geocode.js.
 */

const { wgs84ToGcj02, gcj02ToWgs84 } = require('./coordTransform');
const { reverseGeocodeBigDataCloud } = require('./geocode');

const PHOTON_BASE = 'https://photon.komoot.io';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const AMAP_BASE = 'https://restapi.amap.com/v3';

const DEFAULT_TIMEOUT = 5000;
const NOMINATIM_RATE_LIMIT_MS = 1100;

// ---------------------------------------------------------------------------
// Nominatim rate limiting (module-level — shared across all callers in a
// process, matching the upstream usage policy of 1 req/s per IP).
// ---------------------------------------------------------------------------
let lastNominatimTime = 0;
function waitForNominatimRateLimit() {
  const now = Date.now();
  const elapsed = now - lastNominatimTime;
  if (elapsed < NOMINATIM_RATE_LIMIT_MS) {
    // Reserve the next slot atomically — set the target time NOW so
    // concurrent callers see a future timestamp and queue behind us.
    const waitMs = NOMINATIM_RATE_LIMIT_MS - elapsed;
    lastNominatimTime = now + waitMs;
    return new Promise((r) => setTimeout(() => r(), waitMs));
  }
  lastNominatimTime = now;
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a fetch implementation: explicit opt-in, then global. */
function resolveFetch(opts) {
  const f = opts && opts.fetch;
  if (f) return f;
  if (typeof fetch !== 'undefined') return fetch;
  throw new Error('geocoding: fetch is not available (pass opts.fetch)');
}

/** Build an AbortController that fires after opts.timeout (default 5s). */
function withTimeout(opts) {
  const timeout = (opts && opts.timeout) || DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

/** Throw immediately if a signal is already aborted (matches fetch behavior). */
function assertNotAborted(opts) {
  if (opts && opts.signal && opts.signal.aborted) {
    throw new Error('aborted');
  }
}

/** Coerce any provider's raw shape into the canonical GeocodeResult. */
function toGeocodeResult(raw, latitude, longitude) {
  return {
    displayName: (raw && raw.displayName) || '',
    country: (raw && raw.country) || '',
    city: (raw && raw.city) || '',
    state: (raw && raw.state) || '',
    latitude,
    longitude,
  };
}

// ---------------------------------------------------------------------------
// Forward geocoding providers (address → coordinates)
// ---------------------------------------------------------------------------

/**
 * Search via AMap REST. AMap returns GCJ-02; we convert to WGS-84 so all
 * downstream code and the DB stay in a single coordinate system.
 *
 * @param {string} query
 * @param {string} amapKey
 * @param {number} limit
 * @param {object} opts - { signal, fetch }
 * @returns {Promise<import('@filmgallery/types').SearchResult[]>}
 */
async function searchWithAmap(query, amapKey, limit, opts = {}) {
  assertNotAborted(opts);
  const fetchFn = resolveFetch(opts);
  const params = new URLSearchParams({
    address: query.trim(),
    key: amapKey,
    output: 'JSON',
  });
  const response = await fetchFn(`${AMAP_BASE}/geocode/geo?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Amap geocoding failed: ${response.status}`);
  const data = await response.json();
  if (data.status !== '1') throw new Error(`Amap geocoding error: ${data.info}`);

  return (data.geocodes || []).slice(0, limit).map((g) => {
    const [gcjLng, gcjLat] = (g.location || '0,0').split(',').map(Number);
    const { lat, lng } = gcj02ToWgs84(gcjLat, gcjLng);
    return {
      displayName: g.formatted_address || '',
      latitude: lat,
      longitude: lng,
      country: g.country || '中国',
      city: g.city || g.district || '',
      state: g.province || '',
      road: '',
      houseNumber: '',
    };
  });
}

/**
 * Search via Photon (Komoot). Returns WGS-84 directly (GeoJSON).
 * @returns {Promise<import('@filmgallery/types').SearchResult[]>}
 */
async function searchWithPhoton(query, limit, opts = {}) {
  assertNotAborted(opts);
  const fetchFn = resolveFetch(opts);
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  const response = await fetchFn(`${PHOTON_BASE}/api?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Photon geocoding failed: ${response.status}`);
  const data = await response.json();
  return (data.features || []).map((f) => {
    const props = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [0, 0];
    return {
      displayName:
        props.name +
        (props.city ? `, ${props.city}` : '') +
        (props.country ? `, ${props.country}` : ''),
      latitude: coords[1],
      longitude: coords[0],
      country: props.country || '',
      city: props.city || props.locality || props.district || '',
      state: props.state || '',
      road: props.street || '',
      houseNumber: props.housenumber || '',
    };
  });
}

/**
 * Search via Nominatim (OSM). Rate-limited (1.1s). Returns WGS-84.
 * @returns {Promise<import('@filmgallery/types').SearchResult[]>}
 */
async function searchWithNominatim(query, limit, countryCode, opts = {}) {
  assertNotAborted(opts);
  await waitForNominatimRateLimit();
  const fetchFn = resolveFetch(opts);
  const params = new URLSearchParams({
    q: query.trim(),
    format: 'json',
    addressdetails: '1',
    limit: String(limit),
  });
  if (countryCode) params.append('countrycodes', countryCode.toLowerCase());
  const response = await fetchFn(`${NOMINATIM_BASE}/search?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: 'application/json', 'User-Agent': 'FilmGallery/1.0' },
  });
  if (!response.ok) throw new Error(`Nominatim geocoding failed: ${response.status}`);
  const results = await response.json();
  return results.map((r) => ({
    displayName: r.display_name,
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
    country: (r.address && r.address.country) || '',
    city:
      (r.address && (r.address.city || r.address.town || r.address.village || r.address.municipality)) || '',
    state: (r.address && r.address.state) || '',
    road: (r.address && r.address.road) || '',
    houseNumber: (r.address && r.address.house_number) || '',
  }));
}

// ---------------------------------------------------------------------------
// Reverse geocoding providers (coordinates → address)
// ---------------------------------------------------------------------------

/**
 * Reverse geocode via AMap. Input is WGS-84 → convert to GCJ-02 for the API
 * call. Result coordinates echo the original WGS-84 input.
 * @returns {Promise<Partial<import('@filmgallery/types').GeocodeResult> | null>}
 */
async function reverseWithAmap(latitude, longitude, amapKey, opts = {}) {
  assertNotAborted(opts);
  const fetchFn = resolveFetch(opts);
  const gcj = wgs84ToGcj02(latitude, longitude);
  const params = new URLSearchParams({
    location: `${gcj.lng},${gcj.lat}`,
    key: amapKey,
    output: 'JSON',
  });
  const response = await fetchFn(`${AMAP_BASE}/geocode/regeo?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Amap reverse geocoding failed: ${response.status}`);
  const data = await response.json();
  if (data.status !== '1') throw new Error(`Amap reverse geocoding error: ${data.info}`);
  const regeo = data.regeocode;
  if (!regeo) return null;
  const comp = regeo.addressComponent || {};
  return {
    displayName: regeo.formatted_address || '',
    country: comp.country || '中国',
    city: comp.city || comp.district || '',
    state: comp.province || '',
  };
}

/**
 * Reverse geocode via Photon. Returns WGS-84 (no conversion needed).
 * @returns {Promise<Partial<import('@filmgallery/types').GeocodeResult> | null>}
 */
async function reverseWithPhoton(latitude, longitude, opts = {}) {
  assertNotAborted(opts);
  const fetchFn = resolveFetch(opts);
  const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
  const response = await fetchFn(`${PHOTON_BASE}/reverse?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Photon reverse geocoding failed: ${response.status}`);
  const data = await response.json();
  const feature = data.features && data.features[0];
  if (!feature) return null;
  const props = feature.properties || {};
  return {
    displayName:
      props.name +
      (props.city ? `, ${props.city}` : '') +
      (props.country ? `, ${props.country}` : ''),
    country: props.country || '',
    city: props.city || props.locality || props.district || '',
    state: props.state || '',
  };
}

/**
 * Reverse geocode via Nominatim. Rate-limited.
 * @returns {Promise<Partial<import('@filmgallery/types').GeocodeResult> | null>}
 */
async function reverseWithNominatim(latitude, longitude, opts = {}) {
  assertNotAborted(opts);
  await waitForNominatimRateLimit();
  const fetchFn = resolveFetch(opts);
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'json',
    addressdetails: '1',
  });
  const response = await fetchFn(`${NOMINATIM_BASE}/reverse?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: 'application/json', 'User-Agent': 'FilmGallery/1.0' },
  });
  if (!response.ok) throw new Error(`Nominatim reverse geocoding failed: ${response.status}`);
  const result = await response.json();
  if (result.error) return null;
  return {
    displayName: result.display_name,
    country: (result.address && result.address.country) || '',
    city:
      (result.address &&
        (result.address.city || result.address.town || result.address.village)) ||
      '',
    state: (result.address && result.address.state) || '',
  };
}

/**
 * Reverse geocode via BigDataCloud (no key, works in China). Delegates to the
 * existing shared provider so mobile/watch behavior is preserved byte-for-byte.
 * @returns {Promise<import('@filmgallery/types').GeocodeResult>}
 */
async function reverseWithBigDataCloud(latitude, longitude, opts = {}) {
  assertNotAborted(opts);
  return reverseGeocodeBigDataCloud(latitude, longitude, {
    fetch: opts.fetch,
    timeout: (opts && opts.timeout) || DEFAULT_TIMEOUT,
    userAgent: 'FilmGallery/1.0',
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for an address and return coordinate candidates.
 *
 * Provider chain: AMap (if configured) → Photon → Nominatim. Returns [] on
 * total failure (never throws).
 *
 * @param {string} query - Address or place name (min 2 chars).
 * @param {import('@filmgallery/types').SearchOptions} [opts]
 * @returns {Promise<import('@filmgallery/types').SearchResult[]>}
 */
async function searchAddress(query, opts = {}) {
  if (!query || query.trim().length < 2) return [];
  const limit = opts.limit || 5;
  const countryCode = opts.countryCode || null;

  const { signal, cleanup } = withTimeout(opts);
  const callOpts = { signal, fetch: opts.fetch };
  try {
    if (opts.provider === 'amap' && opts.amapKey) {
      try {
        const results = await searchWithAmap(query, opts.amapKey, limit, callOpts);
        if (results.length > 0) return results;
      } catch (err) {
        console.warn('Amap geocoding failed, falling back to OSM:', err.message);
      }
    }
    try {
      const results = await searchWithPhoton(query, limit, callOpts);
      if (results.length > 0) return results;
    } catch (err) {
      console.warn('Photon geocoding failed, falling back to Nominatim:', err.message);
    }
    try {
      return await searchWithNominatim(query, limit, countryCode, callOpts);
    } catch (err) {
      console.error('All geocoding services failed:', err);
      return [];
    }
  } finally {
    cleanup();
  }
}

/**
 * Reverse geocode coordinates to an address.
 *
 * Provider chain: AMap (if configured) → Photon → Nominatim → BigDataCloud →
 * empty GeocodeResult. NEVER throws on "no address found" — returns an object
 * with empty string fields and the echoed input coordinates.
 *
 * @param {number} latitude - WGS-84 latitude.
 * @param {number} longitude - WGS-84 longitude.
 * @param {import('@filmgallery/types').GeocodeConfig} [opts]
 * @returns {Promise<import('@filmgallery/types').GeocodeResult>}
 */
async function reverseGeocode(latitude, longitude, opts = {}) {
  if (latitude == null || longitude == null ||
      typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return toGeocodeResult(null, latitude, longitude);
  }

  const { signal, cleanup } = withTimeout(opts);
  const callOpts = { signal, fetch: opts.fetch };
  try {
    if (opts.provider === 'amap' && opts.amapKey) {
      try {
        const result = await reverseWithAmap(latitude, longitude, opts.amapKey, callOpts);
        if (result) return toGeocodeResult(result, latitude, longitude);
      } catch (err) {
        console.warn('Amap reverse geocoding failed, falling back:', err.message);
      }
    }
    try {
      const result = await reverseWithPhoton(latitude, longitude, callOpts);
      if (result) return toGeocodeResult(result, latitude, longitude);
    } catch (err) {
      console.warn('Photon reverse geocoding failed, falling back:', err.message);
    }
    try {
      const result = await reverseWithNominatim(latitude, longitude, callOpts);
      if (result) return toGeocodeResult(result, latitude, longitude);
    } catch (err) {
      console.warn('Nominatim reverse geocoding failed, falling back to BigDataCloud:', err.message);
    }
    try {
      return await reverseWithBigDataCloud(latitude, longitude, callOpts);
    } catch (err) {
      console.error('All reverse geocoding services failed:', err);
      return toGeocodeResult(null, latitude, longitude);
    }
  } finally {
    cleanup();
  }
}

/**
 * Get approximate coordinates for a country + city combination.
 * Convenience wrapper around searchAddress returning the first hit.
 *
 * @param {string} country
 * @param {string} city
 * @param {import('@filmgallery/types').GeocodeConfig} [opts]
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
async function getCityCoordinates(country, city, opts = {}) {
  if (!country && !city) return null;
  const query = city ? `${city}, ${country}` : country;
  const results = await searchAddress(query, { ...opts, limit: 1 });
  if (results.length > 0) {
    return { latitude: results[0].latitude, longitude: results[0].longitude };
  }
  return null;
}

module.exports = {
  searchAddress,
  reverseGeocode,
  getCityCoordinates,
  // Individual providers (exported for unit tests)
  searchWithAmap,
  searchWithPhoton,
  searchWithNominatim,
  reverseWithAmap,
  reverseWithPhoton,
  reverseWithNominatim,
  reverseWithBigDataCloud,
  // Constants
  PHOTON_BASE,
  NOMINATIM_BASE,
  AMAP_BASE,
  DEFAULT_TIMEOUT,
  NOMINATIM_RATE_LIMIT_MS,
};
