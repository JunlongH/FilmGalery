/**
 * Digital Develop API - Develop preview, save, export
 */

import { jsonFetch, postJson, postForBlob } from './core';

export async function developPreview(photoId, params, options = {}) {
  return postForBlob('/api/digital-develop/preview', { photo_id: photoId, params_json: params }, options);
}

export async function developSave(photoId, params) {
  return postJson('/api/digital-develop/save', { photo_id: photoId, params_json: params });
}

export async function developExport(photoId, params) {
  return postForBlob('/api/digital-develop/export', { photo_id: photoId, params_json: params });
}

export async function getDevelopParams(photoId) {
  return jsonFetch(`/api/digital-develop/${photoId}/params`);
}
