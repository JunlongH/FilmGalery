/**
 * Metadata API
 *
 * Auxiliary metadata endpoints (server/routes/metadata.js).
 */

function createMetadataApi(http) {
  return {
    /** Dropdown/select options for film/exif metadata forms. */
    getOptions: () => http.get('/api/metadata/options'),
  };
}

module.exports = { createMetadataApi };
