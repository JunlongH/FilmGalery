import { api } from './client';

export const getStatsOverview = (): Promise<any> => api.http.get('/api/stats/summary');
export const getStatsInventory = (): Promise<any> => api.http.get('/api/stats/inventory');
export const getStatsActivity = (): Promise<any> => api.http.get('/api/stats/activity');
export const getStatsCosts = (): Promise<any> => api.http.get('/api/stats/costs');
export const getStatsGear = (): Promise<any> => api.http.get('/api/stats/gear');
