import axios from 'axios';
import { io } from 'socket.io-client';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SOCKET_BASE = API_BASE.replace('/api', '');

const api = axios.create({
  baseURL: API_BASE,
  headers: { 
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  },
});

export const socket = io(SOCKET_BASE, {
  extraHeaders: {
    'ngrok-skip-browser-warning': 'true'
  }
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('norzagapay_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('norzagapay_token');
      localStorage.removeItem('norzagapay_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const authAPI = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  register: (data: any) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

export const debugAPI = {
  accounts: () => api.get('/debug/accounts?audience=standard'),
  quickLogin: (accountId: string) => api.post('/debug/quick-login', { accountId, audience: 'standard' }),
};

// Missions
export const missionAPI = {
  list: (params?: any) => api.get('/incidents', { params }),
  get: (id: string) => api.get(`/incidents/${id}`),
  create: (data: any) => api.post('/incidents', data),
  update: (id: string, data: any) => api.patch(`/incidents/${id}`, data),
};

// Tasks
export const taskAPI = {
  list: (params?: any) => api.get('/tasks', { params }),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  updateStatus: (id: string, data: any) => api.patch(`/tasks/${id}/status`, data),
  reassign: (id: string, assigned_to: string) => api.patch(`/tasks/${id}/reassign`, { assigned_to }),
};

// Users
export const userAPI = {
  list: (params?: any) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data),
};

// Inventory
export const inventoryAPI = {
  list: (params?: any) => api.get('/inventory', { params }),
  create: (data: any) => api.post('/inventory', data),
  update: (id: string, data: any) => api.patch(`/inventory/${id}`, data),
  shipments: (params?: any) => api.get('/inventory/shipments', { params }),
  createShipment: (data: any) => api.post('/inventory/shipments', data),
  scanShipment: (id: string, qr_code: string) => api.patch(`/inventory/shipments/${id}/scan`, { qr_code }),
};

// Verification
export const verificationAPI = {
  pending: () => api.get('/verification/pending'),
  approve: (userId: string) => api.post(`/verification/${userId}/approve`),
  reject: (userId: string, reason?: string) => api.post(`/verification/${userId}/reject`, { reason }),
};

// Resource Requests
export const requestAPI = {
  list: () => api.get('/requests'),
  updateStatus: (id: string, status: 'pending' | 'approved' | 'rejected' | 'fulfilled') => 
    api.patch(`/requests/${id}/status`, { status }),
};

// Matching
export const matchingAPI = {
  dispatch: (missionId: string, unitId?: string) => api.post(`/matching/dispatch/${missionId}`, { unitId }),
  getRoute: (data: any) => api.post('/matching/route', data),
};

// Analytics
export const analyticsAPI = {
  overview: () => api.get('/reports/overview'),
  missions: () => api.get('/reports/incidents'),
  volunteers: () => api.get('/reports/volunteers'),
};

// Dispatch Units
export const dispatchUnitAPI = {
  list: () => api.get('/dispatch-units'),
  create: (data: any) => api.post('/dispatch-units', data),
  delete: (id: string) => api.delete(`/dispatch-units/${id}`),
};

// Volunteer Dispatch
export const volunteerDispatchAPI = {
  list: () => api.get('/volunteer-dispatch'),
  create: (data: any) => api.post('/volunteer-dispatch', data),
  delete: (id: string) => api.delete(`/volunteer-dispatch/${id}`),
};

// Respond Units
export const respondUnitAPI = {
  list: () => api.get('/respond-units'),
  create: (data: any) => api.post('/respond-units', data),
  update: (id: string, data: any) => api.patch(`/respond-units/${id}`, data),
  delete: (id: string) => api.delete(`/respond-units/${id}`),
};

// Officers
export const officerAPI = {
  list: () => api.get('/officers'),
  create: (data: any) => api.post('/officers', data),
  update: (id: string, data: any) => api.patch(`/officers/${id}`, data),
  delete: (id: string) => api.delete(`/officers/${id}`),
};

// Storages
export const storageAPI = {
  list: () => api.get('/storages'),
  create: (data: any) => api.post('/storages', data),
  update: (id: string, data: any) => api.patch(`/storages/${id}`, data),
  delete: (id: string) => api.delete(`/storages/${id}`),
};

// Blocked Routes
export const blockedRouteAPI = {
  list: (params?: any) => api.get('/blocked-routes', { params }),
  create: (data: any) => api.post('/blocked-routes', data),
  update: (id: string, active: boolean) => api.patch(`/blocked-routes/${id}`, { active }),
};

// Reports
export const reportAPI = {
  list: (params?: any) => api.get('/incident-reports', { params }),
  get: (id: string) => api.get(`/incident-reports/${id}`),
  verify: (id: string, address?: string) => api.post(`/incident-reports/${id}/verify`, { address }),
};

// Weather
export const weatherAPI = {
  getCurrent: () => api.get('/weather/current'),
  getForecast: () => api.get('/weather/forecast'),
  getAdvisories: () => api.get('/weather/advisories'),
  createAdvisory: (data: any) => api.post('/weather/advisories', data),
  getHazardZones: () => api.get('/weather/hazard-zones'),
  getEarthquakes: () => api.get('/weather/earthquakes'),
  getRiverStations: () => api.get('/weather/river-stations'),
  getRiverLevels: (stationId: string) => api.get(`/weather/river-levels/${stationId}`),
  addRiverLevel: (data: any) => api.post('/weather/river-levels', data),
  getDamStations: () => api.get('/weather/dam-stations'),
  getDamLevels: (damId: string) => api.get(`/weather/dam-levels/${damId}`),
  addDamLevel: (data: any) => api.post('/weather/dam-levels', data),
};

// Evacuation Centers
export const evacuationAPI = {
  list: (params?: { barangay_id?: string }) => api.get('/evacuation-centers', { params }),
  get: (id: string) => api.get(`/evacuation-centers/${id}`),
  getRegistrations: (id: string) => api.get(`/evacuation-centers/${id}/registrations`),
};

// Barangays (for filter dropdowns)
export const barangayListAPI = {
  list: () => api.get('/barangay/list'),
};
