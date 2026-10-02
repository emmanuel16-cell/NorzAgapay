# NorzAgapay — Full System Build Reference

## Project Context

**NorzAgapay** is an integrated web and mobile-based Emergency Response and Crisis Management Coordination System for the Municipality of Norzagaray, Bulacan. It digitally connects four distinct user groups into a unified emergency coordination pipeline:

- **MDRRMO** — Municipal Disaster Risk Reduction and Management Office (command and oversight)
- **Barangay LGU / BDRRMC** — Barangay Local Government Units and Disaster Risk Reduction and Management Committees (jurisdiction-level response)
- **Barangay Tanods** — Frontline first responders assigned and dispatched per incident
- **Residents** — Community members who report emergencies and receive public safety information

The system replaces fragmented phone calls, radio-based coordination, and physical logbooks with a real-time, multi-platform pipeline covering incident reporting, field dispatch, GPS-based response tracking, evacuation center monitoring, inter-agency escalation, and localized public safety advisories.

---

## Technology Stack (As Built)

| Layer | Technology |
|---|---|
| **Web Dashboard** | React 18, Vite, TypeScript, Leaflet + OpenStreetMap, Socket.IO Client |
| **Unified Operations App** | Flutter + Dart, Provider, Hive, Flutter Secure Storage, Flutter Map, Socket.IO Client |
| **Resident Emergency App** | Flutter + Dart, Hive, Image Picker, Location Service, Flutter Map |
| **Backend API** | Node.js, Express.js, TypeScript, Socket.IO Server |
| **Database** | Supabase PostgreSQL (with RLS, Row Level Security) |
| **Auth** | Supabase Auth + JWT (issued and validated by backend) |
| **Realtime** | Supabase Realtime + Socket.IO (role/barangay/user rooms) |
| **File Storage** | Supabase Storage (bucket: `norzagapay-files`) |
| **GPS Caching** | Upstash Redis (TTL-based, REST API) |
| **Routing/Navigation** | Project OSRM (OpenStreetMap Routing Machine) |
| **PDF Generation** | PDFKit (server-side, for dispatcher accreditation documents) |
| **Validation** | Zod (backend schema validation) |
| **Weather Data** | Open-Meteo API (with PAGASA simulation layer) |
| **Tunneling (Dev)** | ngrok / localtunnel + `update-tunnel-url.js` utility |

---

## Roles and Authorization

| Role | Platform | Scope of Access |
|---|---|---|
| MDRRMO `master_admin` | Web + Mobile | All municipal operations, verification, accounts, dispatch, units, stations, advisories, analytics, weather, and requests |
| MDRRMO `admin` | Web + Mobile | Incident oversight, officer and barangay coordination verification, user management, advisories, analytics, weather, and station entry |
| MDRRMO `dispatcher` | Web + Mobile | Incident review/dispatch, command map, responder tracking, and weather |
| MDRRMO `logistics` | Web + Mobile | Resource requests, response units, responder tracking, and station entry |
| Barangay `admin` | Web + Mobile | Own-barangay command center and operations, team, coordination request, analytics, and station entry |
| Barangay `dispatcher` | Web + Mobile | Own-barangay incident dispatch/escalation, assistance decisions, and response status |
| Barangay `responder` | Web + Mobile | Own-barangay field response, status/media, assistance, GPS, and navigation |
| Barangay `staff` | Web + Mobile | Own-barangay community updates, hotlines, and station entry |
| `resident` | Mobile (resident_app) | Incident submission, own report tracking, public safety information, and nearest evacuation stations with estimated distance/time |

**Access rules:**
- Barangay users access only their assigned `barangay_id`; cross-barangay access is blocked.
- Residents access only their own `incident_reports` and public-safe data.
- MDRRMO users access the full municipality scope.
- Barangay access is activated for all its accounts through the administrator's shared coordination request.

---

## Subsystem Overview

### 1. MDRRMO Web Portal (`web-dashboard/`)

React + Vite + TypeScript SPA. Communicates with backend via REST API and Socket.IO.

