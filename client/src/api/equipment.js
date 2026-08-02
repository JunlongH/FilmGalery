/**
 * Equipment API - Cameras, Lenses, Flashes, Scanners, Film Backs
 */

import { getApiBase, jsonFetch, postJson, putJson, deleteRequest, buildQueryString } from './core';

// ========================================
// CONSTANTS & SUGGESTIONS
// ========================================

export async function getEquipmentConstants() {
  return jsonFetch('/api/equipment/constants');
}

export async function getEquipmentSuggestions() {
  return jsonFetch('/api/equipment/suggestions');
}

export async function getUnregisteredDevices() {
  return jsonFetch('/api/equipment/unregistered-devices');
}

export async function registerFromPhotos(payload) {
  return postJson('/api/equipment/register-from-photos', payload);
}

export async function getCompatibleLenses(cameraId, mode = null) {
  const qs = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  return jsonFetch(`/api/equipment/compatible-lenses/${cameraId}${qs}`);
}

/**
 * Get rolls related to an equipment item
 * Includes rolls with photos shot using this equipment
 */
export async function getEquipmentRelatedRolls(type, id, limit = 20) {
  return jsonFetch(`/api/equipment/related-rolls/${type}/${id}?limit=${limit}`);
}

// ========================================
// FILM FORMATS
// ========================================

export async function getFilmFormats() {
  return jsonFetch('/api/equipment/formats');
}

export async function createFilmFormat(data) {
  return postJson('/api/equipment/formats', data);
}

// ========================================
// GENERIC EQUIPMENT CRUD FACTORY
// ========================================

function createEquipmentApi(type) {
  const basePath = `/api/equipment/${type}`;
  
  return {
    async list(params = {}, noCache = false) {
      const qs = buildQueryString(params);
      const url = `${basePath}${qs}`;
      if (noCache) {
        return jsonFetch(`${url}${qs ? '&' : '?'}_t=${Date.now()}`);
      }
      return jsonFetch(url);
    },

    async get(id) {
      return jsonFetch(`${basePath}/${id}`);
    },

    async create(data) {
      return postJson(basePath, data);
    },

    async update(id, data) {
      return putJson(`${basePath}/${id}`, data);
    },

    async delete(id, hard = false) {
      const qs = hard ? '?hard=true' : '';
      return deleteRequest(`${basePath}/${id}${qs}`);
    },

    async uploadImage(id, file) {
      const apiBase = getApiBase();
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch(`${apiBase}${basePath}/${id}/image`, {
        method: 'POST',
        body: fd
      });
      return res.json();
    }
  };
}

// ========================================
// CAMERAS
// ========================================

const camerasApi = createEquipmentApi('cameras');

export const getCameras = (params, noCache) => camerasApi.list(params, noCache);
export const getCamera = (id) => camerasApi.get(id);
export const createCamera = (data) => camerasApi.create(data);
export const updateCamera = (id, data) => camerasApi.update(id, data);
export const deleteCamera = (id, hard) => camerasApi.delete(id, hard);
export const uploadCameraImage = (id, file) => camerasApi.uploadImage(id, file);

// ========================================
// LENSES
// ========================================

const lensesApi = createEquipmentApi('lenses');

export const getLenses = (params, noCache) => lensesApi.list(params, noCache);
export const getLens = (id) => lensesApi.get(id);
export const createLens = (data) => lensesApi.create(data);
export const updateLens = (id, data) => lensesApi.update(id, data);
export const deleteLens = (id, hard) => lensesApi.delete(id, hard);
export const uploadLensImage = (id, file) => lensesApi.uploadImage(id, file);

// ========================================
// FLASHES
// ========================================

const flashesApi = createEquipmentApi('flashes');

export const getFlashes = (params, noCache) => flashesApi.list(params, noCache);
export const getFlash = (id) => flashesApi.get(id);
export const createFlash = (data) => flashesApi.create(data);
export const updateFlash = (id, data) => flashesApi.update(id, data);
export const deleteFlash = (id, hard) => flashesApi.delete(id, hard);
export const uploadFlashImage = (id, file) => flashesApi.uploadImage(id, file);

// ========================================
// SCANNERS
// ========================================

const scannersApi = createEquipmentApi('scanners');

export const getScanners = (params, noCache) => scannersApi.list(params, noCache);
export const getScanner = (id) => scannersApi.get(id);
export const createScanner = (data) => scannersApi.create(data);
export const updateScanner = (id, data) => scannersApi.update(id, data);
export const deleteScanner = (id, hard) => scannersApi.delete(id, hard);
export const uploadScannerImage = (id, file) => scannersApi.uploadImage(id, file);

// ========================================
// FILM BACKS
// ========================================

const filmBacksApi = createEquipmentApi('film-backs');

export const getFilmBacks = (params, noCache) => filmBacksApi.list(params, noCache);
export const getFilmBack = (id) => filmBacksApi.get(id);
export const createFilmBack = (data) => filmBacksApi.create(data);
export const updateFilmBack = (id, data) => filmBacksApi.update(id, data);
export const deleteFilmBack = (id, hard) => filmBacksApi.delete(id, hard);
export const uploadFilmBackImage = (id, file) => filmBacksApi.uploadImage(id, file);
