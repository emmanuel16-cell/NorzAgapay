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
    const isLoginRequest = /\/(?:auth\/login|auth\/resident\/login|barangay\/login)(?:$|\?)/.test(url);
    if (err.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('norzagapay_token');
      localStorage.removeItem('norzagapay_user');
      localStorage.removeItem('norzagapay_account_kind');
      if (window.location.pathname !== '/login') window.location.replace('/login');
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const authAPI = {
  login: (identifier: string, password: string) => api.post('/auth/login', { identifier, password }),
  residentLogin: (identifier: string, password: string) => api.post('/auth/resident/login', { identifier, password }),
  requestResidentWebRegistrationOtp: (data: { username: string; phone: string }) => api.post('/auth/resident/web-register-otp', data),
  verifyResidentWebRegistrationOtp: (data: { phone: string; otp: string }) => api.post('/auth/resident/web-verify-register-otp', data),
  updateProfile: (data: { full_name: string; username: string; email: string | null; phone: string | null }) => api.patch('/auth/profile', data),
  updateResidentProfile: (data: { full_name?: string; username?: string; email?: string | null; phone?: string | null; barangay_name?: string }) => api.patch('/auth/resident/profile', data),
  requestWebPasswordOtp: (data: { current_password: string; delivery_method: 'email' | 'sms' }) => api.post('/auth/profile/password-otp', data),
  changeWebPassword: (data: { current_password: string; otp: string; new_password: string; delivery_method: 'email' | 'sms' }) => api.post('/auth/profile/change-password', data),
  sendResidentWebPasswordOtp: (current_password: string) => api.post('/auth/resident/web-password-change-otp', { current_password }),
  changeResidentWebPassword: (data: { current_password: string; otp: string; new_password: string }) => api.post('/auth/resident/web-change-password', data),
  barangayLogin: (identifier: string, password: string) => api.post('/barangay/login', { identifier, password }),
  sendBarangayPasswordOtp: (identifier: string, delivery_method: 'email' | 'sms') => api.post('/auth/barangay/password-otp', { identifier, delivery_method }),
  changeBarangayPassword: (data: { identifier: string; delivery_method: 'email' | 'sms'; otp: string; current_password: string; new_password: string }) => api.post('/auth/barangay/change-password', data),
  sendBarangayRegistrationOtp: (data: { full_name: string; username: string; email?: string; phone?: string; delivery_method: 'email' | 'sms'; barangay_id: string; position_designation: string }) => api.post('/barangay/register-otp', data),
  verifyBarangayRegistrationOtp: (data: { delivery_method: 'email' | 'sms'; destination: string; otp: string }) => api.post('/barangay/verify-register-otp', data),
  barangaysForAdminSignup: () => api.get('/barangay/list', { params: { admin_signup: true } }),
  barangayMe: () => api.get('/barangay/me'),
  masterAdminSetupStatus: () => api.get('/auth/master-admin-setup/status'),
  createMasterAdmin: (data: { full_name: string; username: string; email: string; password: string }) => api.post('/auth/master-admin-setup', data),
  register: (data: any) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

export const debugAPI = {
  accounts: (audience: 'standard' | 'barangay' | 'resident' = 'standard') => api.get('/debug/accounts', { params: { audience } }),
  quickLogin: (accountId: string, audience: 'standard' | 'barangay' | 'resident' = 'standard') => api.post('/debug/quick-login', { accountId, audience }),
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
    username: string;
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

// Barangay-specific administration and community operations. Every endpoint
// below is scoped from the authenticated barangay session on the server.
export const barangayAPI = {
  updateProfile: (data: { full_name: string; username: string; email: string | null; phone: string | null }) => api.patch('/barangay/profile', data),
  requestProfilePasswordOtp: (data: { current_password: string; delivery_method: 'email' | 'sms' }) => api.post('/barangay/profile/password-otp', data),
  changeProfilePassword: (data: { current_password: string; otp: string; new_password: string; delivery_method: 'email' | 'sms' }) => api.post('/barangay/profile/change-password', data),
  accountRequest: () => api.get('/barangay/account-request'),
  accountStatus: () => api.get('/barangay/account-request/status'),
  saveAccountRequest: (data: { official_name: string; official_position: string; position_designation?: string }) => api.put('/barangay/account-request', data),
  requestActivation: () => api.post('/barangay/account-request/activation'),
  resubmitAccountRequest: () => api.post('/barangay/account-request/resubmit'),
  certificateTemplate: (download = false) => api.get('/barangay/account-request/certificate', {
    params: download ? { download: 'true' } : undefined,
    responseType: 'blob',
  }),
  submitCertificate: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return api.post('/barangay/account-request/certificate', body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  team: () => api.get('/barangay/team'),
  createTeamMember: (data: { full_name: string; username: string; password: string; phone?: string; role: 'dispatcher' | 'responder' | 'staff' }) => api.post('/barangay/team', data),
  updateTeamMember: (id: string, data: { full_name: string; username: string; password?: string; phone?: string | null; role: 'dispatcher' | 'responder' | 'staff' }) => api.patch(`/barangay/team/${id}`, data),
  setTeamMemberActive: (id: string, is_active: boolean) => api.patch(`/barangay/team/${id}/active`, { is_active }),
  statistics: (type?: 'community' | 'emergency') => api.get('/barangay/reports/statistics', { params: type ? { type } : undefined }),
  hotlineSettings: () => api.get('/barangay/settings/hotlines'),
  publishedHotlines: (barangayId: string) => api.get(`/barangay/hotlines/${encodeURIComponent(barangayId)}`),
  saveHotlines: (entries: Array<{ purpose: string; numbers: string[] }>) => api.put('/barangay/hotlines', { entries }),
  createAssistanceRequest: (data: {
    incident_report_id?: string | null;
    incident_title?: string | null;
    needs_more_manpower: boolean;
    needs_resources: boolean;
    needs_equipment: boolean;
    beyond_barangay_capability: boolean;
    explanation: string;
  }) => api.post('/barangay/assistance-requests', data),
  assistanceRequests: () => api.get('/barangay/assistance-requests'),
  myAssistanceRequests: () => api.get('/barangay/my-assistance-requests'),
  editAssistanceRequest: (id: string, data: {
    incident_report_id?: string | null;
    incident_title?: string | null;
    needs_more_manpower: boolean;
    needs_resources: boolean;
    needs_equipment: boolean;
    beyond_barangay_capability: boolean;
    explanation: string;
  }) => api.patch(`/barangay/assistance-requests/${id}/edit`, data),
  decideAssistanceRequest: (id: string, decision: 'provide_barangay_assistance' | 'coordinate_mdrrmo' | 'dismissed', dispatcher_notes: string) => api.patch(`/barangay/assistance-requests/${id}/decide`, { decision, dispatcher_notes }),
  assistanceTeamAction: (id: string, action: 'acknowledge' | 'cancel') => api.patch(`/barangay/assistance-requests/${id}/team-action`, { action }),
  barangayBroadcasts: () => api.get('/barangay/broadcasts'),
  mdrrmoBroadcasts: () => api.get('/barangay/broadcasts/mdrrmo'),
  createBarangayBroadcast: (data: FormData) => api.post('/barangay/broadcasts', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateBarangayBroadcast: (id: string, data: FormData) => api.patch(`/barangay/broadcasts/${id}`, data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteBarangayBroadcast: (id: string) => api.delete(`/barangay/broadcasts/${id}`),
  setBarangayBroadcastPinned: (id: string, is_pinned: boolean) => api.patch(`/barangay/broadcasts/${id}/pin`, { is_pinned }),
  repostMdrrmoBroadcast: (id: string) => api.post(`/barangay/broadcasts/${id}/repost`),
};

// Assistance Requests
export const requestAPI = {
  list: (params?: { incident_id?: string }) => api.get('/requests', { params }),
  mine: () => api.get('/requests/mine'),
  create: (data: { request_type: 'responders' | 'goods'; sub_type?: string; details: string; incident_id: string }) => api.post('/requests', data),
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
  myUnit: () => api.get('/respond-units/my-unit'),
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
  mine: () => api.get('/incident-reports/me'),
  verifiedBarangays: () => api.get('/barangay/list', { params: { verified_only: true } }),
  get: (id: string) => api.get(`/incident-reports/${id}`),
  mdrrmoQueue: () => api.get('/mdrrmo/reports/queue'),
  barangayReports: (params?: any) => api.get('/barangay/reports', { params }),
  barangayResolvedReports: () => api.get('/barangay/reports/resolved'),
  barangayResolutionPdf: (id: string) => api.get(`/barangay/reports/${id}/resolution-pdf`, { responseType: 'blob' }),
  barangayResponders: () => api.get('/barangay/team/responders'),
  barangayCrewRoster: () => api.get('/barangay/team/crew-roster'),
  saveBarangayResponseCrew: (id: string, members: Array<{ member_id: string; crew_role: string }>) => api.patch(`/barangay/assigned-reports/${id}/crew`, { members }),
  dispatchToBarangay: (id: string, data: { team_leader_ids: string[]; incident_type: string; severity: string; notes?: string }) => api.patch(`/barangay/assigned-reports/${id}/dispatch`, data),
  arriveBarangayAssignment: (id: string, data: { method: 'gps' | 'manual'; latitude?: number; longitude?: number; accuracy_m?: number; fix_at?: string }) => api.patch(`/barangay/assigned-reports/${id}/arrive`, data),
  saveBarangayAssignmentFieldNotes: (id: string, data: { situation: string; affected_people: string; actions_taken: string; risks_resources: string }) => api.patch(`/barangay/assigned-reports/${id}/field-notes`, data),
  closeBarangayAssignment: (id: string, resolved_notes: string) => api.post(`/barangay/assigned-reports/${id}/close`, { resolved_notes }),
  uploadBarangayAssignmentMedia: (id: string, file: File) => {
    const body = new FormData();
    body.append('media', file);
    return api.post(`/barangay/assigned-reports/${id}/field-media`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  uploadBarangayFieldMedia: (id: string, file: File) => {
    const body = new FormData();
    body.append('media', file);
    return api.post(`/barangay/reports/${id}/field-media`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
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
  guestReport: (data: { type: string; title: string; description: string; latitude: number; longitude: number; contact_number: string; send_to: 'mdrrmo'; incident_type?: string; specifics?: string; incident_time_choice?: string; incident_occurred_at?: string | null; incident_time_precision?: string; client_request_id?: string; client_submitted_at?: string }, evidence?: File | null) => {
    const body = new FormData();
    Object.entries(data).forEach(([key, value]) => body.append(key, value == null ? '' : String(value)));
    if (evidence) { body.append('proof', evidence); body.append('proof_type', evidence.type.startsWith('video/') ? 'video' : 'image'); }
    return api.post('/incident-reports', body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  trackGuestReport: (id: string, contactNumber: string) => api.get(`/incident-reports/resident/${encodeURIComponent(id)}`, { params: { contact_number: contactNumber } }),
  publicHotlines: () => api.get('/barangay/public-hotlines'),
  downloadMdrrmoResolutionPdf: (id: string) => api.get(`/mdrrmo/reports/${id}/resolution-pdf`, { responseType: 'blob' }),
  mdrrmoResponders: () => api.get<{ responders: Array<{ id: string; full_name: string; phone?: string | null; unit_type?: string | null; unit_id: string; unit_name: string }> }>('/mdrrmo/reports/responders'),
  dispatchToMdrrmo: (id: string, data: { responder_ids: string[]; incident_type: string; severity: string; notes?: string }) => api.post(`/mdrrmo/reports/${id}/dispatch`, data),
  saveMdrrmoResponseCrew: (id: string, member_ids: string[]) => api.patch(`/mdrrmo/reports/${id}/crew`, { member_ids }),
  arriveAtMdrrmoIncident: (id: string) => api.patch(`/mdrrmo/reports/${id}/arrive`, { method: 'manual' }),
  saveMdrrmoFieldAssessment: (id: string, data: { situation: string; affected_people: string; actions_taken: string; risks_resources: string }) => api.patch(`/mdrrmo/reports/${id}/field-assessment`, data),
  closeMdrrmoReport: (id: string, resolved_notes: string) => api.post(`/mdrrmo/reports/${id}/close`, { resolved_notes }),
  uploadMdrrmoFieldMedia: (id: string, file: File) => {
    const body = new FormData();
    body.append('media', file);
    return api.post(`/mdrrmo/reports/${id}/field-media`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  review: (id: string, data: { outcome: 'inconclusive' | 'false_report'; reason?: string }) => api.patch(`/incident-reports/${id}/review`, data),
};

export const evacuationAPI = {
  list: () => api.get('/evacuation-centers', { params: { verified_only: true } }),
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
