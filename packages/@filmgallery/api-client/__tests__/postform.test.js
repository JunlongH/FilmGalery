/**
 * Tests for http.postForm — the multipart upload path used by mobile's
 * digital import (api.digitalImport.preview).
 *
 * Two transport paths exist:
 *   1. XMLHttpRequest path (when global XMLHttpRequest + onProgress provided) —
 *      used by React Native (XHR is the only way to get upload progress in RN).
 *   2. fetch path (fallback / browser without progress).
 *
 * The XHR path had NO test coverage and was losing server error bodies on
 * non-2xx responses (only surfacing `statusText`/`'Upload failed'`), making
 * server errors invisible to the mobile UI. These tests pin both paths.
 */
const { createApiClient } = require('..');

// --- Mock XMLHttpRequest ---------------------------------------------------

let lastXhr = null;

class MockXHR {
  constructor() {
    lastXhr = this;
    this.method = null;
    this.url = null;
    this.headers = {};
    this.body = null;
    this.status = 0;
    this.statusText = '';
    this.responseText = '';
    this.response = '';
    this.timeout = 0;
    this.upload = { onprogress: null };
    this.onload = null;
    this.onerror = null;
    this.ontimeout = null;
    this._aborted = false;
  }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(body) { this.body = body; /* test triggers onload/onerror */ }
  abort() { this._aborted = true; }
}

function fireXhrLoad(xhr, status, statusText, responseText) {
  xhr.status = status;
  xhr.statusText = statusText;
  xhr.responseText = responseText;
  xhr.response = responseText;
  if (xhr.onload) xhr.onload();
}

function fireXhrError(xhr) {
  if (xhr.onerror) xhr.onerror();
}

// --- Tests -----------------------------------------------------------------

