/**
 * Photos API
 * 
 * CRUD operations for photos.
 */

/**
 * Create photos API endpoints
 * @param {Object} http - HTTP helpers from createApiClient
 */
function createPhotosApi(http) {
  return {
    /**
     * Search photos with filters
     */
    search: (filters = {}) => http.get('/api/photos/search', filters),
    
    /**
     * Get single photo by ID (server route: GET /api/photos/single/:id)
     */
    get: (id) => http.get(`/api/photos/single/${id}`),

    /** Alias of get() — explicit name for the single-photo lookup. */
    getSingle: (id) => http.get(`/api/photos/single/${id}`),
    
    /**
     * Update photo metadata
     */
    update: (id, data) => http.put(`/api/photos/${id}`, data),
    
    /**
     * Delete photo
     */
    delete: (id) => http.delete(`/api/photos/${id}`),

    /**
     * Get favorite photos (server route: GET /api/photos/favorites)
     */
    getFavorites: () => http.get('/api/photos/favorites'),

    /** Random photos (server route: GET /api/photos/random?limit=N) */
    getRandom: (limit) => http.get('/api/photos/random', { limit }),

    /** Photos with GPS coordinates for the map (GET /api/photos/geo) */
    getGeo: (params = {}) => http.get('/api/photos/geo', params),

    /** Negative photos (GET /api/photos/negatives) */
    getNegatives: (params = {}) => http.get('/api/photos/negatives', params),
    
    /**
     * Update positive from negative (save processed image)
     */
    updatePositive: async (photoId, blob) => {
      const formData = new FormData();
      formData.append('positive', blob, 'positive.jpg');
      return http.postForm(`/api/photos/${photoId}/update-positive`, formData);
    },
    
    /**
     * Export processed positive
     * @param {number} photoId - Photo ID
     * @param {object} params - FilmLab parameters
     * @param {object} options - Options (format, sourceType)
     */
    exportPositive: (photoId, params, options = {}) => 
      http.post('/api/filmlab/export', { 
        photoId, 
        params, 
        format: options.format || 'jpeg',
        sourceType: options.sourceType || 'original'
      }),
    
    /**
     * Render positive (in-memory processing)
     * @param {number} photoId - Photo ID
     * @param {object} params - FilmLab parameters
     * @param {object} options - Options (format, sourceType)
     */
    renderPositive: (photoId, params, options = {}) => 
      http.post('/api/filmlab/render', { 
        photoId, 
        params, 
        format: options.format || 'jpeg',
        sourceType: options.sourceType || 'original'
      }),
    
    /**
     * Get FilmLab preview
     * @param {number} photoId - Photo ID
     * @param {object} params - FilmLab parameters
     * @param {number} maxWidth - Max width for preview
     * @param {string} sourceType - Source type: 'original' | 'negative' | 'positive'
     */
    getFilmlabPreview: (photoId, params, maxWidth = 1400, sourceType = 'original') => 
      http.post('/api/filmlab/preview', { 
        photoId, 
        params, 
        maxWidth, 
        sourceType 
      })
  };
}

module.exports = { createPhotosApi };
