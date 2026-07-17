/**
 * Endpoint-level tests: pins the corrected server paths and the new modules.
 *
 * These paths were previously wrong (the client was never consumed, so the bugs
 * were silent): photos.get used /api/photos/:id (server has /single/:id);
 * photos.getFavorites used /api/photos?favorite=1 (server has /api/photos/favorites);
 * locations.search used /api/locations/search (no such route; server uses /api/locations?q=).
 */

const { createApiClient } = require('..');

const okRes = (body) => ({
  ok: true, status: 200, statusText: 'OK',
  text: async () => JSON.stringify(body),
});

function clientWithLog() {
  const calls = [];
  const fetch = jest.fn(async (url) => { calls.push(url); return okRes({ ok: true }); });
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  return { api, calls };
}

describe('photos paths (corrected + added)', () => {
  test('get / getSingle hit /api/photos/single/:id', async () => {
    const { api, calls } = clientWithLog();
    await api.photos.get(7);
    await api.photos.getSingle(7);
    expect(calls[0]).toBe('http://x/api/photos/single/7');
    expect(calls[1]).toBe('http://x/api/photos/single/7');
  });
  test('getFavorites hits /api/photos/favorites (not ?favorite=1)', async () => {
    const { api, calls } = clientWithLog();
    await api.photos.getFavorites();
    expect(calls[0]).toBe('http://x/api/photos/favorites');
  });
  test('getRandom / getGeo / getNegatives', async () => {
    const { api, calls } = clientWithLog();
    await api.photos.getRandom(5);
    await api.photos.getGeo();
    await api.photos.getNegatives();
    expect(calls[0]).toBe('http://x/api/photos/random?limit=5');
    expect(calls[1]).toBe('http://x/api/photos/geo');
    expect(calls[2]).toBe('http://x/api/photos/negatives');
  });
});

describe('locations.search path (corrected)', () => {
  test('hits /api/locations?q= (no /search segment)', async () => {
    const { api, calls } = clientWithLog();
    await api.locations.search('Berlin');
    expect(calls[0]).toBe('http://x/api/locations?q=Berlin');
  });
});

describe('stats module (new)', () => {
  test('all five stats endpoints', async () => {
    const { api, calls } = clientWithLog();
    await api.stats.summary();
    await api.stats.inventory();
    await api.stats.activity();
    await api.stats.costs();
    await api.stats.gear();
    expect(calls).toEqual([
      'http://x/api/stats/summary',
      'http://x/api/stats/inventory',
      'http://x/api/stats/activity',
      'http://x/api/stats/costs',
      'http://x/api/stats/gear',
    ]);
  });
});

describe('metadata module (new)', () => {
  test('getOptions hits /api/metadata/options', async () => {
    const { api, calls } = clientWithLog();
    await api.metadata.getOptions();
    expect(calls[0]).toBe('http://x/api/metadata/options');
  });
});
