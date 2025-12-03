import axios from 'axios';

// NOTE: mobile 端适配现有 server 路由：summary / inventory / activity / costs ...

export async function getStatsOverview() {
  // server: GET /api/stats/summary
  const res = await axios.get('/api/stats/summary');
  return res.data;
}

export async function getStatsInventory() {
  const res = await axios.get('/api/stats/inventory');
  return res.data;
}

export async function getStatsActivity() {
  const res = await axios.get('/api/stats/activity');
  return res.data;
}

export async function getStatsCosts() {
  const res = await axios.get('/api/stats/costs');
  return res.data;
}

export async function getStatsGear() {
  const res = await axios.get('/api/stats/gear');
  return res.data;
}
