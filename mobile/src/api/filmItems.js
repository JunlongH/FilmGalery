import axios from 'axios';

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
  const res = await axios.get(`/api/film-items${qs ? `?${qs}` : ''}`);
  return res.data; // { ok, items }
}

export async function getFilmItem(id) {
  const res = await axios.get(`/api/film-items/${id}`);
  if (res.data && res.data.item) return res.data.item;
  return res.data;
}

export async function updateFilmItem(id, patch) {
  const res = await axios.put(`/api/film-items/${id}`, patch || {});
  if (res.data && res.data.item) return res.data.item;
  return res.data;
}

export async function deleteFilmItem(id, { hard = false } = {}) {
  const params = {};
  if (hard) params.hard = 'true';
  const res = await axios.delete(`/api/film-items/${id}`, { params });
  return res.data;
}

// Films API (mobile side, aligned with desktop client/src/api.js)
export async function getFilms() {
  const res = await axios.get('/api/films');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.films)) return data.films;
  return [];
}

export async function getMetadataOptions() {
  const res = await axios.get('/api/metadata/options');
  return res.data || {};
}
