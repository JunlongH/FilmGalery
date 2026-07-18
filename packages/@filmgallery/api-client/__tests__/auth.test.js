/**
 * Tests for the Phase 2B #1 auth additions to @filmgallery/api-client:
 *   - setAuthToken/getAuthToken/clearAuthToken
 *   - Authorization: Bearer header injected on every request
 *   - 401 responses fire onUnauthorized once
 *   - header is NOT injected when no token is set
 *   - header injection plays nicely with resilience (retry/failover)
 */
const { createApiClient } = require('..');

const okRes = (body) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const unauthorized = () => ({
  ok: false,
  status: 401,
  statusText: 'Unauthorized',
  text: async () => JSON.stringify({ error: 'unauthorized' }),
});

test('no token set → no Authorization header', async () => {
  const fetch = jest.fn().mockResolvedValue(okRes({ ok: true }));
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  await api.http.get('/api/rolls');
  expect(fetch).toHaveBeenCalledWith('http://x/api/rolls', { method: 'GET' });
});

test('setAuthToken injects Authorization: Bearer <token>', async () => {
  const fetch = jest.fn().mockResolvedValue(okRes({ ok: true }));
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  api.setAuthToken('abc123');
  await api.http.get('/api/rolls');
  expect(fetch).toHaveBeenCalledWith('http://x/api/rolls', {
    method: 'GET',
    headers: { Authorization: 'Bearer abc123' },
  });
});

test('getAuthToken returns the current token', () => {
  const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
  expect(api.getAuthToken()).toBeNull();
  api.setAuthToken('abc');
  expect(api.getAuthToken()).toBe('abc');
  api.clearAuthToken();
  expect(api.getAuthToken()).toBeNull();
});

test('setAuthToken(null) clears the token', async () => {
  const fetch = jest.fn().mockResolvedValue(okRes({ ok: true }));
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  api.setAuthToken('abc');
  api.setAuthToken(null);
  await api.http.get('/api/rolls');
  expect(fetch).toHaveBeenLastCalledWith('http://x/api/rolls', { method: 'GET' });
});

test('header is preserved across retries', async () => {
  const fetch = jest
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(okRes({ ok: true }));
  const api = createApiClient({
    baseUrl: 'http://x', fetch,
    retry: { maxRetries: 1, delayMs: 0 },
  });
  api.setAuthToken('xyz');
  await api.http.get('/api/rolls');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenNthCalledWith(1, 'http://x/api/rolls', {
    method: 'GET', headers: { Authorization: 'Bearer xyz' },
  });
  expect(fetch).toHaveBeenNthCalledWith(2, 'http://x/api/rolls', {
    method: 'GET', headers: { Authorization: 'Bearer xyz' },
  });
});

test('header is preserved across sticky failover', async () => {
  const fetch = jest
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(okRes({ ok: true }));
  const api = createApiClient({
    baseUrl: 'http://primary', backupUrl: 'http://backup',
    failover: true, fetch,
  });
  api.setAuthToken('xyz');
  await api.http.get('/api/x');
  expect(fetch).toHaveBeenNthCalledWith(2, 'http://backup/api/x', {
    method: 'GET', headers: { Authorization: 'Bearer xyz' },
  });
});

test('401 fires onUnauthorized once with the response', async () => {
  const fetch = jest.fn().mockResolvedValue(unauthorized());
  const onUnauthorized = jest.fn();
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  api.setOnUnauthorized(onUnauthorized);
  api.setAuthToken('abc');
  // The request still rejects via the normal error path.
  await expect(api.http.get('/api/rolls')).rejects.toMatchObject({ status: 401 });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

test('onUnauthorized only fires for 401, not other errors', async () => {
  const fetch = jest.fn().mockResolvedValue({
    ok: false, status: 500, statusText: 'ISE',
    text: async () => JSON.stringify({ error: 'boom' }),
  });
  const onUnauthorized = jest.fn();
  const api = createApiClient({ baseUrl: 'http://x', fetch, onUnauthorized });
  api.setAuthToken('abc');
  await expect(api.http.get('/api/x')).rejects.toMatchObject({ status: 500 });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

test('setOnUnauthorized registers the callback post-construction', async () => {
  const fetch = jest.fn().mockResolvedValue(unauthorized());
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  const cb = jest.fn();
  api.setOnUnauthorized(cb);
  api.setAuthToken('abc');
  await expect(api.http.get('/api/x')).rejects.toMatchObject({ status: 401 });
  expect(cb).toHaveBeenCalledTimes(1);
});

test('Authorization header is injected on POST', async () => {
  const fetch = jest.fn().mockResolvedValue(okRes({ ok: true }));
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  api.setAuthToken('tok');
  await api.http.post('/api/rolls', { name: 'New' });
  expect(fetch).toHaveBeenCalledWith('http://x/api/rolls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: JSON.stringify({ name: 'New' }),
  });
});

test('Authorization header is injected on PUT', async () => {
  const fetch = jest.fn().mockResolvedValue(okRes({ ok: true }));
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  api.setAuthToken('tok');
  await api.http.put('/api/rolls/1', { name: 'X' });
  expect(fetch).toHaveBeenCalledWith('http://x/api/rolls/1', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
  }));
});

test('Authorization header is injected on DELETE', async () => {
  const fetch = jest.fn().mockResolvedValue(okRes({ ok: true }));
  const api = createApiClient({ baseUrl: 'http://x', fetch });
  api.setAuthToken('tok');
  await api.http.delete('/api/sessions/1');
  expect(fetch).toHaveBeenCalledWith('http://x/api/sessions/1', expect.objectContaining({
    headers: { Authorization: 'Bearer tok' },
  }));
});
