/**
 * Digital Sessions API
 */

function createDigitalSessionsApi(http) {
  return {
    list: (params) => http.get('/api/digital-sessions', params),
    get: (id) => http.get(`/api/digital-sessions/${id}`),
    getPhotos: (id, params) => http.get(`/api/digital-sessions/${id}/photos`, params),
    update: (id, data) => http.put(`/api/digital-sessions/${id}`, data),
    delete: (id) => http.delete(`/api/digital-sessions/${id}`),
  };
}

module.exports = { createDigitalSessionsApi };
