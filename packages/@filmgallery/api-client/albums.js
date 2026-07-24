/**
 * Albums API
 */

function createAlbumsApi(http) {
  return {
    list: (params) => http.get('/api/albums', params),
    get: (id) => http.get(`/api/albums/${id}`),
    getPhotos: (id, params) => http.get(`/api/albums/${id}/photos`, params),
    create: (data) => http.post('/api/albums', data),
    update: (id, data) => http.put(`/api/albums/${id}`, data),
    delete: (id, hard = false) => http.delete(`/api/albums/${id}${hard ? '?hard=true' : ''}`),
    restore: (id) => http.post(`/api/albums/${id}/restore`),
    setCover: (id, photoId) => http.post(`/api/albums/${id}/cover`, { photo_id: photoId }),
    addPhotos: (id, photoIds) => http.post(`/api/albums/${id}/photos`, { photo_ids: photoIds }),
    removePhoto: (id, photoId) => http.delete(`/api/albums/${id}/photos/${photoId}`),
    sortPhotos: (id, photoIds) => http.put(`/api/albums/${id}/photos/sort`, { photo_ids: photoIds }),
  };
}

module.exports = { createAlbumsApi };
