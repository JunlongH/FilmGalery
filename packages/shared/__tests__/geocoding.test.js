/**
 * Tests for the unified geocoding module (packages/shared/geocoding.js).
 *
 * Pins:
 *   - Provider chain order (AMap → Photon → Nominatim → BigDataCloud)
 *   - AMap boundary coordinate transform (GCJ-02 ↔ WGS-84)
 *   - reverseGeocode NEVER throws on "no address found" — returns empty
 *     GeocodeResult with echoed coords
 *   - searchAddress returns [] on total failure
 *   - AbortSignal timeout aborts requests
 *   - Nominatim rate limiting (1.1s) is honoured
 *
 * Mock fetch is injected via opts.fetch so no network is exercised.
 */

const {
  searchAddress,
  reverseGeocode,
  getCityCoordinates,
  searchWithAmap,
  reverseWithAmap,
  NOMINATIM_RATE_LIMIT_MS,
} = require('../geocoding');
const { wgs84ToGcj02, gcj02ToWgs84 } = require('../coordTransform');

const okRes = (body) => ({ ok: true, status: 200, json: async () => body });

// Helper: build a fetch mock that returns the next response in a sequence.
const fetchSeq = (responses) => {
  let i = 0;
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    const r = responses[i++];
    if (r instanceof Error) return Promise.reject(r);
    if (typeof r === 'function') return r(url, init);
    return Promise.resolve(r);
  };
  fn.calls = calls;
  return fn;
};

describe('searchAddress', () => {
  test('returns [] for queries shorter than 2 chars', async () => {
    expect(await searchAddress('', { provider: 'osm' })).toEqual([]);
    expect(await searchAddress('a', { provider: 'osm' })).toEqual([]);
  });

  test('AMap provider converts GCJ-02 result to WGS-84', async () => {
    // AMap returns GCJ-02 coords; we expect WGS-84 in the output.
    // Use a point inside China so the transform actually shifts it.
    const beijingGcj = wgs84ToGcj02(39.907, 116.391);
    const amapResponse = {
      status: '1',
      geocodes: [
        {
          formatted_address: '北京市天安门',
          location: `${beijingGcj.lng},${beijingGcj.lat}`,
          country: '中国',
          city: '北京',
          province: '北京市',
        },
      ],
    };
    const fetch = fetchSeq([okRes(amapResponse)]);
    const results = await searchAddress('天安门', {
      provider: 'amap',
      amapKey: 'fake-key',
      fetch,
    });

    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe('北京市天安门');
    expect(results[0].country).toBe('中国');
    // Output should NOT equal the GCJ-02 input — transform must have applied.
    expect(results[0].latitude).toBeCloseTo(39.907, 4);
    expect(results[0].longitude).toBeCloseTo(116.391, 4);
  });

  test('falls back to Photon when AMap returns empty geocodes', async () => {
    const amapResponse = { status: '1', geocodes: [] };
    const photonResponse = {
      features: [
        {
          properties: { name: 'Eiffel Tower', country: 'France', city: 'Paris' },
          geometry: { coordinates: [2.2945, 48.8584] },
        },
      ],
    };
    const fetch = fetchSeq([okRes(amapResponse), okRes(photonResponse)]);
    const results = await searchAddress('Eiffel', {
      provider: 'amap',
      amapKey: 'fake-key',
      fetch,
    });

    expect(results).toHaveLength(1);
    expect(results[0].displayName).toContain('Eiffel Tower');
    expect(results[0].country).toBe('France');
  });

  test('falls back to Photon → Nominatim when AMap throws', async () => {
    const photonErr = new Error('Photon down');
    const photonResponse = {
      features: [
        {
          properties: { name: 'Berlin', country: 'Germany' },
          geometry: { coordinates: [13.405, 52.52] },
        },
      ],
    };
    const fetch = fetchSeq([photonErr, okRes(photonResponse)]);
    const results = await searchAddress('Berlin', {
      provider: 'amap',
      amapKey: 'fake-key',
      fetch,
    });
    expect(results).toHaveLength(1);
    expect(results[0].country).toBe('Germany');
  });

  test('returns [] when all providers fail', async () => {
    const fetch = fetchSeq([
      new Error('Amap down'),
      new Error('Photon down'),
      new Error('Nominatim down'),
    ]);
    const results = await searchAddress('nowhere', {
      provider: 'amap',
      amapKey: 'fake-key',
      fetch,
    });
    expect(results).toEqual([]);
  });

  test('does NOT call AMap when provider is osm', async () => {
    const photonResponse = { features: [] };
    const nominatimResponse = [];
    const fetch = fetchSeq([okRes(photonResponse), okRes(nominatimResponse)]);
    await searchAddress('test', { provider: 'osm', fetch });
    expect(fetch.calls[0].url).toContain('photon.komoot.io');
    expect(fetch.calls[0].url).not.toContain('amap.com');
  });

  test('does NOT call AMap when amapKey is missing', async () => {
    const photonResponse = { features: [] };
    const nominatimResponse = [];
    const fetch = fetchSeq([okRes(photonResponse), okRes(nominatimResponse)]);
    await searchAddress('test', { provider: 'amap', amapKey: '', fetch });
    expect(fetch.calls[0].url).not.toContain('amap.com');
  });
});