**Implemented pages:**

| Page | File | Description |
|---|---|---|
| Login | `LoginPage.tsx` | Secure login with role-based redirect routing |
| Command Center | `CommandCenter.tsx` | Live incident map (Leaflet/OSM), severity heatmap, active counters, escalation queue, Tanod GPS positions, duty-status board, evacuation summary panel |
| Reports / Verification | `ReportsPage.tsx`, `VerificationPage.tsx` | Incident list with filters; full incident detail + media gallery + status history + dispatcher verification queue with PDF review, approval/rejection workflow |
| Respond Units | `RespondUnitsPage.tsx` | Registered professional emergency units, duty and operational status, assignment logs |
| Officers | `OfficersPage.tsx` | MDRRMO officer accounts and barangay assignments |
| Add Evacuation Station | `EvacuationCentersPage.tsx` | Add a station and map pin for a selected barangay |
| Resource Requests | `ResourceRequestsPage.tsx` | Field resource request review from units |
| Responder Tracker | `ResponderTrackerPage.tsx` | Responder progress from dispatch through return, with map selection from the Command Center and barangay workspace |
| Analytics | `AnalyticsPage.tsx` | Incident trends, response-time statistics, severity breakdown charts |
| Weather Monitoring | `WeatherMonitoringV2.tsx` | Real-time weather conditions (Open-Meteo), river station water levels, hydromet alerts |
| Users | `UsersPage.tsx` | MDRRMO user account management |
| Alert Broadcasts | `AlertBroadcastsPage.tsx` | Admin management of emergency alert broadcasts |

---

### 2. Unified MDRRMO and Barangay Operations App (`mobile_app/`)

Flutter client with separate MDRRMO and barangay login scopes. The mobile layout keeps navigation compact while exposing each role's authorized operations. Barangay accounts remain limited to their own barangay and the shared coordination activation gate.

**Barangay functions:** incident queue and field actions, local dispatch/escalation, assistance requests, team management, community posts, hotlines, analytics, coordination request, and add-station entry.

**MDRRMO functions:**

| Role | Mobile functions |
|---|---|
| Master Admin | Incident dispatch, user/verification review, barangay coordination review, resource requests, response units, responder locations, station entry, advisories, weather, and summary analytics |
| Admin | Incident queue, user and verification workflows, barangay coordination approval, advisories, weather, analytics, and station entry |
| Dispatcher | Incident review/dispatch, responder location links, weather |
| Logistics | Resource request decisions, response units, responder location links, station entry |
| Responder | Existing duty status, dispatch alerts, task updates, GPS, routing, unit membership, resource requests, and field documentation |

The responder screens from the prior client are retained under `mobile_app/lib/mdrrmo/`.

---

### 4. Resident Emergency App (`resident_app/`)

Flutter mobile application for citizens of Norzagaray. Offline-capable for report queuing and advisory caching.

**Implemented screens:**

| Screen | File | Description |
|---|---|---|
| Reporting | `reporting_screen.dart` | Emergency/community incident report with GPS auto-detection, incident type selection (flash_flood / fire / landslide / medical_emergency / typhoon / other), target routing (Barangay / MDRRMO / All), description and media attachment |
| Emergency Camera | `emergency_camera_screen.dart` | Quick-launch camera capture linked to an incident report |
| My Reports | `my_reports_screen.dart` | Submitted report list with resolution status timeline |
| Report Detail | `report_detail_screen.dart` | Full status journey (pending → verified → dispatched → on_scene → resolved), public-safe view of field updates and resolution notes |
| Nearest Evacuation Stations | `evacuation_centers_screen.dart` | Shows nearest active stations, distance, and estimated travel time |
| Profile | `profile_screen.dart` | Resident profile management |

---

### 5. Backend API & Real-Time Engine (`backend/`)

Node.js + Express.js + TypeScript server. Handles authentication, data access, socket event routing, background jobs, and document generation.

**Running on port:** `3001` (configurable via `PORT` env var).