describe('http.postForm — XMLHttpRequest path (RN upload)', () => {
  beforeEach(() => {
    lastXhr = null;
    global.XMLHttpRequest = MockXHR;
    global.XMLHttpRequest.__exists = true;
  });
  afterEach(() => {
    delete global.XMLHttpRequest;
  });

  test('uses XHR when XMLHttpRequest + onProgress both available', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const form = new FormData();
    form.append('files', { uri: 'file:///a.jpg', name: 'a.jpg', type: 'image/jpeg' });
    const onProgress = jest.fn();

    const p = api.http.postForm('/api/digital/import/preview', form, onProgress);

    expect(lastXhr).not.toBeNull();
    expect(lastXhr.method).toBe('POST');
    expect(lastXhr.url).toBe('http://x/api/digital/import/preview');
    expect(lastXhr.body).toBe(form); // FormData passed straight through

    fireXhrLoad(lastXhr, 200, 'OK', JSON.stringify({ total: 1, items: [] }));

    const res = await p;
    expect(res).toEqual({ total: 1, items: [] });
    expect(onProgress).not.toHaveBeenCalled(); // no upload events fired in mock
  });

  test('multipart FormData with multiple files is passed unchanged to XHR.send', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const form = new FormData();
    // Three files sharing the same field name — standard multi-file multipart
    form.append('files', { uri: 'file:///a.jpg', name: 'a.jpg', type: 'image/jpeg' });
    form.append('files', { uri: 'file:///b.jpg', name: 'b.jpg', type: 'image/jpeg' });
    form.append('files', { uri: 'file:///c.jpg', name: 'c.jpg', type: 'image/jpeg' });

    const p = api.http.postForm('/api/digital/import/preview', form, jest.fn());

    expect(lastXhr.body).toBe(form);
    fireXhrLoad(lastXhr, 200, 'OK', JSON.stringify({ total: 3 }));
    await expect(p).resolves.toEqual({ total: 3 });
  });

  test('auth token is injected as Authorization header', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    api.setAuthToken('secret-token');

    const form = new FormData();
    const p = api.http.postForm('/api/upload', form, jest.fn());

    expect(lastXhr.headers['Authorization']).toBe('Bearer secret-token');
    fireXhrLoad(lastXhr, 200, 'OK', '{}');
    await p;
  });

  test('upload progress events invoke onProgress with percent', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const form = new FormData();
    const onProgress = jest.fn();

    const p = api.http.postForm('/api/upload', form, onProgress);

    // Simulate upload progress events (loaded/total bytes)
    const upload = lastXhr.upload;
    expect(typeof upload.onprogress).toBe('function');
    upload.onprogress({ lengthComputable: true, loaded: 250, total: 1000 });
    upload.onprogress({ lengthComputable: true, loaded: 1000, total: 1000 });

    expect(onProgress).toHaveBeenNthCalledWith(1, 25);
    expect(onProgress).toHaveBeenNthCalledWith(2, 100);

    fireXhrLoad(lastXhr, 200, 'OK', '{"ok":true}');
    await p;
  });

  test('non-2xx surfaces server error body + status (NOT just statusText)', async () => {
    // Regression: the XHR path used to reject `new Error(statusText || 'Upload failed')`,
    // discarding the server's JSON error body. Mobile's import wizard depends on
    // seeing the real server message (e.g. "No files uploaded", multer limits, EXIF errors).
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const form = new FormData();

    const p = api.http.postForm('/api/digital/import/preview', form, jest.fn());

    fireXhrLoad(lastXhr, 500, 'Internal Server Error', JSON.stringify({
      error: 'EXIF parse failed for IMG_0002.jpg',
    }));

    await expect(p).rejects.toMatchObject({
      message: 'EXIF parse failed for IMG_0002.jpg',
      status: 500,
      body: { error: 'EXIF parse failed for IMG_0002.jpg' },
    });
  });

  test('non-2xx with empty/HTML body falls back to status + statusText', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const form = new FormData();

    const p = api.http.postForm('/api/upload', form, jest.fn());

    fireXhrLoad(lastXhr, 413, 'Payload Too Large', '<html>too big</html>');

    await expect(p).rejects.toMatchObject({
      status: 413,
      message: expect.any(String),
    });
    // message must be non-empty — falls back to statusText / `HTTP <status>`
    // when the body isn't JSON.
    const err = await p.catch((e) => e);
    expect(err.message.length).toBeGreaterThan(0);
  });

  test('network error (xhr.onerror) rejects with a network error', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const form = new FormData();

    const p = api.http.postForm('/api/upload', form, jest.fn());

    fireXhrError(lastXhr);

    await expect(p).rejects.toThrow('Network error');
  });

  test('XHR has a timeout set and ontimeout rejects with a timeout error', async () => {
    // Regression guard: without xhr.timeout a hung connection leaves the
    // promise pending forever and the mobile UI stuck on a spinner. The fetch
    // path gets timeout protection via attempt()'s AbortController; XHR must
    // set its own ceiling.
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const form = new FormData();

    const p = api.http.postForm('/api/upload', form, jest.fn());

    expect(typeof lastXhr.ontimeout).toBe('function');
    expect(lastXhr.timeout).toBeGreaterThan(0);

    lastXhr.ontimeout();

    await expect(p).rejects.toThrow(/timed out/i);
  });

  test('401 response fires onUnauthorized hook once', async () => {
    const api = createApiClient({ baseUrl: 'http://x', fetch: jest.fn() });
    const onUnauthorized = jest.fn();
    api.setOnUnauthorized(onUnauthorized);

    const form = new FormData();
    const p = api.http.postForm('/api/upload', form, jest.fn());

    fireXhrLoad(lastXhr, 401, 'Unauthorized', '{"error":"bad token"}');

    await expect(p).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('http.postForm — fetch path (no XHR / no onProgress)', () => {
  beforeEach(() => { delete global.XMLHttpRequest; });
  afterEach(() => { delete global.XMLHttpRequest; });

  const okRes = (body) => ({
    ok: true, status: 200, statusText: 'OK',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const errRes = (status, body, statusText = '') => ({
    ok: false, status, statusText,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  test('falls back to fetch when onProgress is omitted', async () => {
    const fetch = jest.fn().mockResolvedValue(okRes({ total: 2 }));
    const api = createApiClient({ baseUrl: 'http://x', fetch });

    const form = new FormData();
    const res = await api.http.postForm('/api/upload', form);

    expect(fetch).toHaveBeenCalledWith(
      'http://x/api/upload',
      expect.objectContaining({ method: 'POST', body: form }),
    );
    expect(res).toEqual({ total: 2 });
  });

  test('fetch path surfaces server error body + status', async () => {
    const fetch = jest.fn().mockResolvedValue(errRes(500, { error: 'boom' }));
    const api = createApiClient({ baseUrl: 'http://x', fetch });

    const form = new FormData();
    await expect(api.http.postForm('/api/upload', form)).rejects.toMatchObject({
      message: 'boom', status: 500,
    });
  });

  test('auth token injected into fetch headers', async () => {
    const fetch = jest.fn().mockResolvedValue(okRes({}));
    const api = createApiClient({ baseUrl: 'http://x', fetch });
    api.setAuthToken('tok');

    const form = new FormData();
    await api.http.postForm('/api/upload', form);

    const init = fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
});
