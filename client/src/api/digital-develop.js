/**
 * Digital Develop API - Develop preview, save, export
 */

import { jsonFetch, postJson } from './core';

export async function developPreview(data) {
  return postJson('/api/digital-develop/preview', data);
}

export async function developSave(data) {
  return postJson('/api/digital-develop/save', data);
}

export async function developExport(data) {
  return postJson('/api/digital-develop/export', data);
}

export async function getDevelopParams(photoId) {
  return jsonFetch(`/api/digital-develop/${photoId}/params`);
}
