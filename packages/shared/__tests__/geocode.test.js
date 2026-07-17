/**
 * Tests for the shared BigDataCloud reverse-geocode provider.
 *
 * Mobile and watch previously carried identical copies of this logic. It now
 * lives once in packages/shared/geocode.js and returns the canonical
 * GeocodeResult (@filmgallery/types). These pin the normalisation + the HTTP
 * contract (success / HTTP error / timeout abort) so both platforms can rely on
 * it without each carrying their own copy.
 */

const {
  normalizeBigDataCloud,
  reverseGeocodeBigDataCloud,
  BDC_BASE,
} = require('../geocode');

const okRes = (body) => ({ ok: true, status: 200, json: async () => body });

describe('normalizeBigDataCloud', () => {
  test('maps a full response to the canonical GeocodeResult', () => {
    const data = {
      countryName: 'United States',
      principalSubdivision: 'California',
      city: 'San Francisco',
      locality: 'SF',
      street: 'Market St',
      neighbourhood: 'SOMA',
    };
    expect(normalizeBigDataCloud(data, 37.77, -122.41)).toEqual({
      displayName: 'Market St, SOMA, SF',
      country: 'United States',
      city: 'San Francisco',
      state: 'California',
      latitude: 37.77,
      longitude: -122.41,
    });
  });

  test('falls back to the administrative name when street fields are empty', () => {
    const r = normalizeBigDataCloud(
      { countryName: 'CN', principalSubdivision: 'Beijing', localityInfo: { administrative: [{ name: 'Beijing Shi' }] } },
      1, 2
    );
    expect(r.displayName).toBe('Beijing Shi');
    expect(r.state).toBe('Beijing');
  });

  test('empty response → all string fields empty, coords echoed', () => {
    expect(normalizeBigDataCloud({}, 5, 6)).toEqual({
      displayName: '', country: '', city: '', state: '', latitude: 5, longitude: 6,
    });
  });
});

describe('reverseGeocodeBigDataCloud', () => {
  test('success: builds the request URL and returns a canonical result', async () => {
    const fetch = jest.fn().mockResolvedValue(
      okRes({ countryName: 'Japan', principalSubdivision: 'Tokyo', city: 'Tokyo', street: 'Shibuya' })
    );
    const r = await reverseGeocodeBigDataCloud(35.6, 139.6, { fetch });

    expect(fetch).toHaveBeenCalledWith(
      `${BDC_BASE}?latitude=35.6&longitude=139.6&localityLanguage=en`,
      expect.objectContaining({ headers: { 'User-Agent': 'FilmGallery/1.0' } })
    );
    expect(r).toMatchObject({ country: 'Japan', city: 'Tokyo', state: 'Tokyo', latitude: 35.6 });
  });

  test('HTTP error throws (so the caller fallback chain stays in control)', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(reverseGeocodeBigDataCloud(1, 2, { fetch })).rejects.toThrow('503');
  });

  test('timeout aborts the request and throws', async () => {
    const fetch = jest.fn((url, init) => new Promise((_, reject) => {
      if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(reverseGeocodeBigDataCloud(1, 2, { fetch, timeout: 10 })).rejects.toThrow('aborted');
  });

  test('honors custom userAgent + timeout options (watch uses longer timeout)', async () => {
    const fetch = jest.fn().mockResolvedValue(okRes({}));
    await reverseGeocodeBigDataCloud(1, 2, { fetch, userAgent: 'FilmGalleryWatch/1.0', timeout: 15000 });
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toBe('FilmGalleryWatch/1.0');
  });

  test('throws a clear error when fetch is null (no usable fetch)', async () => {
    // Note: passing { fetch: undefined } would fall back to the global fetch
    // (present on Node 18+ / RN), so we use null to exercise the guard.
    await expect(reverseGeocodeBigDataCloud(1, 2, { fetch: null })).rejects.toThrow('fetch is not available');
  });
});
