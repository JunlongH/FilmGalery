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
 */

const { createEquipmentApi } = require('./equipment');
const { createRollsApi } = require('./rolls');
const { createPhotosApi } = require('./photos');
const { createFilmsApi } = require('./films');
const { createLocationsApi } = require('./locations');

/**
 * Create a configured API client
 * @param {Object} config - Configuration options
 * @param {string} config.baseUrl - API base URL (e.g., 'http://localhost:4000')
 * @param {Function} [config.fetch] - Custom fetch implementation (for React Native)
 * @param {Function} [config.onError] - Global error handler
 * @returns {Object} API client with all resource endpoints
 */
function createApiClient(config = {}) {
  const { 
    baseUrl = 'http://127.0.0.1:4000',
    fetch: customFetch,
    onError
  } = config;
  
  // Use custom fetch or global fetch
  const fetchFn = customFetch || (typeof fetch !== 'undefined' ? fetch : null);
  
  if (!fetchFn) {
    throw new Error('fetch is not available. Please provide a custom fetch implementation.');
  }
  
  // Shared HTTP helpers
  const http = createHttpHelpers(baseUrl, fetchFn, onError);
  
  return {
    baseUrl,
    http,
    equipment: createEquipmentApi(http),
    rolls: createRollsApi(http),
    photos: createPhotosApi(http),
    films: createFilmsApi(http),
    locations: createLocationsApi(http),
  };
}

/**
 * Create HTTP helper functions
 */
function createHttpHelpers(baseUrl, fetchFn, onError) {
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
    // failure. Mirrors the client's jsonFetch contract: surface the server's
    // `error`/`message` when present, and attach status + body for diagnostics.
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
  
  return {
    baseUrl,
    
    /**
     * GET request
     */
    async get(path, params = {}) {
      try {
        const qs = buildQueryString(params);
        const url = `${baseUrl}${path}${qs}`;
        const response = await fetchFn(url);
        return await parseResponse(response);
      } catch (error) {
        return handleError(error);
      }
    },
    
    /**
     * POST JSON request
     */
    async post(path, data = {}) {
      try {
        const response = await fetchFn(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        return await parseResponse(response);
      } catch (error) {
        return handleError(error);
      }
    },
    
    /**
     * PUT JSON request
     */
    async put(path, data = {}) {
      try {
        const response = await fetchFn(`${baseUrl}${path}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        return await parseResponse(response);
      } catch (error) {
        return handleError(error);
      }
    },
    
    /**
     * DELETE request
     */
    async delete(path) {
      try {
        const response = await fetchFn(`${baseUrl}${path}`, {
          method: 'DELETE'
        });
        return await parseResponse(response);
      } catch (error) {
        return handleError(error);
      }
    },
    
    /**
     * POST FormData (for file uploads)
     */
    async postForm(path, formData, onProgress) {
      // For environments that support XMLHttpRequest (web)
      if (typeof XMLHttpRequest !== 'undefined' && onProgress) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${baseUrl}${path}`);
          
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                resolve(xhr.responseText);
              }
            } else {
              reject(new Error(xhr.statusText || 'Upload failed'));
            }
          };
          
          xhr.onerror = () => reject(new Error('Network error'));
          
          if (xhr.upload && onProgress) {
            xhr.upload.onprogress = (ev) => {
              if (ev.lengthComputable) {
                onProgress(Math.round(ev.loaded / ev.total * 100));
              }
            };
          }
          
          xhr.send(formData);
        });
      }
      
      // Fallback to fetch (no progress support)
      try {
        const response = await fetchFn(`${baseUrl}${path}`, {
          method: 'POST',
          body: formData
        });
        return parseResponse(response);
      } catch (error) {
        return handleError(error);
      }
    },
    
    /**
     * Build absolute URL for uploads
     */
    buildUploadUrl(pathOrUrl) {
      if (!pathOrUrl) return null;
      if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
      if (pathOrUrl.startsWith('/')) return `${baseUrl}${pathOrUrl}`;
      
      // Handle Windows paths with 'uploads' in them
      const lower = pathOrUrl.toLowerCase();
      const idx = lower.indexOf('uploads');
      if (idx !== -1) {
        const sub = pathOrUrl.slice(idx).replace(/\\/g, '/').replace(/^\/+/, '');
        return `${baseUrl}/${sub}`;
      }
      
      return `${baseUrl}/uploads/${pathOrUrl.replace(/^\/+/, '')}`;
    }
  };
}

/**
 * Build query string from params object
 */
function buildQueryString(params) {
  if (!params || Object.keys(params).length === 0) return '';
  
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach(v => qs.append(key, v));
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
  buildQueryString
};
