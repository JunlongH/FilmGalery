/**
 * Tests for @filmgallery/api-client
 *
 * The package was previously dead code (0 consumers). These lock its HTTP
 * contract so it is safe to adopt as the shared client — in particular the
 * non-2xx behaviour is asserted to match the client's jsonFetch semantics
 * (throw with server error/status/body).
 */

const { createApiClient } = require('..');

// Build a fake fetch that responds with a given status + body.
const fakeFetch = (status, body, { statusText = '' } = {}) =>
  jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

describe('createApiClient — success path', () => {
  test('GET parses JSON and passes query params', async () => {
    const fetch = fakeFetch(200, { ok: true, items: [1, 2] });
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    const res = await api.http.get('/api/rolls', { film: 'Portra', n: 2 });
    expect(fetch).toHaveBeenCalledWith('http://x/api/rolls?film=Portra&n=2');
    expect(res).toEqual({ ok: true, items: [1, 2] });
  });

  test('returns raw text when the body is not JSON', async () => {
    const fetch = fakeFetch(200, 'plain-string', { statusText: 'OK' });
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    const res = await api.http.get('/api/health');
    expect(res).toBe('plain-string');
  });
});

describe('createApiClient — non-2xx throws (jsonFetch parity)', () => {
  test('throws with server error message + status + body', async () => {
    const fetch = fakeFetch(403, { error: 'Forbidden zone' });
    const api = createApiClient({ baseUrl: 'http://x', fetch });

    await expect(api.http.get('/api/secret')).rejects.toMatchObject({
      message: 'Forbidden zone',
      status: 403,
      body: { error: 'Forbidden zone' },
    });
  });

  test('falls back to HTTP status line when no server message', async () => {
    const fetch = fakeFetch(500, 'crash', { statusText: 'Internal Server Error' });
    const api = createApiClient({ baseUrl: 'http://x', fetch });

    await expect(api.http.get('/api/boom')).rejects.toMatchObject({
      status: 500,
    });
  });

  test('POST sends JSON body and surfaces 4xx', async () => {
    const fetch = fakeFetch(422, { error: 'validation failed' });
    const api = createApiClient({ baseUrl: 'http://x', fetch });

    await expect(api.http.post('/api/rolls', { bad: 1 })).rejects.toMatchObject({
      message: 'validation failed',
      status: 422,
    });
    expect(fetch).toHaveBeenCalledWith('http://x/api/rolls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bad: 1 }),
    });
  });
});

describe('createApiClient — onError hook', () => {
  test('global onError is invoked before the error propagates', async () => {
    const fetch = fakeFetch(500, { error: 'boom' });
    const onError = jest.fn();
    const api = createApiClient({ baseUrl: 'http://x', fetch, onError });

    await expect(api.http.get('/api/x')).rejects.toThrow('boom');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ status: 500, message: 'boom' });
  });
});
