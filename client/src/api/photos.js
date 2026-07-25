/**
 * Photos API - Photo management and processing
 */

import { getApiBase, jsonFetch, putJson, deleteRequest, uploadWithProgress, buildQueryString } from './core';

// ========================================
// PHOTO CRUD
// ========================================

/**
 * Get photos for a roll
 */
export async function getPhotos(rollId) {
  return jsonFetch(`/api/rolls/${rollId}/photos`);
}

/**
 * Search photos with filters
 */
export async function searchPhotos(filters = {}) {
  const qs = buildQueryString(filters);
  return jsonFetch(`/api/photos${qs}`);
}

/**
 * Update photo metadata
 */
export async function updatePhoto(id, data) {
  return putJson(`/api/photos/${id}`, data);
}

/**
 * Delete photo
 */
export async function deletePhoto(id) {
  return deleteRequest(`/api/photos/${id}`);
}

/**
 * Get favorite photos
 * @param {string} [mode] - 'film' | 'digital'; omitted = legacy unfiltered behavior
 */
export async function getFavoritePhotos(mode) {
  const qs = buildQueryString({ mode });
  return jsonFetch(`/api/photos/favorites${qs}`);
}

/**
 * Facet counts (years/months/cameras/lenses) for the library filter rail
 * @param {object} [params] - e.g. { mode: 'digital' }
 */
export async function getPhotoFacets(params = {}) {
  const qs = buildQueryString(params);
  return jsonFetch(`/api/photos/facets${qs}`);
}

/**
 * List digital import sessions (latest first)
 */
export async function getDigitalSessions() {
  return jsonFetch('/api/digital-sessions');
}

// ========================================
// PHOTO UPLOAD
// ========================================

/**
 * Upload single photo to roll
 */
export async function uploadPhotoToRoll(rollId, file, fields = {}) {
  const fd = new FormData();
  fd.append('image', file);
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, v);
  });
  return uploadWithProgress(`/api/rolls/${rollId}/photos`, fd);
}

/**
 * Upload multiple photos to roll with progress
 */
export async function uploadPhotosToRoll({ rollId, files = [], onProgress, isNegative = false, uploadType = null }) {
  const effectiveUploadType = uploadType || (isNegative ? 'negative' : 'positive');

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const res = await uploadPhotoToRoll(rollId, file, { 
      isNegative: effectiveUploadType === 'negative',
      uploadType: effectiveUploadType
    });
    results.push(res);
    if (onProgress) {
      onProgress(Math.round(((i + 1) / files.length) * 100));
    }
  }
  return { ok: true, photos: results };
}

// ========================================
// PHOTO PROCESSING (FilmLab)
// ========================================

/**
 * Update positive from negative (save processed image)
 */
export async function updatePositiveFromNegative(photoId, blob) {
  const apiBase = getApiBase();
  const fd = new FormData();
  fd.append('positive', blob, 'positive.jpg');
  const res = await fetch(`${apiBase}/api/photos/${photoId}/update-positive`, {
    method: 'POST',
    body: fd
  });
  return res.json();
}

/**
 * Export processed positive image
 * @param {number} photoId - Photo ID
 * @param {object} params - FilmLab parameters
 * @param {object} options - Options (format, sourceType)
 */
export async function exportPositive(photoId, params, { format = 'jpeg', sourceType = 'original' } = {}) {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/filmlab/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId, params, format, sourceType })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Export failed');
  }
  return res.json();
}

/**
 * Render positive image (in-memory processing)
 * @param {number} photoId - Photo ID
 * @param {object} params - FilmLab parameters
 * @param {object} options - Options (format, sourceType)
 */
export async function renderPositive(photoId, params, { format = 'jpeg', sourceType = 'original' } = {}) {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/filmlab/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId, params, format, sourceType })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Render failed');
  }
  return res.json();
}

/**
 * Get FilmLab preview
 * @param {object} options
 * @param {number} options.photoId - Photo ID
 * @param {object} options.params - FilmLab parameters
 * @param {number} options.maxWidth - Max width for preview
 * @param {string} options.sourceType - Source type: 'original' | 'negative' | 'positive'
 */
export async function filmlabPreview({ photoId, params, maxWidth = 1400, sourceType = 'original' }) {
  const apiBase = getApiBase();
  console.log('[API] filmlabPreview request:', { photoId, params, maxWidth, sourceType, apiBase });
  const resp = await fetch(`${apiBase}/api/filmlab/preview`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    },
    body: JSON.stringify({ photoId, params, maxWidth, sourceType }),
    cache: 'no-store'
  });
  const ct = resp.headers.get('content-type') || '';
  if (ct.startsWith('image/')) {
    const blob = await resp.blob();
    console.log('[API] filmlabPreview received image blob:', blob.size, 'bytes');
    return { ok: true, blob };
  }
  const text = await resp.text();
  let err;
  try { err = JSON.parse(text); } catch { err = { error: text }; }
  console.error('[API] filmlabPreview error:', err);
  return { ok: false, error: err && (err.error || err.message) };
}
