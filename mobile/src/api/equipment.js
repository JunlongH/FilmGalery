/**
 * Equipment API for mobile app
 */
import { api } from './client';

// ===== Cameras =====
export const getCameras = () => api.http.get('/api/equipment/cameras');
export const getCamera = (id) => api.http.get(`/api/equipment/cameras/${id}`);
export const createCamera = (data) => api.http.post('/api/equipment/cameras', data);
export const updateCamera = (id, data) => api.http.put(`/api/equipment/cameras/${id}`, data);
export const deleteCamera = (id) => api.http.delete(`/api/equipment/cameras/${id}`);

// ===== Lenses =====
export const getLenses = () => api.http.get('/api/equipment/lenses');
export const getLens = (id) => api.http.get(`/api/equipment/lenses/${id}`);
export const getCompatibleLenses = (cameraId) =>
  api.http.get(`/api/equipment/compatible-lenses/${cameraId}`);
export const createLens = (data) => api.http.post('/api/equipment/lenses', data);
export const updateLens = (id, data) => api.http.put(`/api/equipment/lenses/${id}`, data);
export const deleteLens = (id) => api.http.delete(`/api/equipment/lenses/${id}`);

// ===== Flashes =====
export const getFlashes = () => api.http.get('/api/equipment/flashes');
export const getFlash = (id) => api.http.get(`/api/equipment/flashes/${id}`);
export const createFlash = (data) => api.http.post('/api/equipment/flashes', data);
export const updateFlash = (id, data) => api.http.put(`/api/equipment/flashes/${id}`, data);
export const deleteFlash = (id) => api.http.delete(`/api/equipment/flashes/${id}`);

// ===== Film Formats =====
// Server route is /api/equipment/formats (the old /film-formats path was a dead
// route — fixed by routing through the shared client's canonical path).
export const getFilmFormats = () => api.http.get('/api/equipment/formats');

// ===== Suggestions =====
export const getEquipmentSuggestions = () => api.http.get('/api/equipment/suggestions');

// ===== Rolls by Equipment =====
/**
 * Get rolls that use a specific piece of equipment.
 * For fixed-lens cameras (type='camera'), this also matches rolls with the camera's implicit lens.
 * @param {string} type - 'camera' | 'lens' | 'flash' | 'film'
 * @param {number|string} idOrName - Equipment ID or name (for cameras without ID)
 * @returns {Promise<Array>} List of rolls with display_camera and display_lens fields
 */
export const getRollsByEquipment = (type, idOrName) => {
  let param;
  switch (type) {
    case 'camera':
      if (typeof idOrName === 'number' && idOrName > 0) {
        param = `camera_equip_id=${idOrName}`;
      } else {
        param = `camera=${encodeURIComponent(idOrName)}`;
      }
      break;
    case 'lens':
      if (typeof idOrName === 'number' && idOrName > 0) {
        param = `lens_equip_id=${idOrName}`;
      } else {
        param = `lens=${encodeURIComponent(idOrName)}`;
      }
      break;
    case 'flash':
      param = `flash_equip_id=${idOrName}`;
      break;
    case 'film':
      param = `film_id=${idOrName}`;
      break;
    default:
      throw new Error(`Unknown equipment type: ${type}`);
  }
  return api.http.get(`/api/rolls?${param}`);
};
