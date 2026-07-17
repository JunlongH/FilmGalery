/**
 * Locations API
 * 
 * CRUD operations for locations, tags, and processing presets.
 */

/**
 * Create locations API endpoints
 * @param {Object} http - HTTP helpers from createApiClient
 */
function createLocationsApi(http) {
  return {
    // ========================================
    // LOCATIONS
    // ========================================
    
    /**
     * Search locations (server route: GET /api/locations?q=...)
     */
    search: (query, params = {}) => http.get('/api/locations', { q: query, ...params }),
    
    /**
     * Get location by ID
     */
    get: (id) => http.get(`/api/locations/${id}`),
    
    /**
     * Get countries list with photo counts
     */
    getCountries: () => http.get('/api/locations/countries'),
    
    /**
     * Create location
     */
    create: (data) => http.post('/api/locations', data),
    
    /**
     * Update location
     */
    update: (id, data) => http.put(`/api/locations/${id}`, data),
    
    /**
     * Delete location
     */
    delete: (id) => http.delete(`/api/locations/${id}`),
    
    // ========================================
    // TAGS
    // ========================================
    
    tags: {
      /**
       * List all tags
       */
      list: () => http.get('/api/tags'),
      
      /**
       * Get photos by tag
       */
      getPhotos: (tag, params = {}) => http.get(`/api/tags/${encodeURIComponent(tag)}/photos`, params),
      
      /**
       * Create tag
       */
      create: (name) => http.post('/api/tags', { name }),
      
      /**
       * Delete tag
       */
      delete: (name) => http.delete(`/api/tags/${encodeURIComponent(name)}`)
    },
    
    // ========================================
    // PRESETS (Processing/FilmLab Presets)
    // ========================================
    
    presets: {
      /**
       * List all presets
       */
      list: () => http.get('/api/filmlab/presets'),
      
      /**
       * Get single preset
       */
      get: (id) => http.get(`/api/filmlab/presets/${id}`),
      
      /**
       * Create preset
       */
      create: (data) => http.post('/api/filmlab/presets', data),
      
      /**
       * Update preset
       */
      update: (id, data) => http.put(`/api/filmlab/presets/${id}`, data),
      
      /**
       * Delete preset
       */
      delete: (id) => http.delete(`/api/filmlab/presets/${id}`)
    }
  };
}

module.exports = { createLocationsApi };
