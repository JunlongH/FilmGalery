/**
 * @filmgallery/api-client
 *
 * Shared API client for FilmGallery applications.
 * Works in both browser (React) and React Native environments.
 *
 * Usage:
 *   import { createApiClient } from '@filmgallery/api-client';
 *
 *   const api = createApiClient({ baseUrl: 'http://localhost:4000' });
 *   const rolls = await api.rolls.list();
 *
 * Resilience:
 *   - `retry`: re-attempt the SAME url on network errors (watch-style).
 *   - `failover`: on network error, toggle to `backupUrl` for one attempt and
 *     KEEP using it (sticky) until setBaseUrl() resets it (mobile-style).
 *   HTTP status errors (4xx/5xx) are never retried — only transport failures.
 */

const { createEquipmentApi } = require('./equipment');
const { createRollsApi } = require('./rolls');
const { createPhotosApi } = require('./photos');
const { createFilmsApi } = require('./films');
const { createLocationsApi } = require('./locations');
const { createStatsApi } = require('./stats');
const { createMetadataApi } = require('./metadata');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A network error is a transport-level failure (fetch rejected, or abort) —
 * NOT an HTTP status error. HTTP errors produced by parseResponse carry a
 * `.status` and must never be retried.
 */
function isNetworkError(err) {
  if (!err || err.status) return false;
  const name = err.name;
  const msg = String(err.message || '');
  return name === 'TypeError' // fetch throws TypeError on network failure
    || name === 'AbortError' // timeout / cancellation
    || /network|timeout|econnaborted|err_network/i.test(msg);
}

/**
 * Create a configured API client.
 *
 * @param {Object} config
 * @param {string} config.baseUrl - Primary API base URL.
 * @param {string} [config.backupUrl] - Secondary base URL (enables failover).
 * @param {Function} [config.fetch] - Injected fetch (tests / RN).
 * @param {Function} [config.onError] - Global error hook (fires once per failed request).
 * @param {{maxRetries?: number, delayMs?: number, backoff?: 'linear'|'fixed'}} [config.retry]
 *   Same-URL retry on network errors.
 * @param {boolean} [config.failover] - Toggle to `backupUrl` on network error (sticky).
 * @returns {Object} API client with all resource endpoints + http helpers.
 */
function createApiClient(config = {}) {
  const {
    baseUrl = 'http://127.0.0.1:4000',
    backupUrl = null,
    fetch: customFetch,
    onError,
    retry = null,
    failover = false,
    timeout = 0,
  } = config;

  const fetchFn = customFetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) {
    throw new Error('fetch is not available. Please provide a custom fetch implementation.');
  }

  // Mutable active base — failover toggles this (sticky) so subsequent requests
  // keep using the recovered URL until setBaseUrl() resets it.
  const state = { activeBaseUrl: baseUrl };

  const http = createHttpHelpers({
    getBaseUrl: () => state.activeBaseUrl,
    setBaseUrl: (url) => { state.activeBaseUrl = url; },
    primaryBaseUrl: baseUrl,
    backupUrl,
    fetchFn,
    onError,
    retry,
    failover: failover && !!backupUrl,
    timeout,
  });

  return {
    /** Active base URL (may differ from primary after a sticky failover). */
    get baseUrl() { return state.activeBaseUrl; },
    /** Configured primary base URL. */
    get primaryBaseUrl() { return baseUrl; },
    backupUrl,
    setBaseUrl: http.setBaseUrl,
    http,
    equipment: createEquipmentApi(http),
    rolls: createRollsApi(http),
    photos: createPhotosApi(http),
    films: createFilmsApi(http),
    locations: createLocationsApi(http),
    stats: createStatsApi(http),
    metadata: createMetadataApi(http),
  };
}

