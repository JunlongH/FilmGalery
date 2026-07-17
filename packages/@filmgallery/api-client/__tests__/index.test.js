/**
 * Tests for @filmgallery/api-client core: success/error contract + resilience
 * (retry + sticky failover) + setBaseUrl.
 *
 * The package was previously dead code (0 consumers) with several path bugs and
 * NO resilience. Both watch (retry) and mobile (primary/secondary failover)
 * now rely on this behaviour, so it is pinned here with injected fetch mocks.
 */

const { createApiClient, isNetworkError } = require('..');

const okRes = (body) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const errRes = (status, body, statusText = '') => ({
  ok: false,
  status,
  statusText,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
// fetch rejects with TypeError on a transport-level failure (matches browsers/RN).
const netErr = () => new TypeError('Failed to fetch');

describe('isNetworkError', () => {
  test('transport failures are network errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isNetworkError(abort)).toBe(true);
    expect(isNetworkError(new Error('Network Error'))).toBe(true);
  });
  test('HTTP-status errors and normal errors are NOT network errors', () => {
    const httpErr = new Error('Forbidden');
    httpErr.status = 403;
    expect(isNetworkError(httpErr)).toBe(false);
    expect(isNetworkError(new Error('something else'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('createApiClient — success / HTTP error', () => {
  test('GET builds the URL + query and parses JSON', async () => {
    const fetch = jest.fn().mockResolvedValue(okRes({ items: [1, 2] }));
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    const res = await api.http.get('/api/rolls', { film: 'Portra' });
    expect(fetch).toHaveBeenCalledWith('http://x/api/rolls?film=Portra', { method: 'GET' });
    expect(res).toEqual({ items: [1, 2] });
  });

  test('non-2xx throws with server message + status + body', async () => {
    const fetch = jest.fn().mockResolvedValue(errRes(403, { error: 'Forbidden zone' }));
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    await expect(api.http.get('/api/secret')).rejects.toMatchObject({
      message: 'Forbidden zone',
      status: 403,
      body: { error: 'Forbidden zone' },
    });
  });

  test('HTTP errors are NOT retried (single attempt)', async () => {
    const fetch = jest.fn().mockResolvedValue(errRes(500, { error: 'boom' }));
    const api = createApiClient({ baseUrl: 'http://x', fetch, retry: { maxRetries: 3, delayMs: 0 } });
    await expect(api.http.get('/api/x')).rejects.toThrow('boom');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('onError fires once for an HTTP error', async () => {
    const fetch = jest.fn().mockResolvedValue(errRes(500, { error: 'boom' }));
    const onError = jest.fn();
    const api = createApiClient({ baseUrl: 'http://x', fetch, onError });
    await expect(api.http.get('/api/x')).rejects.toThrow('boom');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('createApiClient — retry (same URL, network errors only)', () => {
  test('retries up to maxRetries then rethrows', async () => {
    const fetch = jest.fn().mockRejectedValue(netErr());
    const api = createApiClient({ baseUrl: 'http://x', fetch, retry: { maxRetries: 2, delayMs: 1 } });
    await expect(api.http.get('/api/x')).rejects.toThrow('Failed to fetch');
    expect(fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(fetch).toHaveBeenLastCalledWith('http://x/api/x', { method: 'GET' });
  });

  test('succeeds when a later attempt recovers', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValueOnce(netErr())
      .mockResolvedValueOnce(okRes({ ok: true }));
    const api = createApiClient({ baseUrl: 'http://x', fetch, retry: { maxRetries: 2, delayMs: 1 } });
    const res = await api.http.get('/api/x');
    expect(res).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('createApiClient — timeout', () => {
  test('a hung request is aborted and surfaces as a network error', async () => {
    const fetch = jest.fn((url, init) => new Promise((_, reject) => {
      if (init && init.signal) init.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    }));
    const api = createApiClient({ baseUrl: 'http://x', fetch, timeout: 10 });
    await expect(api.http.get('/api/slow')).rejects.toThrow('aborted');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('timeout-triggered abort is retried (then succeeds)', async () => {
    let first = true;
    const f = jest.fn((_url, init) => {
      if (first) {
        first = false;
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
          });
        });
      }
      return Promise.resolve(okRes({ ok: true }));
    });
    const api = createApiClient({ baseUrl: 'http://x', fetch: f, timeout: 10, retry: { maxRetries: 1, delayMs: 1 } });
    const res = await api.http.get('/api/x');
    expect(res).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('createApiClient — failover (sticky primary/secondary toggle)', () => {
  test('on network error, toggles to backup and retries once (sticky)', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValueOnce(netErr()) // primary fails
      .mockResolvedValueOnce(okRes({ ok: true })); // backup succeeds
    const api = createApiClient({
      baseUrl: 'http://primary',
      backupUrl: 'http://backup',
      failover: true,
      fetch,
    });
    const res = await api.http.get('/api/x');
    expect(res).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, 'http://primary/api/x', { method: 'GET' });
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://backup/api/x', { method: 'GET' });
    // Sticky: active base is now the backup.
    expect(api.baseUrl).toBe('http://backup');
  });

  test('subsequent request keeps using the recovered backup (sticky)', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValueOnce(netErr())
      .mockResolvedValueOnce(okRes({ ok: true }))
      .mockResolvedValueOnce(okRes({ next: true }));
    const api = createApiClient({
      baseUrl: 'http://primary',
      backupUrl: 'http://backup',
      failover: true,
      fetch,
    });
    await api.http.get('/api/a'); // fails over to backup
    await api.http.get('/api/b'); // should go straight to backup
    expect(fetch).toHaveBeenLastCalledWith('http://backup/api/b', { method: 'GET' });
  });

  test('setBaseUrl resets the active base', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValueOnce(netErr())
      .mockResolvedValueOnce(okRes({ ok: true }))
      .mockResolvedValue(okRes({ reset: true }));
    const api = createApiClient({
      baseUrl: 'http://primary', backupUrl: 'http://backup', failover: true, fetch,
    });
    await api.http.get('/api/a'); // failover -> backup
    expect(api.baseUrl).toBe('http://backup');
    api.setBaseUrl('http://primary');
    expect(api.baseUrl).toBe('http://primary');
  });
});
