// src/api.js
// Prefer 127.0.0.1 over localhost to avoid potential IPv6 issues in packaged builds
export const API_BASE = process.env.REACT_APP_API_BASE || 'http://127.0.0.1:4000';

// Build an absolute URL for an uploaded file value stored in the DB.
export function buildUploadUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  // already absolute URL
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  // leading slash -> relative to API_BASE
  if (pathOrUrl.startsWith('/')) return `${API_BASE}${pathOrUrl}`;
  // contains 'uploads' somewhere (e.g. Windows full path like D:\...\uploads\rolls\...)
  const lower = pathOrUrl.toLowerCase();
  const idx = lower.indexOf('uploads');
  if (idx !== -1) {
    // extract from 'uploads' onward and normalize slashes
    const sub = pathOrUrl.slice(idx).replace(/\\/g, '/').replace(/^\/+/, '');
    return `${API_BASE}/${sub}`;
  }
  // Windows path fallback - use basename
  if (pathOrUrl.indexOf('\\') !== -1 || /^([a-zA-Z]:\\)/.test(pathOrUrl)) {
    const parts = pathOrUrl.split(/[/\\]+/);
    const base = parts[parts.length - 1];
    return `${API_BASE}/uploads/${base}`;
  }
  // default: assume value is relative inside uploads (e.g. 'rolls/..')
  return `${API_BASE}/uploads/${pathOrUrl.replace(/^\/+/, '')}`;
}

async function jsonFetch(url, opts = {}) {
  const r = await fetch(`${API_BASE}${url}`, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

// Upload multiple files to tmp for preview
export async function uploadTmpFiles(files, onProgress) {
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  // use XMLHttpRequest to support progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/uploads`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch(e){ resolve(xhr.responseText); }
      } else reject(new Error(xhr.statusText || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) onProgress(Math.round(ev.loaded / ev.total * 100));
      };
    }
    xhr.send(fd);
  });
}

// Create roll (multipart direct create)
export async function createRollMultipart({ fields = {}, files = [], onProgress } = {}) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, v); });
  (files || []).forEach(f => fd.append('files', f));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/rolls`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch(e){ resolve(xhr.responseText); }
      } else reject(new Error(xhr.statusText || 'Create roll failed'));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    if (xhr.upload && onProgress) xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round(ev.loaded / ev.total * 100));
    };
    xhr.send(fd);
  });
}

// Create roll using previously uploaded tmp files
export async function createRollWithTmp({ fields = {}, tmpFiles = [], coverIndex = 0 } = {}) {
  const payload = Object.assign({}, fields, { tmpFiles, coverIndex });
  const res = await fetch(`${API_BASE}/api/rolls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

// Unified roll creation pipeline: decides multipart vs tmp-flow based on presence of File objects and useTwoStep flag.
export async function createRollUnified({ fields = {}, files = [], useTwoStep = false, isNegative = false, onProgress } = {}) {
  if (useTwoStep) {
    // Upload temp files first
    const uploaded = await uploadTmpFiles(files, p => onProgress && onProgress(p));
    const tmpFiles = (uploaded.files || []).map(f => ({ tmpName: f.tmpName, isNegative }));
    return createRollWithTmp({ fields: { ...fields, isNegative }, tmpFiles });
  }
  return createRollMultipart({ fields: { ...fields, isNegative }, files, onProgress });
}