describe('reverseGeocode', () => {
  test('returns empty GeocodeResult for null/undefined/NaN inputs', async () => {
    const r1 = await reverseGeocode(null, 50, { provider: 'osm' });
    expect(r1.latitude).toBeNull();
    const r2 = await reverseGeocode(50, undefined, { provider: 'osm' });
    expect(r2.longitude).toBeUndefined();
    const r3 = await reverseGeocode(NaN, 50, { provider: 'osm' });
    expect(r3.displayName).toBe('');
  });

  test('does NOT reject latitude=0 or longitude=0 (equator/prime meridian)', async () => {
    // 0 is a valid coordinate — must not be treated as falsy. (Review C2)
    const fetch = fetchSeq([
      new Error('Photon down'),
      new Error('Nominatim down'),
      new Error('BigDataCloud down'),
    ]);
    const r = await reverseGeocode(0, 0, { provider: 'osm', fetch });
    // Should attempt providers (not short-circuit), then return empty on failure.
    expect(r).toEqual({
      displayName: '',
      country: '',
      city: '',
      state: '',
      latitude: 0,
      longitude: 0,
    });
    expect(fetch.calls.length).toBeGreaterThan(0); // providers were attempted
  });

  test('AMap provider converts WGS-84 input to GCJ-02 for the API call', async () => {
    const beijingGcj = wgs84ToGcj02(39.907, 116.391);
    let capturedUrl = '';
    const fetch = (url) => {
      capturedUrl = url;
      return Promise.resolve(
        okRes({
          status: '1',
          regeocode: {
            formatted_address: '北京市东城区',
            addressComponent: {
              country: '中国',
              city: '北京',
              province: '北京市',
            },
          },
        })
      );
    };
    const r = await reverseGeocode(39.907, 116.391, {
      provider: 'amap',
      amapKey: 'fake-key',
      fetch,
    });

    // The URL must contain the GCJ-02 coordinates, not the WGS-84 input.
    // URLSearchParams encodes the comma as %2C, so check the numeric values.
    expect(capturedUrl).toContain(`location=${beijingGcj.lng}%2C${beijingGcj.lat}`);
    expect(r.displayName).toBe('北京市东城区');
    expect(r.country).toBe('中国');
    // Output coords echo the WGS-84 INPUT (not the GCJ-02 sent to AMap).
    expect(r.latitude).toBe(39.907);
    expect(r.longitude).toBe(116.391);
  });

  test('falls back through AMap → Photon → Nominatim → BigDataCloud', async () => {
    const photonErr = new Error('Photon down');
    const nominatimErr = new Error('Nominatim down');
    const bdcResponse = {
      countryName: 'Japan',
      principalSubdivision: 'Tokyo',
      city: 'Tokyo',
      street: 'Shibuya',
    };
    const fetch = fetchSeq([
      photonErr,
      nominatimErr,
      okRes(bdcResponse),
    ]);
    const r = await reverseGeocode(35.6, 139.6, {
      provider: 'osm',
      fetch,
    });
    // AMap skipped (provider=osm), Photon threw, Nominatim threw,
    // BigDataCloud succeeded.
    expect(r.country).toBe('Japan');
    expect(r.city).toBe('Tokyo');
  });

  test('returns empty GeocodeResult when ALL providers fail (never throws)', async () => {
    const fetch = fetchSeq([
      new Error('Photon down'),
      new Error('Nominatim down'),
      new Error('BigDataCloud down'),
    ]);
    const r = await reverseGeocode(40.0, -74.0, { provider: 'osm', fetch });
    expect(r).toEqual({
      displayName: '',
      country: '',
      city: '',
      state: '',
      latitude: 40.0,
      longitude: -74.0,
    });
  });

  test('timeout aborts requests via AbortSignal', async () => {
    // fetch that never resolves but rejects on signal abort (mirrors real
    // fetch behavior, including failing fast when the signal is already
    // aborted — which happens for downstream providers after the first abort).
    const fetch = (url, init) =>
      new Promise((_, reject) => {
        if (init && init.signal) {
          if (init.signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }
      });
    // Use a very short timeout so the test doesn't wait 5s.
    await expect(
      reverseGeocode(40, -74, { provider: 'osm', fetch, timeout: 10 })
    ).resolves.toMatchObject({ latitude: 40, longitude: -74 });
  });
});

describe('getCityCoordinates', () => {
  test('returns null when both country and city are empty', async () => {
    expect(await getCityCoordinates('', '', { provider: 'osm' })).toBeNull();
  });

  test('returns the first search hit coordinates', async () => {
    const photonResponse = {
      features: [
        {
          properties: { name: 'Paris', country: 'France' },
          geometry: { coordinates: [2.3522, 48.8566] },
        },
      ],
    };
    const fetch = fetchSeq([okRes(photonResponse)]);
    const coords = await getCityCoordinates('France', 'Paris', {
      provider: 'osm',
      fetch,
    });
    expect(coords).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });

  test('returns null when search yields no results', async () => {
    const fetch = fetchSeq([okRes({ features: [] }), okRes([])]);
    expect(
      await getCityCoordinates('XX', 'Nowhere', { provider: 'osm', fetch })
    ).toBeNull();
  });
});

describe('Nominatim rate limiting', () => {
  test('two consecutive Nominatim calls are spaced by ~1.1s', async () => {
    // Use Photon failure to force both calls down to Nominatim.
    const photonErr = new Error('down');
    const nominatimResponse = [];
    const fetch = fetchSeq([
      photonErr,
      okRes(nominatimResponse), // first Nominatim call
      photonErr,
      okRes(nominatimResponse), // second Nominatim call
    ]);
    const start = Date.now();
    await searchAddress('test1', { provider: 'osm', fetch });
    await searchAddress('test2', { provider: 'osm', fetch });
    const elapsed = Date.now() - start;
    // At least one rate-limit gap (1.1s) between two Nominatim calls.
    expect(elapsed).toBeGreaterThanOrEqual(NOMINATIM_RATE_LIMIT_MS - 50);
  });

  test('concurrent Nominatim calls do not violate rate limit (race condition fix)', async () => {
    // Two concurrent reverseGeocode calls that both fall through to Nominatim.
    // Before the fix, both could pass the elapsed >= 1100 check simultaneously
    // and fire two Nominatim requests < 1.1s apart. After the fix, the second
    // call reserves a future time slot and waits.
    const nominatimResponse = { display_name: 'test', address: { country: 'X' } };
    let firstCallTime = 0;
    let secondCallTime = 0;
    const fetch = (url, init) => {
      if (url.includes('photon.komoot.io')) {
        return Promise.reject(new Error('Photon down'));
      }
      if (url.includes('nominatim')) {
        const now = Date.now();
        if (firstCallTime === 0) firstCallTime = now;
        else secondCallTime = now;
        return Promise.resolve(okRes(nominatimResponse));
      }
      return Promise.reject(new Error('unexpected'));
    };
    // Fire both concurrently
    await Promise.all([
      reverseGeocode(31.2, 121.4, { provider: 'osm', fetch }),
      reverseGeocode(39.9, 116.4, { provider: 'osm', fetch }),
    ]);
    // The two Nominatim calls must be spaced by at least ~1.1s
    const gap = Math.abs(secondCallTime - firstCallTime);
    expect(gap).toBeGreaterThanOrEqual(NOMINATIM_RATE_LIMIT_MS - 100);
  });
});
