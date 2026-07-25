/**
 * Albums API - Album management
 */

import { jsonFetch, postJson, putJson, deleteRequest, buildQueryString } from './core';

export async function getAlbums(params = {}) {
  const qs = buildQueryString(params);
  return jsonFetch(`/api/albums${qs}`);
}

export async function getAlbum(id) {
  return jsonFetch(`/api/albums/${id}`);
}

export async function getAlbumPhotos(id, params = {}) {
  const qs = buildQueryString(params);
  return jsonFetch(`/api/albums/${id}/photos${qs}`);
}

export async function getAlbumsForPhoto(photoId) {
  return getAlbums({ photo_id: photoId });
}

export async function createAlbum(data) {
  return postJson('/api/albums', data);
}

export async function updateAlbum(id, data) {
  return putJson(`/api/albums/${id}`, data);
}

export async function deleteAlbum(id, hard = false) {
  return deleteRequest(`/api/albums/${id}?hard=${hard}`);
}

export async function restoreAlbum(id) {
  return postJson(`/api/albums/${id}/restore`);
}

export async function setAlbumCover(id, photoId) {
  return postJson(`/api/albums/${id}/cover`, { photo_id: photoId });
}

export async function addAlbumPhotos(id, photoIds) {
  return postJson(`/api/albums/${id}/photos`, { photo_ids: photoIds });
}

export async function removeAlbumPhoto(albumId, photoId) {
  return deleteRequest(`/api/albums/${albumId}/photos/${photoId}`);
}

export async function sortAlbumPhotos(id, photoIds) {
  return putJson(`/api/albums/${id}/photos/sort`, { photo_ids: photoIds });
}