export async function getRolls(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.filter(Boolean).forEach(item => params.append(k, item));
    } else if (v !== '') {
      params.append(k, v);
    }
  });
  const qs = params.toString();
  const url = qs ? `/api/rolls?${qs}` : '/api/rolls';
  const data = await jsonFetch(url);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.rolls)) return data.rolls;
  return [];
}
export async function getRoll(id) {
  return jsonFetch(`/api/rolls/${id}`);
}
export async function getRollLocations(rollId) {
  return jsonFetch(`/api/rolls/${rollId}/locations`);
}
export async function getLocations({ hasRecords = true, country, query } = {}) {
  const params = new URLSearchParams();
  if (hasRecords) params.append('hasRecords', '1');
  if (country) params.append('country', country);
  if (query) params.append('query', query);
  const qs = params.toString();
  return jsonFetch(`/api/locations${qs ? '?' + qs : ''}`);
}
export async function getMetadataOptions() {
  return jsonFetch('/api/metadata/options');
}
export async function getPhotos(rollId) {
  const data = await jsonFetch(`/api/rolls/${rollId}/photos`);
  // Normalize paths to prefer positive variants
  return (Array.isArray(data) ? data : []).map(p => ({
    ...p,
    full_rel_path: p.positive_rel_path || p.full_rel_path || null,
    thumb_rel_path: p.positive_thumb_rel_path || p.thumb_rel_path || null,
  }));
}
export async function searchPhotos(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.filter(Boolean).forEach(item => params.append(k, item));
    else if (v !== '') params.append(k, v);
  });
  const qs = params.toString();
  const data = await jsonFetch(`/api/photos${qs ? '?' + qs : ''}`);
  return (Array.isArray(data) ? data : []).map(p => ({
    ...p,
    full_rel_path: p.positive_rel_path || p.full_rel_path || null,
    thumb_rel_path: p.positive_thumb_rel_path || p.thumb_rel_path || null,
  }));
}
export async function uploadPhotoToRoll(rollId, file, fields = {}) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, v); });
  fd.append('image', file);
  const resp = await fetch(`${API_BASE}/api/rolls/${rollId}/photos`, { method: 'POST', body: fd });
  return resp.json();
}

// Upload multiple files to an existing roll. This calls `uploadPhotoToRoll` sequentially
// and returns an array of results. An optional `onProgress` callback receives
// an object { index, total } before each file upload starts.
export async function uploadPhotosToRoll({ rollId, files = [], onProgress, isNegative = false }) {
  const results = [];
  const total = Array.isArray(files) ? files.length : 0;
  for (let i = 0; i < total; i++) {
    const f = files[i];
    if (onProgress && typeof onProgress === 'function') onProgress({ index: i + 1, total });
    try {
      // reuse single-file upload helper
      // await ensures sequential uploads which is friendlier to some servers
      // and keeps ordering predictable.
      // eslint-disable-next-line no-await-in-loop
      const res = await uploadPhotoToRoll(rollId, f, { isNegative });
      results.push(res);
    } catch (err) {
      results.push({ error: (err && err.message) || String(err) });
    }
  }
  return results;
}

// Films API
export async function getFilms() {
  const res = await fetch(`${API_BASE}/api/films`);
  const data = await res.json();
  // 防御性处理：确保返回数组
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.films)) return data.films;
  return [];
}

export async function createFilm({ name, iso, category, thumbFile }) {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('iso', iso);
  fd.append('category', category);
  if (thumbFile) fd.append('thumb', thumbFile);
  const resp = await fetch(`${API_BASE}/api/films`, { method: 'POST', body: fd });
  return resp.json();
}