#### API Routes

| Route Prefix | File | Responsibility |
|---|---|---|
| `/api/auth` | `auth.ts` | Login, registration, JWT refresh, session validation |
| `/api/incident-reports` | `incidentReports.ts` | Resident report CRUD; targeted routing (barangay/mdrrmo/all); dispatcher-selected type/severity and MDRRMO responder task dispatch; co-response status; multi-media proof uploads |
| `/api/barangay` | `barangay.ts` | Full barangay operations: report management, Tanod dispatch assignments, team duty status, escalations, assistance requests |
| `/api/tasks` | `tasks.ts` | Tanod task/dispatch records, status transitions, field documentation |
| `/api/evacuation-centers` | `evacuationCenters.ts` | Add stations, list active locations, and calculate nearest-station distance/time |
| `/api/users` | `users.ts` | User management, account status, profile updates |
| `/api/verification` | `verification.ts` | Dispatcher accreditation: document upload, review queue, PDF reference management, status transitions |
| `/api/weather` | `weather.ts` | Weather data fetch (Open-Meteo), forecast storage, river station levels and alerts |
| `/api/matching` | `matching.ts` | Responder availability matching engine queries |
| `/api/respond-units` | `respondUnits.ts` | Professional emergency unit management (PNP, BFP, MDRRMO rescue) |
| `/api/dispatch-units` | `dispatchUnits.ts` | Dispatch unit CRUD and assignment |
| `/api/officers` | `officers.ts` | MDRRMO officer account data |
| `/api/requests` | `requests.ts` | Field resource requests from units |
| `/api/reports` | `reports.ts` | Analytics report data aggregation |
| `/api/upload` | `upload.ts` | Supabase Storage presigned URL generation and direct file upload handling |
| `/api/storages` | `storages.ts` | Storage bucket management utilities |
| `/api/blocked-routes` | `blockedRoutes.ts` | Road closure / blocked route registry for the command map |
| `/api/debug` | `debug.ts` | Development-only debug utilities (guarded by `ENABLE_DEBUG_QUICK_LOGIN`) |
| `GET /api/health` | `server.ts` | Health check endpoint |

#### Socket.IO Real-Time Events

**Server-side rooms:**

| Room | Members | Events Received |
|---|---|---|
| `commanders` | `mdrrmo_admin`, `mdrrmo_dispatcher` | `gps:location`, `task:statusChanged`, `incident:new`, `resource:request` |
| `professional_units` | Professional emergency units | `incident:alert` |
| `barangay:<id>` | All users in a specific barangay | `new_incident_report`, `report:updated` |
| `user:<id>` | Individual user | Personal targeted notifications |
| `role:<role>` | All users of a given role | Broadcast by role |

**Client-emitted events:**

| Event | Payload | Effect |
|---|---|---|
| `join:role` | `role: string` | Joins the appropriate commander or professional_units room |
| `join:barangay` | `barangayId: string` | Subscribes to barangay-scoped incident events |
| `join:user` | `userId: string` | Subscribes to personal notifications |
| `gps:update` | `{ userId, latitude, longitude }` | Writes GPS position to Upstash Redis; broadcasts to commanders room |
| `gps:requestAll` | — | Returns all active GPS positions from Redis to requesting socket |
| `task:statusUpdate` | `{ taskId, status, userId }` | Broadcasts task status change to commanders |
| `incident:new` | incident object | Broadcasts new incident alert to professional_units and commanders |
| `resource:request` | data | Broadcasts resource request to commanders |

#### Background Jobs (Scheduled via `setInterval`)

Runs automatically on server start and every **5 minutes** thereafter:

1. **Weather sync** — Fetches current conditions and hourly/daily forecasts from Open-Meteo API and persists to `weather_data` and `weather_forecasts` tables.
2. **River level simulation** — Reads active `river_stations`, applies level variations, persists to `river_levels`, updates station status, and auto-generates `weather_advisories` if levels reach warning or critical thresholds.

#### Backend Services

