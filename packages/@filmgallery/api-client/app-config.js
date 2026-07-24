/**
 * App Config API
 */

function createAppConfigApi(http) {
  return {
    get: () => http.get('/api/app-config'),
    update: (data) => http.put('/api/app-config', data),
    onboarding: (choice) => http.post('/api/app-config/onboarding', choice),
  };
}

module.exports = { createAppConfigApi };