export async function updateFilm({ id, name, iso, category, thumbFile }) {
  const fd = new FormData();
  if (name !== undefined) fd.append('name', name);
  if (iso !== undefined) fd.append('iso', iso);
  if (category !== undefined) fd.append('category', category);
  if (thumbFile) fd.append('thumb', thumbFile);
  const resp = await fetch(`${API_BASE}/api/films/${id}`, { method: 'PUT', body: fd });
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export async function deleteFilm(id) {
  const resp = await fetch(`${API_BASE}/api/films/${id}`, { method: 'DELETE' });
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export async function deleteRoll(id) {
  const resp = await fetch(`${API_BASE}/api/rolls/${id}`, { method: 'DELETE' });
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export async function deletePhoto(id) {
  const resp = await fetch(`${API_BASE}/api/photos/${id}`, { method: 'DELETE' });
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export async function setRollCover(rollId, { photoId, filename } = {}) {
  const payload = {};
  if (photoId) payload.photoId = photoId;
  if (filename) payload.filename = filename;
  const res = await fetch(`${API_BASE}/api/rolls/${rollId}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export async function updateRoll(id, data) {
  const resp = await fetch(`${API_BASE}/api/rolls/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

// Roll preset management
export async function getRollPreset(rollId) {
  return jsonFetch(`/api/rolls/${rollId}/preset`);
}

export async function setRollPreset(rollId, { name, params }) {
  const resp = await fetch(`${API_BASE}/api/rolls/${rollId}/preset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, params })
  });
  return resp.json();
}

export async function clearRollPreset(rollId) {
  const resp = await fetch(`${API_BASE}/api/rolls/${rollId}/preset`, { method: 'DELETE' });
  return resp.json();
}

// Global presets (Film Lab)
export async function listPresets(category) {
  const q = category ? `?category=${encodeURIComponent(category)}` : '';
  return jsonFetch(`/api/presets${q}`);
}

export async function createPreset({ name, category, description, params }) {
  const resp = await fetch(`${API_BASE}/api/presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category, description, params })
  });
  return resp.json();
}

export async function updatePreset(id, { name, category, description, params }) {
  const resp = await fetch(`${API_BASE}/api/presets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category, description, params })
  });
  return resp.json();
}

export async function deletePreset(id) {
  const resp = await fetch(`${API_BASE}/api/presets/${id}`, { method: 'DELETE' });
  return resp.json();
}

export async function updatePhoto(id, data) {
  const resp = await fetch(`${API_BASE}/api/photos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export async function searchLocations(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return jsonFetch(`/api/locations${qs ? '?' + qs : ''}`);
}

export async function getLocation(id) {
  return jsonFetch(`/api/locations/${id}`);
}

export async function getCountries() {
  return jsonFetch('/api/locations/countries');
}

export async function createLocation(data) {
  const resp = await fetch(`${API_BASE}/api/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return resp.json();
}

export async function getFavoritePhotos() {
  return jsonFetch(`/api/photos/favorites?t=${Date.now()}`);
}

export async function getTags() {
  return jsonFetch('/api/tags');
}

export async function getTagPhotos(tagId) {
  if (!tagId) return [];
  return jsonFetch(`/api/tags/${encodeURIComponent(tagId)}/photos`);
}

export async function updatePositiveFromNegative(photoId, blob) {
  const fd = new FormData();
  fd.append('image', blob, 'positive.jpg');
  const res = await fetch(`${API_BASE}/api/photos/${photoId}/update-positive`, {
    method: 'PUT',
    body: fd
  });
  return res.json();
}

// High-quality server-side export using original scan
// params: object matching FilmLab preset shape subset
export async function exportPositive(photoId, params, { format = 'jpeg' } = {}) {
  const res = await fetch(`${API_BASE}/api/photos/${photoId}/export-positive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params, format })
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return res.json();
  }
  if (ct.startsWith('image/')) {
    const blob = await res.blob();
    return { ok: true, blob, contentType: ct };
  }
  const text = await res.text();
  return { ok: res.ok, status: res.status, error: text };
}

// Ad-hoc render (non-destructive) for Save As
// Returns blob for jpeg or tiff16 without updating DB
export async function renderPositive(photoId, params, { format = 'jpeg' } = {}) {
  const resp = await fetch(`${API_BASE}/api/photos/${photoId}/render-positive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params, format })
  });
  const ct = resp.headers.get('content-type') || '';
  if (ct.startsWith('image/')) {
    const blob = await resp.blob();
    return { ok: true, blob, contentType: ct };
  }
  const text = await resp.text();
  let err;
  try { err = JSON.parse(text); } catch { err = { error: text }; }
  return { ok: false, error: err.error || err.message || text };
}

// Film Lab preview (server-rendered)
export async function filmlabPreview({ photoId, params, maxWidth = 1400 }) {
  const resp = await fetch(`${API_BASE}/api/filmlab/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId, params, maxWidth })
  });
  const ct = resp.headers.get('content-type') || '';
  if (ct.startsWith('image/')) {
    const blob = await resp.blob();
    return { ok: true, blob };
  }
  const text = await resp.text();
  let err;
  try { err = JSON.parse(text); } catch { err = { error: text }; }
  return { ok: false, error: err && (err.error || err.message) };
}