| Service | File | Function |
|---|---|---|
| Dispatcher Verification | `dispatcherVerificationService.ts` | Prefilled PDF generation (PDFKit), document lifecycle, audit history in JSONB |
| Matching Engine | `matchingEngine.ts` | Responder availability and proximity scoring for incident dispatch suggestions |

---

## Database Schema (As Migrated)

Run all migrations from `database/migrations/` in Supabase SQL Editor in this order:

| Migration File | Description |
|---|---|
| `migration.sql` | Core schema: all base tables, enums, RLS policies, indexes, Supabase Realtime publication setup |
| `evacuation_centers_migration.sql` | `barangays` table with pre-seeded Norzagaray barangay coordinates; `evacuation_centers`, `barangay_users`, `incident_reports` tables and related indexes |
| `dispatcher_verification_migration.sql` | `barangay_dispatcher_verifications` table: accreditation pipeline with full audit history in JSONB |
| `fix_dispatcher_verification_fk.sql` | Foreign key corrections for dispatcher verification user references |
| `co_response_migration.sql` | Adds MDRRMO co-response tracking columns to `incident_reports`: `mdrrmo_response_status`, `mdrrmo_responded_at`, `mdrrmo_responded_by`, `mdrrmo_responder_name`, `mdrrmo_response_notes` |
| `add_multiple_proof_and_field_media.sql` | Adds `proof_urls TEXT[]`, `proof_types TEXT[]`, `responder_media JSONB` to `incident_reports` for multi-photo resolution documentation |
| `add_send_to_to_incident_reports.sql` | Adds `send_to TEXT` to `incident_reports` for targeted routing: `'barangay'`, `'mdrrmo'`, or `'all'` |
| `incident_classification_migration.sql` | Adds dispatcher-selected `incident_type`, `severity`, and the linked MDRRMO dispatch incident ID to `incident_reports` |

### Key Tables

#### `users`
MDRRMO users separate from `auth.users`. Roles: `master_admin`, `admin`, `dispatcher`, `logistics`, and `responder`. Responders can also have specializations, verification status, and GPS coordinates.

#### `barangays`
`id`, `name`, `municipality` (default: `Norzagaray`), `province` (default: `Bulacan`), `latitude`, `longitude`, `created_at`. Pre-seeded with all Norzagaray barangay coordinates.

#### `barangay_users`
Barangay-scoped user accounts. Roles are `admin`, `dispatcher`, `responder`, and `staff`. Accounts use a separate login/JWT scope and remain restricted until their barangay's coordination request is activated.

#### `incident_reports`
Resident-submitted reports. `type` and `specifics` describe the resident submission/routing. Dispatchers set `incident_type` and `severity` after reviewing the details and evidence. Fields also include `id`, `reporter_id`, `barangay_id`, `description`, `latitude`, `longitude`, `address`, `status`, `media_url`, `proof_urls` (array), `proof_types` (array), `responder_media` (JSONB), `send_to`, `dispatch_incident_id`, MDRRMO co-response fields, and timestamps.

#### `incidents`
Municipal-level incident records (created/managed by MDRRMO). Separate from `incident_reports`. Fields: `id`, `title`, `type`, `severity`, `latitude`, `longitude`, `address`, `status`, `reported_by`, `assigned_by`, `resolved_at`, timestamps.

#### `tasks`
Tanod dispatch assignments. Fields: `id`, `incident_id`, `assigned_to`, `assigned_by`, `status` (enum: `pending`, `accepted`, `in_progress`, `completed`, `cancelled`), `type` (enum: `specialist`, `general_labor`), `notes`, `accepted_at`, `completed_at`, timestamps.

#### `evacuation_centers`
`id`, `barangay_id`, `name`, `address`, `latitude`, `longitude`, `is_active`, `created_by`, `created_at`, `updated_at`. Older deployments may still contain capacity and registration columns; the active application no longer reads or writes occupancy.

#### Barangay coordination verification
Stores the barangay administrator's authorization document, reference number, approval status, and review history. MDRRMO activation controls operational access for all active users in that barangay.

