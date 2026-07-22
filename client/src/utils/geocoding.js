/**
 * Desktop geocoding — thin wrapper around @filmgallery/shared/geocoding.
 *
 * Previously carried the full AMap/Photon/Nominatim provider chain inline.
 * The logic now lives once in the shared module; this file preserves the
 * existing export signatures so callers (GeoSearchInput, ShotLogModal,
 * PhotoDetailsSidebar) need zero changes.
 *
 * The shared module is pure (config injected via opts); this wrapper reads
 * localStorage for the map provider + AMap key and passes them in.
 */

import {
  searchAddress as sharedSearchAddress,
  reverseGeocode as sharedReverseGeocode,
  getCityCoordinates as sharedGetCityCoordinates,
} from '@filmgallery/shared/geocoding';

/**
 * Read the desktop map config from localStorage.
 * @returns {{ provider: 'osm'|'amap', amapKey: string }}
 */
export function getGeocodeConfig() {
  const provider = localStorage.getItem('map_provider') || 'osm';
  const amapKey = localStorage.getItem('amap_web_key') || '';
  return { provider, amapKey };
}

/**
 * Search for addresses and get coordinates.
 *
 * Provider chain (handled by the shared module): AMap (if configured) →
 * Photon → Nominatim. Returns [] on total failure.
 *
 * @param {string} query - Address or place name to search
 * @param {Object} [options]
 * @param {string} [options.country] - ISO country code to bias search (Nominatim)
 * @param {number} [options.limit=5] - Max results
 * @returns {Promise<Array<{displayName: string, latitude: number, longitude: number, country: string, city: string, state: string, road?: string, houseNumber?: string}>>}
 */
export const searchAddress = async (query, options = {}) => {
  const config = getGeocodeConfig();
  return sharedSearchAddress(query, {
    ...config,
    limit: options.limit || 5,
    countryCode: options.country || null,
  });
};

/**
 * Get coordinates for a country + city combination.
 * @param {string} country
 * @param {string} city
 * @returns {Promise<{latitude: number, longitude: number} | null>}
 */
export const getCityCoordinates = async (country, city) => {
  const config = getGeocodeConfig();
  return sharedGetCityCoordinates(country, city, config);
};

/**
 * Reverse geocode: get address from coordinates.
 *
 * Returns the canonical GeocodeResult (see @filmgallery/types) — never null.
 * On total failure every string field is '' (coordinates are still echoed).
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<import('@filmgallery/types').GeocodeResult>}
 */
export const reverseGeocode = async (latitude, longitude) => {
  const config = getGeocodeConfig();
  return sharedReverseGeocode(latitude, longitude, config);
};

const geocodingService = {
  searchAddress,
  getCityCoordinates,
  reverseGeocode,
};

export default geocodingService;
