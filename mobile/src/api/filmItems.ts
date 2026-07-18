import { api } from './client';
import type { FilmItem, Film, Location } from '../types';

export interface FilmItemsParams {
  status?: string | string[];
  film_id?: number | string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export async function getFilmItems(params: FilmItemsParams = {}): Promise<{ items?: FilmItem[] } | FilmItem[]> {
  const search = new URLSearchParams();
  if (params.status) {
    const v = Array.isArray(params.status) ? params.status : String(params.status).split(',');
    search.set('status', v.join(','));
  }
  if (params.film_id) search.set('film_id', String(params.film_id));
  if (params.includeDeleted) search.set('includeDeleted', 'true');
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));
  const qs = search.toString();
  return api.http.get(`/api/film-items${qs ? `?${qs}` : ''}`);
}

export async function getFilmItem(id: number | string): Promise<FilmItem> {
  const data: any = await api.http.get(`/api/film-items/${id}`);
  if (data && data.item) return data.item;
  return data;
}

export async function updateFilmItem(id: number | string, patch?: Partial<FilmItem>): Promise<FilmItem> {
  const data: any = await api.http.put(`/api/film-items/${id}`, patch || {});
  if (data && data.item) return data.item;
  return data;
}

export async function deleteFilmItem(id: number | string, { hard = false }: { hard?: boolean } = {}): Promise<any> {
  return api.http.delete(`/api/film-items/${id}${hard ? '?hard=true' : ''}`);
}

export async function getFilms(): Promise<Film[]> {
  const data: any = await api.http.get('/api/films');
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.films)) return data.films;
  return [];
}

export async function getMetadataOptions(): Promise<Record<string, unknown>> {
  const data: any = await api.http.get('/api/metadata/options');
  return data || {};
}

export async function getCountries(): Promise<Location[]> {
  const data: any = await api.http.get('/api/locations/countries');
  return data || [];
}

export async function searchLocations(params: Record<string, unknown> = {}): Promise<Location[]> {
  const data: any = await api.http.get('/api/locations', params);
  return data || [];
}
