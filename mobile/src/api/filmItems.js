import { api } from './client';

// NOTE: 尽量与桌面端 client/src/api.js 中的 getFilmItems / getFilmItem 语义保持一致，
// 这样后端改动时只需要同时更新两处 API 封装即可。

export async function getFilmItems(params = {}) {
  const search = new URLSearchParams();
  if (params.status) {
    const v = Array.isArray(params.status) ? params.status : String(params.status).split(',');
    search.set('status', v.join(','));
  }
  if (params.film_id) search.set('film_id', params.film_id);
  if (params.includeDeleted) search.set('includeDeleted', 'true');
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));
  const qs = search.toString();
  return api.http.get(`/api/film-items${qs ? `?${qs}` : ''}`); // { ok, items }
}

export async function getFilmItem(id) {
  const data = await api.http.get(`/api/film-items/${id}`);
  if (data && data.item) return data.item;
  return data;
}

export async function updateFilmItem(id, patch) {
  const data = await api.http.put(`/api/film-items/${id}`, patch || {});
  if (data && data.item) return data.item;
  return data;
}

export async function deleteFilmItem(id, { hard = false } = {}) {
  return api.http.delete(`/api/film-items/${id}${hard ? '?hard=true' : ''}`);
}

// Films API (mobile side, aligned with desktop client/src/api.js)
export async function getFilms() {
  const data = await api.http.get('/api/films');
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.films)) return data.films;
  return [];
}

export async function getMetadataOptions() {
  const data = await api.http.get('/api/metadata/options');
  return data || {};
}

// Locations (shared with desktop API semantics)
export async function getCountries() {
  const data = await api.http.get('/api/locations/countries');
  return data || [];
}

export async function searchLocations(params = {}) {
  const data = await api.http.get('/api/locations', params);
  return data || [];
}