function createHttpHelpers({ getBaseUrl, setBaseUrl, primaryBaseUrl, backupUrl, fetchFn, onError, retry, failover, timeout }) {
  const handleError = (error) => {
    if (onError) onError(error);
    throw error;
  };

  const parseResponse = async (response) => {
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    // Throw on non-2xx so callers/React Query can distinguish success from
    // failure. Surface the server's `error`/`message`; attach status + body.
    if (!response.ok) {
      const serverMsg = parsed && (parsed.error || parsed.message);
      const msg = (typeof serverMsg === 'string' && serverMsg)
        || `HTTP ${response.status} ${response.statusText || ''}`.trim();
      const err = new Error(msg || `HTTP ${response.status}`);
      err.status = response.status;
      if (parsed !== undefined) err.body = parsed;
      throw err;
    }
    return parsed !== undefined ? parsed : text;
  };

  // One fetch attempt + parse. Applies a per-request abort timeout (so a hung
  // server surfaces as an AbortError → network error → retried/failed-over).
  // Respects a caller-supplied signal if present.
  async function attempt(url, init) {
    const signal = init && init.signal;
    let controller;
    let timer;
    if (timeout > 0 && !signal) {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeout);
    }
    try {
      const response = await fetchFn(url, controller ? { ...init, signal: controller.signal } : init);
      return await parseResponse(response);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Resilient request: same-URL retries (network errors only), then a single
   * failover attempt on the alternate URL (sticky toggle). HTTP errors are
   * thrown immediately without retry.
   */
  async function request(path, init) {
    const maxRetries = (retry && retry.maxRetries) || 0;
    const delayMs = (retry && retry.delayMs) || 1000;
    const backoff = (retry && retry.backoff) === 'fixed' ? 'fixed' : 'linear';

    let lastErr;
    for (let attemptIdx = 0; attemptIdx <= maxRetries; attemptIdx++) {
      try {
        return await attempt(getBaseUrl() + path, init);
      } catch (err) {
        lastErr = err;
        if (!isNetworkError(err)) return handleError(err);
        if (attemptIdx < maxRetries) {
          const factor = backoff === 'linear' ? (attemptIdx + 1) : 1;
          if (delayMs > 0) await sleep(delayMs * factor);
        }
      }
    }

    // Failover: toggle to the alternate base, single attempt (sticky).
    if (failover) {
      const other = getBaseUrl() === primaryBaseUrl ? backupUrl : primaryBaseUrl;
      if (other && other !== getBaseUrl()) {
        setBaseUrl(other);
        try {
          return await attempt(getBaseUrl() + path, init);
        } catch (err) {
          lastErr = err;
          if (!isNetworkError(err)) return handleError(err);
        }
      }
    }
    return handleError(lastErr);
  }

  return {
    /** Active base URL. */
    get baseUrl() { return getBaseUrl(); },
    setBaseUrl,

    async get(path, params = {}) {
      return request(`${path}${buildQueryString(params)}`, { method: 'GET' });
    },

    async post(path, data = {}) {
      return request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    async put(path, data = {}) {
      return request(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    async delete(path) {
      return request(path, { method: 'DELETE' });
    },

    /**
     * POST FormData (file uploads). Outside the resilience loop — uploads are
     * rare and neither mobile nor watch uses this path today.
     */
    async postForm(path, formData, onProgress) {
      if (typeof XMLHttpRequest !== 'undefined' && onProgress) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${getBaseUrl()}${path}`);
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText)); }
              catch { resolve(xhr.responseText); }
            } else {
              reject(new Error(xhr.statusText || 'Upload failed'));
            }
          };
          xhr.onerror = () => reject(new Error('Network error'));
          if (xhr.upload && onProgress) {
            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
            };
          }
          xhr.send(formData);
        });
      }
      try {
        const response = await fetchFn(`${getBaseUrl()}${path}`, { method: 'POST', body: formData });
        return await parseResponse(response);
      } catch (error) {
        return handleError(error);
      }
    },

    buildUploadUrl(pathOrUrl) {
      const base = getBaseUrl();
      if (!pathOrUrl) return null;
      if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
      if (pathOrUrl.startsWith('/')) return `${base}${pathOrUrl}`;
      const lower = pathOrUrl.toLowerCase();
      const idx = lower.indexOf('uploads');
      if (idx !== -1) {
        const sub = pathOrUrl.slice(idx).replace(/\\/g, '/').replace(/^\/+/, '');
        return `${base}/${sub}`;
      }
      return `${base}/uploads/${pathOrUrl.replace(/^\/+/, '')}`;
    },
  };
}

function buildQueryString(params) {
  if (!params || Object.keys(params).length === 0) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach((v) => qs.append(key, v));
      } else {
        qs.append(key, String(value));
      }
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

module.exports = {
  createApiClient,
  createHttpHelpers,
  buildQueryString,
  isNetworkError,
};
