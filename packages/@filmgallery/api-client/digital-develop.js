/**
 * Digital Develop API
 */

function createDigitalDevelopApi(http) {
  return {
    preview: (data) => http.post('/api/digital-develop/preview', data),
    save: (data) => http.post('/api/digital-develop/save', data),
    export: (data) => http.post('/api/digital-develop/export', data),
    getParams: (photoId) => http.get(`/api/digital-develop/${photoId}/params`),
  };
}

module.exports = { createDigitalDevelopApi };
