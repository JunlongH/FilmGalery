import { api } from './client';

// NOTE: mobile 端适配现有 server 路由：summary / inventory / activity / costs ...

export const getStatsOverview = () => api.http.get('/api/stats/summary');
export const getStatsInventory = () => api.http.get('/api/stats/inventory');
export const getStatsActivity = () => api.http.get('/api/stats/activity');
export const getStatsCosts = () => api.http.get('/api/stats/costs');
export const getStatsGear = () => api.http.get('/api/stats/gear');
