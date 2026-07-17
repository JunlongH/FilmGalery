/**
 * Stats API
 *
 * Read-only statistics endpoints (server/routes/stats.js).
 */

function createStatsApi(http) {
  return {
    summary: () => http.get('/api/stats/summary'),
    inventory: () => http.get('/api/stats/inventory'),
    activity: (params = {}) => http.get('/api/stats/activity', params),
    costs: (params = {}) => http.get('/api/stats/costs', params),
    gear: () => http.get('/api/stats/gear'),
  };
}

module.exports = { createStatsApi };
