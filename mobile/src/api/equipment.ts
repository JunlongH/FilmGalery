import { api } from './client';
import type { Camera, Lens, Roll } from '../types';

export type EquipmentType = 'camera' | 'lens' | 'flash' | 'film';

export const getCameras = (): Promise<Camera[]> => api.http.get('/api/equipment/cameras');
export const getCamera = (id: number | string): Promise<Camera> => api.http.get(`/api/equipment/cameras/${id}`);
export const createCamera = (data: Partial<Camera>): Promise<Camera> => api.http.post('/api/equipment/cameras', data);
export const updateCamera = (id: number | string, data: Partial<Camera>): Promise<Camera> => api.http.put(`/api/equipment/cameras/${id}`, data);
export const deleteCamera = (id: number | string): Promise<void> => api.http.delete(`/api/equipment/cameras/${id}`);

export const getLenses = (): Promise<Lens[]> => api.http.get('/api/equipment/lenses');
export const getLens = (id: number | string): Promise<Lens> => api.http.get(`/api/equipment/lenses/${id}`);
export const getCompatibleLenses = (cameraId: number | string): Promise<any> =>
  api.http.get(`/api/equipment/compatible-lenses/${cameraId}`);
export const createLens = (data: Partial<Lens>): Promise<Lens> => api.http.post('/api/equipment/lenses', data);
export const updateLens = (id: number | string, data: Partial<Lens>): Promise<Lens> => api.http.put(`/api/equipment/lenses/${id}`, data);
export const deleteLens = (id: number | string): Promise<void> => api.http.delete(`/api/equipment/lenses/${id}`);

export const getFlashes = (): Promise<any[]> => api.http.get('/api/equipment/flashes');
export const getFlash = (id: number | string): Promise<any> => api.http.get(`/api/equipment/flashes/${id}`);
export const createFlash = (data: any): Promise<any> => api.http.post('/api/equipment/flashes', data);
export const updateFlash = (id: number | string, data: any): Promise<any> => api.http.put(`/api/equipment/flashes/${id}`, data);
export const deleteFlash = (id: number | string): Promise<void> => api.http.delete(`/api/equipment/flashes/${id}`);

export const getFilmFormats = (): Promise<any[]> => api.http.get('/api/equipment/formats');

export const getEquipmentSuggestions = (): Promise<any> => api.http.get('/api/equipment/suggestions');

export const getRollsByEquipment = (type: EquipmentType, idOrName: number | string): Promise<Roll[]> => {
  let param: string;
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