#### `weather_data`
Real-time weather readings: `temperature`, `humidity`, `wind_speed`, `wind_direction`, `rainfall`, `pressure`, `visibility`, `uv_index`, `weather_condition`, `data_source`, `recorded_at`.

#### `weather_forecasts`
Hourly and daily forecast records: `forecast_type`, `forecast_time`, `temperature`, `humidity`, `wind_speed`, `wind_direction`, `rainfall_probability`.

#### `river_stations`
Monitoring stations: `station_name`, `latitude`, `longitude`, `warning_level`, `critical_level`, `status`, `active`.

#### `river_levels`
Water level readings: `station_id`, `water_level`, `trend` (rising/falling/steady), `level` (normal/warning/critical), `recorded_at`.

#### `weather_advisories`
System-generated flood/weather alerts: `title`, `type`, `level`, `message`, `source`.

#### `alerts` + `activity_feed`
Real-time alert feed and system activity log, subscribed to Supabase Realtime.

#### Additional tables
`certifications`, `resource_requests`, `blocked_routes`, `dispatch_units`, `respond_units`, `officers`, `notifications`, `hospitals`, `schools`, `municipality_info`.

---

## Required Workflows (As Implemented)

### Resident Incident Reporting
1. Resident opens `resident_app` and navigates to the reporting screen.
2. GPS coordinates are auto-detected; the resident selects the incident type, writes a description, optionally attaches photos/video from the camera or gallery, and selects the target recipient (`barangay`, `mdrrmo`, or `all`).
3. Report is submitted to `POST /api/incident-reports` and stored in Supabase.
4. Socket.IO emits `new_incident_report` to the `barangay:<id>` room; the Barangay app receives the push alert instantly.
5. Resident monitors the report resolution journey through `my_reports_screen.dart` and `report_detail_screen.dart`.

### Barangay Assessment and Tanod Dispatch
1. Barangay app receives real-time socket notification of a new report; it appears at the top of the incident queue.
2. Barangay dispatcher opens the report, reviews its details, location, and attached evidence, then classifies its incident type and severity in the dispatch dialog.
3. Dispatcher selects an active responder and sends the classified assignment through the backend.
4. The updated classified report is sent to the authorized barangay room and the municipal command room; the responder's report list refreshes from the assigned report data.
5. Tanod reviews the assignment in the Dispatches tab and accepts it.
6. Tanod navigates to the incident using OSRM turn-by-turn routing and updates operational status: **En Route → On Scene → Resolved**.
7. At resolution, the Tanod uploads photo proof and submits closing remarks through `task_detail_screen.dart`.

### MDRRMO Co-Response
1. For high-severity incidents (e.g., fires, medical emergencies), the barangay admin can request MDRRMO direct co-response in addition to dispatching a local Tanod.
2. MDRRMO dispatcher sees the co-response request on the Command Center.
3. MDRRMO responder updates `mdrrmo_response_status`, `mdrrmo_responded_at`, and `mdrrmo_response_notes` via API.
4. Barangay app reflects the MDRRMO co-response status in the report detail view.

### MDRRMO Escalation Pipeline
1. A barangay responder requests MDRRMO review from the linked report when local resources are insufficient.
2. The barangay dispatcher reviews that request and escalates the already-classified report to MDRRMO.
3. MDRRMO dispatcher receives the report with the barangay's type and severity prefilled, may adjust them after review, and dispatches MDRRMO responders.
4. MDRRMO responder tasks carry the final type and severity, including any changes made by the municipal dispatcher.
5. The barangay and resident report views receive the updated escalation and response status.

### Evacuation Stations
1. Authorized barangay users add stations for their own barangay; MDRRMO Admin and Logistics users can add stations for any barangay.
2. The resident app requests active stations ordered by distance and receives estimated travel time using the configured average-speed assumption.
3. Station entry is the only active create/update workflow. Resident occupancy registration and station capacity management have been removed from the application.

