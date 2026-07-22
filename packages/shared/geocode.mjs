/**
 * Shared reverse-geocode provider for BigDataCloud.
 *
 * Mobile and watch previously carried byte-for-byte identical BigDataCloud
 * logic (same URL, same field extraction, same fallback). This module is the
 * single source. Each platform passes its own timeout / User-Agent via opts.
 *
 * Returns the canonical `GeocodeResult` shape (see @filmgallery/types). The
 * success path always echoes the input coordinates and fills `state` from
 * BigDataCloud's `principalSubdivision`. Throws on transport/HTTP failure so
 * the caller's fallback chain stays in control.
 */

const BDC_BASE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/**
 * Build a canonical GeocodeResult from a raw BigDataCloud response.
 * Pure and exported so it can be unit-tested without network.
 *
 * @param {any} data - Parsed BigDataCloud JSON.
 * @param {number} latitude - Echoed input latitude.
 * @param {number} longitude - Echoed input longitude.
 * @returns {import('@filmgallery/types').GeocodeResult}
 */
function normalizeBigDataCloud(data, latitude, longitude) {
  const street = (data && data.street) || '';
  const neighbourhood = (data && data.neighbourhood) || '';
  const locality = (data && data.locality) || '';
  const adminName =
    (data && data.localityInfo && data.localityInfo.administrative &&
      data.localityInfo.administrative[0] && data.localityInfo.administrative[0].name) || '';

  const displayName = [street, neighbourhood, locality].filter(Boolean).join(', ') || adminName;

  return {
    displayName,
    country: (data && data.countryName) || '',
    city: (data && (data.city || data.locality || data.principalSubdivision)) || '',
    state: (data && data.principalSubdivision) || '',
    latitude,
    longitude,
  };
}

/**
 * Reverse-geocode via BigDataCloud. Throws on HTTP/transport failure.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {Object} [opts]
 * @param {typeof fetch} [opts.fetch] - Injected fetch (tests); defaults to global fetch.
 * @param {number} [opts.timeout=5000] - Abort timeout in ms.
 * @param {string} [opts.userAgent='FilmGallery/1.0'] - Request User-Agent.
 * @returns {Promise<import('@filmgallery/types').GeocodeResult>}
 */
async function reverseGeocodeBigDataCloud(latitude, longitude, opts = {}) {
  const {
    fetch: fetchFn = (typeof fetch !== 'undefined' ? fetch : undefined),
    timeout = 5000,
    userAgent = 'FilmGallery/1.0',
  } = opts;

  if (!fetchFn) {
    throw new Error('reverseGeocodeBigDataCloud: fetch is not available');
  }

  const url = `${BDC_BASE}?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: userAgent ? { 'User-Agent': userAgent } : undefined,
    });
    if (!response.ok) {
      throw new Error(`BigDataCloud API error: ${response.status}`);
    }
    const data = await response.json();
    return normalizeBigDataCloud(data, latitude, longitude);
  } finally {
    clearTimeout(timer);
  }
}

const _sharedExports = {
  reverseGeocodeBigDataCloud,
  normalizeBigDataCloud,
  BDC_BASE,
};
export const { reverseGeocodeBigDataCloud, normalizeBigDataCloud, BDC_BASE } = _sharedExports;
export default _sharedExports;
