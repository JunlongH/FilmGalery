// C-13: Album API contract integration test.
//
// Drives the real `@filmgallery/api-client` (from
// packages/@filmgallery/api-client) with an injected `fetch` mock. Asserts the
// URL path, HTTP method, and JSON body that the client emits for the three
// album-photo operations the digital screens perform:
//   1. POST   /api/albums/:id/photos      { photo_ids: [...] }   (addPhotos)
//   2. DELETE /api/albums/:id/photos/:pid                         (removePhoto)
//   3. POST   /api/albums/:id/cover       { photo_id }            (setCover —
//      DigitalAlbumDetailScreen uses POST, not PUT; assert what's real)
//
// No network. fetch is mocked per-test.

import { createApiClient } from '@filmgallery/api-client';

const BASE = 'http://test.local';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeFetchMock(responder: (url: string, init: RequestInit) => any) {
  const calls: FetchCall[] = [];
  const fn: any = (url: string, init: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const body = responder(url, init);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as any);
  };
  (fn as any).calls = calls;
  return fn as any & { calls: FetchCall[] };
}

describe('album API contract (C-13)', () => {
  test('POST /api/albums/:id/photos sends photo_ids array', async () => {
    const fetchMock = makeFetchMock(() => ({ ok: true }));
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await api.http.post('/api/albums/7/photos', { photo_ids: [101, 102, 103] });

    expect(fetchMock.calls).toHaveLength(1);
    const { url, init } = fetchMock.calls[0];
    expect(url).toBe(`${BASE}/api/albums/7/photos`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ photo_ids: [101, 102, 103] });
  });

  test('DELETE /api/albums/:id/photos/:photoId uses correct path', async () => {
    const fetchMock = makeFetchMock(() => ({ ok: true }));
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await api.http.delete('/api/albums/7/photos/42');

    expect(fetchMock.calls).toHaveLength(1);
    const { url, init } = fetchMock.calls[0];
    expect(url).toBe(`${BASE}/api/albums/7/photos/42`);
    expect(init.method).toBe('DELETE');
  });

  test('POST /api/albums/:id/cover sends photo_id', async () => {
    const fetchMock = makeFetchMock(() => ({ ok: true }));
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    // Mirrors DigitalAlbumDetailScreen.handleSetCover: POST, not PUT.
    await api.http.post('/api/albums/7/cover', { photo_id: 42 });

    expect(fetchMock.calls).toHaveLength(1);
    const { url, init } = fetchMock.calls[0];
    expect(url).toBe(`${BASE}/api/albums/7/cover`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ photo_id: 42 });
  });

  test('GET /api/albums/:id/photos passes through albumId in path', async () => {
    const fetchMock = makeFetchMock(() => []);
    const api = createApiClient({ baseUrl: BASE, fetch: fetchMock });

    await api.http.get('/api/albums/7/photos');

    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0].url).toBe(`${BASE}/api/albums/7/photos`);
  });
});