### Dispatcher Accreditation Pipeline
1. Barangay admin initiates the accreditation process in `dispatcher_verification_screen.dart`.
2. The screen collects the applicant's details and Punong Barangay endorsement information.
3. Backend generates a prefilled official authorization PDF using PDFKit; a unique reference number is assigned.
4. Barangay admin uploads the signed physical document scan to complete the submission.
5. MDRRMO reviews the document queue in `VerificationPage.tsx`, inspects the uploaded PDF, and approves or rejects with a reason.
6. Full verification history is stored as a JSONB audit trail in `barangay_dispatcher_verifications`.

### Localized Safety Advisories & Weather Alerts
1. MDRRMO creates advisories (municipality-wide or barangay-targeted) with priority (`normal`, `important`, `emergency`) and optional expiration.
2. Advisories are delivered through Socket.IO push notifications and appear in the resident app advisory feed.
3. River level monitoring runs automatically every 5 minutes; stations at warning or critical level auto-generate hydromet advisories in `weather_advisories`.
4. Previously loaded advisories are cached locally in the mobile apps for offline viewing.

### Real-Time GPS Tracking
1. When a Tanod sets their status to On Duty, `GpsService.startTracking()` begins emitting `gps:update` events to the Socket.IO server.
2. The server writes coordinates to Upstash Redis with a 30-minute TTL per update.
3. The MDRRMO Command Center requests all active GPS positions via `gps:requestAll` and renders Tanod markers on the Leaflet map.
4. GPS broadcasting automatically stops when the Tanod goes Off Duty.

---

## Environment Configuration

### Backend (`backend/.env`)

```env
PORT=3001
NODE_ENV=development
CORS_ORIGIN=*

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_BUCKET_NAME=norzagapay-files

# JWT
JWT_SECRET=your-secure-jwt-secret
JWT_EXPIRES_IN=7d

# Upstash Redis
UPSTASH_REDIS_URL=https://your-redis.upstash.io
UPSTASH_REDIS_TOKEN=your-redis-token

# Optional
MAPBOX_ACCESS_TOKEN=your-mapbox-token
ENABLE_DEBUG_QUICK_LOGIN=false
```

### Web Dashboard (`web-dashboard/.env`)

```env
VITE_API_URL=http://localhost:3001/api
VITE_SOCKET_URL=http://localhost:3001
```

### Mobile Apps — API and Socket URL

The unified operations app and resident app maintain their API constants. To update them when using a tunnel (e.g., ngrok), run:

```bash
node update-tunnel-url.js https://your-tunnel-url.ngrok-free.app
```

This script updates:
- `mobile_app/lib/mdrrmo/core/constants.dart` → `apiBaseUrl`
- `mobile_app/lib/services/api_service.dart` → `baseUrl`
- `mobile_app/lib/services/auth_service.dart` → `_apiBaseUrl`
- `mobile_app/lib/services/socket_service.dart` → `_socketUrl`
- `resident_app/lib/core/constants.dart` → `apiBaseUrl`, `socketUrl`
- `web-dashboard/.env` → `VITE_API_URL`
- `backend/.env` → base URL reference

---

## Implemented Screens Summary

### Web Dashboard
Includes MDRRMO pages and a barangay account workspace with barangay Command Center, reports, team, assistance, community, hotlines, station entry, analytics, and coordination request.

### Unified Mobile App
Combines barangay screens with the responder client under `mobile_app/`. MDRRMO users get role-specific modules; responder dispatch, GPS, navigation, unit membership, and field documentation remain available.

### Resident Emergency App (7 screens)
`reporting_screen`, `emergency_camera_screen`, `my_reports_screen`, `report_detail_screen`, `evacuation_centers_screen`, `profile_screen`

---

## Real-Time, Offline, and Mapping Requirements

