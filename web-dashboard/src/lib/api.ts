import axios from 'axios';
import { io } from 'socket.io-client';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const SOCKET_BASE = API_BASE.replace('/api', '');

const api = axios.create({
  baseURL: API_BASE,
  headers: { 
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  },
});

export const socket = io(SOCKET_BASE, {
  autoConnect: false,
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
    const url = String(err.config?.url || '');
    const isLoginRequest = /\/(?:auth\/login|barangay\/login)(?:$|\?)/.test(url);
    if (err.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('norzagapay_token');
      localStorage.removeItem('norzagapay_user');
      if (window.location.pathname !== '/login') window.location.replace('/login');
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const authAPI = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  barangayLogin: (email: string, password: string) => api.post('/barangay/login', { email, password }),
  barangayMe: () => api.get('/barangay/me'),
  masterAdminSetupStatus: () => api.get('/auth/master-admin-setup/status'),
  createMasterAdmin: (data: { full_name: string; email: string; password: string }) => api.post('/auth/master-admin-setup', data),
  register: (data: any) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

export const debugAPI = {
  accounts: (audience: 'standard' | 'barangay' = 'standard') => api.get('/debug/accounts', { params: { audience } }),
  quickLogin: (accountId: string, audience: 'standard' | 'barangay' = 'standard') => api.post('/debug/quick-login', { accountId, audience }),
};

// Public broadcast feed and the persisted MDRRMO post manager.
export const broadcastAPI = {
  publicFeed: () => api.get('/broadcasts'),
  listMdrrmo: () => api.get('/broadcasts/mdrrmo'),
  createMdrrmo: (data: FormData) => api.post('/broadcasts/mdrrmo', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  updateMdrrmo: (id: string, data: FormData) => api.patch(`/broadcasts/mdrrmo/${id}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  setMdrrmoPinned: (id: string, is_pinned: boolean) => api.patch(`/broadcasts/mdrrmo/${id}/pin`, { is_pinned }),
  deleteMdrrmo: (id: string) => api.delete(`/broadcasts/mdrrmo/${id}`),
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
  create: (data: {
    full_name: string;
    email: string;
    password: string;
    role: string;
    phone?: string | null;
    unit_type?: string | null;
  }) => api.post('/users', data),
  get: (id: string) => api.get(`/users/${id}`),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data),
};

// Verification
export const verificationAPI = {
  pending: () => api.get('/verification/pending'),
  archived: () => api.get('/verification/archived'),
  approve: (userId: string) => api.post(`/verification/${userId}/approve`),
  reject: (userId: string, reason?: string) => api.post(`/verification/${userId}/reject`, { reason }),
  restore: (userId: string) => api.post(`/verification/${userId}/restore`),
  bulkApprove: (userIds: string[]) => api.post('/verification/bulk-approve', { userIds }),
  bulkReject: (userIds: string[], reason?: string) => api.post('/verification/bulk-reject', { userIds, reason }),
  bulkRestore: (userIds: string[]) => api.post('/verification/bulk-restore', { userIds }),

  // Barangay Account Requests
  barangayAccountRequestsPending: () => api.get('/verification/barangay-accounts/pending'),
  barangayAccountRequestsArchived: () => api.get('/verification/barangay-accounts/archived'),
  barangayAccountRequestsApproved: () => api.get('/verification/barangay-accounts/approved'),
  approveBarangayAccountRequest: (id: string, notes?: string) => api.post(`/verification/barangay-accounts/${id}/approve`, { notes }),
  rejectBarangayAccountRequest: (id: string, reason: string) => api.post(`/verification/barangay-accounts/${id}/reject`, { reason }),
  requestBarangayAccountCorrection: (id: string, reason: string) => api.post(`/verification/barangay-accounts/${id}/request-correction`, { reason }),
  setBarangayAccountActive: (id: string, is_active: boolean) => api.patch(`/verification/barangay-accounts/${id}/active`, { is_active }),
};

// Assistance Requests
export const requestAPI = {
  list: (params?: { incident_id?: string }) => api.get('/requests', { params }),
  updateStatus: (id: string, status: 'pending' | 'approved' | 'rejected' | 'fulfilled') => 
    api.patch(`/requests/${id}/status`, { status }),
};

// Analytics
export const analyticsAPI = {
  overview: () => api.get('/reports/overview'),
  incidents: () => api.get('/reports/incidents'),
  responders: () => api.get('/reports/responders'),
};

// Dispatch Units
export const dispatchUnitAPI = {
  list: () => api.get('/dispatch-units'),
  create: (data: any) => api.post('/dispatch-units', data),
  delete: (id: string) => api.delete(`/dispatch-units/${id}`),
};

// Respond Units
export const respondUnitAPI = {
  list: () => api.get('/respond-units'),
  leaderAccounts: (unitId?: string) => api.get('/respond-units/leader-accounts', { params: unitId ? { unit_id: unitId } : undefined }),
  activateToday: (id: string, active: boolean) => api.put(`/respond-units/${id}/activation-today`, { active }),
  emergencyActivateAllToday: () => api.post<{ activation_date: string; activated_count: number; skipped_count: number }>('/respond-units/activate-all-today'),
  create: (data: any) => api.post('/respond-units', data),
  update: (id: string, data: any) => api.patch(`/respond-units/${id}`, data),
  assignLeader: (id: string, responder_user_id: string) => api.put(`/respond-units/${id}/team-leader`, { responder_user_id }),
  clearLeader: (id: string) => api.delete(`/respond-units/${id}/team-leader`),
  addMember: (id: string, data: { name: string; phone?: string; member_role: string }) => api.post(`/respond-units/${id}/members`, data),
  updateMember: (id: string, memberId: string, data: Record<string, unknown>) => api.patch(`/respond-units/${id}/members/${memberId}`, data),
  removeMember: (id: string, memberId: string) => api.delete(`/respond-units/${id}/members/${memberId}`),
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
  mdrrmoQueue: () => api.get('/mdrrmo/reports/queue'),
  barangayReports: (params?: any) => api.get('/barangay/reports', { params }),
  barangayResponders: () => api.get('/barangay/team/responders'),
  dispatchToBarangay: (id: string, data: { team_leader_ids: string[]; incident_type: string; severity: string; notes?: string }) => api.patch(`/barangay/assigned-reports/${id}/dispatch`, data),
  respondBarangayAssignment: (id: string, notes?: string) => api.patch(`/barangay/assigned-reports/${id}/respond`, { notes }),
  arriveBarangayAssignment: (id: string, data: { method: 'gps' | 'manual'; latitude?: number; longitude?: number; accuracy_m?: number; fix_at?: string }) => api.patch(`/barangay/assigned-reports/${id}/arrive`, data),
  closeBarangayAssignment: (id: string, resolved_notes: string) => api.post(`/barangay/assigned-reports/${id}/close`, { resolved_notes }),
  escalateBarangayAssignment: (id: string, notes: string) => api.patch(`/barangay/assigned-reports/${id}/escalate`, { notes }),
  assignBarangay: (id: string, data: { barangay_id: string; notes: string }) => api.post(`/mdrrmo/reports/${id}/assign-barangay`, data),
  reassignBarangay: (id: string, data: { barangay_id: string; notes: string }) => api.post(`/mdrrmo/reports/${id}/reassign-barangay`, data),
  recallBarangay: (id: string, notes: string) => api.post(`/mdrrmo/reports/${id}/recall-barangay`, { notes }),
  barangayDestinations: (reportId: string) => api.get('/mdrrmo/reports/barangay-destinations', { params: { report_id: reportId } }),
  commandLocations: () => api.get('/mdrrmo/reports/command-locations'),
  availableResponders: (params: { location_type: 'office' | 'barangay'; barangay_id?: string }) => api.get('/mdrrmo/reports/available-responders', { params }),
  barangayLocation: () => api.get('/barangay/location'),
  availableBarangayResponders: () => api.get('/barangay/location/available-responders'),
  saveBarangayLocation: (data: { latitude: number; longitude: number; address?: string | null }) => api.put('/barangay/location', data),
  saveOfficeLocation: (data: { latitude: number; longitude: number; address?: string | null }) => api.put('/mdrrmo/reports/command-locations/office', data),
  guestReport: (data: { type: string; title: string; description: string; latitude: number; longitude: number; contact_number: string; send_to: 'barangay' | 'mdrrmo'; incident_time_choice?: string; incident_occurred_at?: string | null; incident_time_precision?: string }, evidence?: File | null) => {
    const body = new FormData();
    Object.entries(data).forEach(([key, value]) => body.append(key, value == null ? '' : String(value)));
    if (evidence) { body.append('proof', evidence); body.append('proof_type', evidence.type.startsWith('video/') ? 'video' : 'image'); }
    return api.post('/incident-reports', body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  publicHotlines: () => api.get('/barangay/public-hotlines'),
  downloadMdrrmoResolutionPdf: (id: string) => api.get(`/mdrrmo/reports/${id}/resolution-pdf`, { responseType: 'blob' }),
  mdrrmoResponders: () => api.get<{ responders: Array<{ id: string; full_name: string; phone?: string | null; unit_type?: string | null; unit_id: string; unit_name: string }> }>('/mdrrmo/reports/responders'),
  dispatchToMdrrmo: (id: string, data: { responder_ids: string[]; incident_type: string; severity: string; notes?: string }) => api.post(`/mdrrmo/reports/${id}/dispatch`, data),
  review: (id: string, data: { outcome: 'inconclusive' | 'false_report'; reason?: string }) => api.patch(`/incident-reports/${id}/review`, data),
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
  list: (params?: { barangay_added?: boolean }) => api.get('/evacuation-centers', { params }),
};

export const municipalityBoundaryAPI = {
  get: () => api.get('/municipality-boundary'),
  history: () => api.get('/municipality-boundary/history'),
  deleteVersion: (revision: number) => api.delete(`/municipality-boundary/history/${revision}`),
  useVersion: (revision: number, data: { expectedRevision: number; expectedUpdatedAt: string | null }) =>
    api.post(`/municipality-boundary/history/${revision}/use`, data),
  updateVersion: (revision: number, data: { geometry: unknown; expectedUpdatedAt: string | null }) =>
    api.put(`/municipality-boundary/history/${revision}`, data),
  save: (data: { geometry: unknown; enabled: boolean; expectedRevision: number; expectedUpdatedAt: string | null }) =>
    api.put('/municipality-boundary', data),
};
