/**
 * Digital Import API
 */

function createDigitalImportApi(http) {
  return {
    preview: (formData, onProgress) => http.postForm('/api/digital/import/preview', formData, onProgress),
    execute: (data) => http.post('/api/digital/import/execute', data),
    progress: (jobId) => http.get(`/api/digital/import/${jobId}/progress`),
    cancel: (jobId) => http.post(`/api/digital/import/${jobId}/cancel`),
    checkHash: (hash) => http.post('/api/digital/import/check-hash', { hash }),
  };
}

module.exports = { createDigitalImportApi };