- **Socket.IO rooms**: `commanders`, `professional_units`, `barangay:<id>`, `user:<id>`, `role:<role>`.
- **GPS updates**: Emitted only for On Duty Tanods. Redis entries expire after 30 minutes of inactivity.
- **Offline resilience**: Unsent incident reports and attached media are queued locally in the resident app and synchronized when connection returns. Previously loaded advisories are cached for offline viewing.
- **Maps**: Leaflet + OpenStreetMap on web and Flutter Map for mobile response. Incident markers, evacuation station pins, and GPS-tracked responder positions.
- **Heatmap**: Incident severity/frequency heatmap on MDRRMO Command Center with filter support by severity, status, date, and barangay.
- **Navigation**: OSRM routing engine provides turn-by-turn guidance for dispatched Tanods in `task_detail_screen.dart`.
- **Offline state UI**: Clear connection-required indicators shown when real-time dispatch, GPS tracking, or notifications cannot function without internet connectivity.

---

## Security and Quality Standards

- **Authentication**: `bcryptjs` password hashing; stateless JWT sessions (7-day expiry by default); Supabase Auth for storage access.
- **Authorization**: Role and barangay-jurisdiction enforcement on every backend route using middleware; Supabase RLS policies protect all tables at the database level.
- **Media uploads**: Server-side `multer` validation with strict file type and size limits; stored in Supabase Storage with presigned URLs for secure access.
- **Rate limiting**: `express-rate-limit` applied to `/api/auth/login` to prevent brute-force attacks.
- **Input validation**: `zod` schemas on all API request payloads.
- **Audit trails**: JSONB `verification_history` in dispatcher accreditation; status timestamps on all incident and dispatch records.
- **Data privacy**: Resident contact details are never exposed to unauthorized users; Tanod GPS positions are visible only to commanders.
- **ISO/IEC 25010:2023**: System designed and evaluated against Functional Suitability, Performance Efficiency, Interaction Capability, Reliability, and Security.
- **Mobile UX**: Large action buttons, severity-coded color schemes, confirmation dialogs before critical state transitions, loading and empty states, low-bandwidth-optimized design.

---

## Out of Scope

The following are **explicitly excluded** from NorzAgapay and must not be added:

- Resource inventory counting or relief-goods allocation/distribution tracking
- QR-code shipment tracking or warehouse logistics
- Volunteer certification, management, or skill-matching
- AI/computer-vision damage assessment or image recognition
- Drone integration or automated IoT sensor data streams (water gauge telemetry, seismic sensors)
- National DRRM framework integrations (NDRRMC, OCD-DRRMIS)
- Private emergency service integrations (private hospitals, private security)
- Automated disaster forecasting or predictive risk modeling
- Evacuee self-registration and shelter occupancy tracking

---

## Deliverables

1. ✅ React web dashboard (`web-dashboard/`) — MDRRMO and barangay workspaces, Leaflet maps, and Socket.IO updates
2. ✅ Flutter unified operations app (`mobile_app/`) — barangay operations and MDRRMO role workspaces
3. ✅ Responder workflows integrated under `mobile_app/lib/mdrrmo/` — GPS, routing, dispatch updates, and field documentation
4. ✅ Flutter Resident app (`resident_app/`) — 7 screens, incident reporting, report tracking, offline-capable
5. ✅ Node.js + Express backend (`backend/`) — 21 API route files, Socket.IO server, background weather/river sync, PDF generation
6. ✅ Supabase database migrations (`database/migrations/`) — schema, classification, RLS, indexes, and Realtime setup
7. ✅ Authentication and RBAC — 5-role permission system with JWT, bcrypt, and Supabase RLS
8. ✅ Real-time workflows — incident alerts, dispatch notifications, GPS broadcast, escalation events, evacuation center sync
9. ✅ Maps and navigation — Leaflet/OpenStreetMap incident maps, severity heatmaps, OSRM routing, GPS responder tracking
10. ✅ PDF document service — Dispatcher authorization form generation via PDFKit
11. ✅ Tunnel URL sync utility (`update-tunnel-url.js`) — one-command propagation of ngrok/tunnel URLs across all apps
12. ⬜ API documentation and environment template — pending
13. ⬜ Formal test plan (ISO/IEC 25010:2023) — pending
