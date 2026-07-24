/**
 * Digital Import API - Import preview and execution
 */

import { jsonFetch, postJson, uploadWithProgress, buildQueryString } from './core';

export async function digitalPreviewImport(files, onProgress) {
  const formData = new FormData();
  files.forEach(f => formData.append('files', f));
  return uploadWithProgress('/api/digital/import/preview', formData, onProgress);
}

export async function digitalExecuteImport(data) {
  return postJson('/api/digital/import/execute', data);
}

export async function getDigitalImportProgress(jobId) {
  return jsonFetch(`/api/digital/import/${jobId}/progress`);
}

export async function cancelDigitalImport(jobId) {
  return postJson(`/api/digital/import/${jobId}/cancel`);
}

export async function checkDigitalImportHash(hash) {
  return postJson('/api/digital/import/check-hash', { hash });
}
