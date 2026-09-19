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
| **MDRRMO Web Portal** | React 18, Vite, TypeScript, Leaflet + OpenStreetMap, Socket.IO Client |
| **Barangay Admin App** | Flutter + Dart, Provider, Flutter Map, Socket.IO Client |
| **Tanod Responder App** | Flutter + Dart, Provider, Hive, Flutter Secure Storage, flutter_map, OSRM routing |
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
| `mdrrmo_admin` | Web | Municipality-wide: all incident reports, escalations, dispatch visibility, evacuation centers, advisories, user management, dispatcher accreditation review, weather monitoring |
| `mdrrmo_dispatcher` | Web | Operational monitoring: live incident map, dispatch tracking, responder GPS, evacuation center overview, weather/river-level alerts |
| `barangay_admin` | Mobile (barangay_app) | Jurisdiction-scoped: barangay incident queue, Tanod dispatch, escalation requests to MDRRMO, evacuation center CRUD, co-response visibility, dispatcher accreditation submission |
| `barangay_tanod` | Mobile (mobile_app) | Personal operational: duty status management, dispatch acceptance, GPS navigation, field status updates, incident documentation, own report history |
| `resident` | Mobile (resident_app) | Public + personal: incident submission, own report tracking, evacuation center viewing, safety advisories, emergency camera capture |

**Access rules:**
- Barangay users access only their assigned `barangay_id`; cross-barangay access is blocked.
- Residents access only their own `incident_reports` and public-safe data.
- MDRRMO users access the full municipality scope.
- Barangay offices manage and verify their own Tanod accounts through the accreditation pipeline.

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
| Missions | `MissionsPage.tsx` | Active and historical dispatch assignments, Tanod assignment notes, resolution timelines |
| Respond Units | `RespondUnitsPage.tsx` | Registered professional emergency units, duty and operational status, assignment logs |
| Officers | `OfficersPage.tsx` | MDRRMO officer accounts and barangay assignments |
| Evacuation Centers | `EvacuationCentersPage.tsx` | Municipality-wide shelter list and map, occupancy tracking, availability status (open / limited / full / closed) |
| Inventory | `InventoryPage.tsx` | Equipment and supplies tracking *(in-scope for admin record-keeping)* |
| Resource Requests | `ResourceRequestsPage.tsx` | Field resource request review from units |
| Shipments | `ShipmentsPage.tsx` | Relief shipment logistics oversight |
| Analytics | `AnalyticsPage.tsx` | Incident trends, response-time statistics, severity breakdown charts |
| Weather Monitoring | `WeatherMonitoringV2.tsx` | Real-time weather conditions (Open-Meteo), river station water levels, hydromet alerts |
| Users | `UsersPage.tsx` | MDRRMO user account management |

---

### 2. Barangay Administrator / BDRRMC App (`barangay_app/`)

Flutter mobile application for barangay officials. Connects to the backend via REST and Socket.IO.

**Implemented screens:**

| Screen | File | Description |
|---|---|---|
| Login | `login_screen.dart` | Secure login with barangay-scoped session |
| Home Dashboard | `home_screen.dart` | Summary counters, quick-action navigation, real-time socket connection status |
| Reports Queue | `reports_screen.dart` | Tabbed incident list (Pending / In Progress / Resolved) with real-time push insertion; filters by severity and date |
| Report Detail & Dispatch | `report_detail_screen.dart` | Full incident detail: GPS map view, media gallery, status timeline, Tanod assignment panel, MDRRMO co-response tracking, escalation request, field update log |
| Barangay Incident Reporting | `barangay_report_incident_screen.dart` | Barangay-originated incident report submission with GPS, media, and incident type |
| Evacuation Centers | `evac_centers_screen.dart` | List and map of barangay-managed shelters with occupancy controls |
| Add Evacuation Center | `add_evac_center_screen.dart` | Register a new shelter with location, capacity, and status |
| Team / Duty Status | `team_screen.dart` | Active Tanod roster with real-time duty status and assignment visibility |
| Assistance Requests | `assistance_requests_screen.dart` | View and respond to Tanod field assistance or resource requests |
| Dispatcher Verification | `dispatcher_verification_screen.dart` | Full accreditation workflow: fill Punong Barangay endorsement form, generate and upload prefilled PDF, track verification status (pending_document / under_review / verified / rejected / needs_correction) |

---

### 3. Barangay Tanod / Responder App (`mobile_app/`)

Flutter mobile application for frontline Barangay Tanods. Communicates via REST and Socket.IO with real-time GPS broadcasting through Upstash Redis.

**Implemented screens:**

| Screen | File | Description |
|---|---|---|
| Splash | `splash_screen.dart` | Auth session restoration and routing |
| Login | `login_screen.dart` | Tanod login with JWT session |
| Registration | `register_screen.dart`, `registration_form_screen.dart` | New Tanod account registration with barangay assignment |
| Home / Duty Dashboard | `home_screen.dart` | Duty status toggle (On Duty / Off Duty / Unavailable), real-time dispatch tab, GPS service start/stop, unit availability panel, Socket.IO push alerts |
| Task / Dispatch Detail | `task_detail_screen.dart` | Full dispatch detail: incident info, GPS map, OSRM turn-by-turn navigation, sequential status update buttons (En Route → On Scene → Resolved), photo documentation upload, situation remarks |
| My Reports | `my_reports_screen.dart` | Assigned dispatch history and personal incident submissions |
| Silo Bridge | `silo_bridge_screen.dart` | Multi-agency visibility: live positions of other on-duty units (police, fire, medical) on a shared map |
| Resource Request | `resource_request_screen.dart` | Submit a field resource request to barangay command |
| Profile | `profile_screen.dart` | Tanod profile and account details |

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
| Evacuation Centers | `evacuation_centers_screen.dart` | List and map of open shelters with capacity indicators, search, and navigation link |
| Evacuee Registration | `evacuee_registration_screen.dart` | Self-registration at a shelter (occupancy tracking) |
| Profile | `profile_screen.dart` | Resident profile management |

---

### 5. Backend API & Real-Time Engine (`backend/`)

Node.js + Express.js + TypeScript server. Handles authentication, data access, socket event routing, background jobs, and document generation.

**Running on port:** `3001` (configurable via `PORT` env var).

#### API Routes

| Route Prefix | File | Responsibility |
|---|---|---|
| `/api/auth` | `auth.ts` | Login, registration, JWT refresh, session validation |
| `/api/incident-reports` | `incidentReports.ts` | Resident report CRUD; targeted routing (barangay/mdrrmo/all); MDRRMO co-response status updates; multi-media proof uploads |
| `/api/barangay` | `barangay.ts` | Full barangay operations: report management, Tanod dispatch assignments, team duty status, escalations, assistance requests |
| `/api/incidents` | `incidents.ts` | Municipal-level incident records (MDRRMO scope) |
| `/api/tasks` | `tasks.ts` | Tanod task/dispatch records, status transitions, field documentation |
| `/api/evacuation-centers` | `evacuationCenters.ts` | Shelter CRUD, occupancy updates, availability auto-status |
| `/api/users` | `users.ts` | User management, account status, profile updates |
| `/api/verification` | `verification.ts` | Dispatcher accreditation: document upload, review queue, PDF reference management, status transitions |
| `/api/weather` | `weather.ts` | Weather data fetch (Open-Meteo), forecast storage, river station levels and alerts |
| `/api/matching` | `matching.ts` | Responder availability matching engine queries |
| `/api/respond-units` | `respondUnits.ts` | Professional emergency unit management (PNP, BFP, MDRRMO rescue) |
| `/api/dispatch-units` | `dispatchUnits.ts` | Dispatch unit CRUD and assignment |
| `/api/volunteer-dispatch` | `volunteerDispatch.ts` | Volunteer task dispatch records |
| `/api/officers` | `officers.ts` | MDRRMO officer account data |
| `/api/inventory` | `inventory.ts` | Supplies and equipment inventory management |
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
| `commanders` | `mdrrmo_admin`, `mdrrmo_dispatcher` | `gps:location`, `task:statusChanged`, `incident:new`, `inventory:changed`, `resource:request` |
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
| `inventory:update` | data | Broadcasts inventory change to commanders |
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

### Key Tables

#### `users`
Custom users table (separate from `auth.users`). Fields: `id`, `full_name`, `email`, `phone`, `password_hash`, `role` (enum: `admin`, `commander`, `volunteer_specialist`, `volunteer_general`, `professional_unit`), `unit_type` (enum: `police`, `fire`, `medical`), `status`, `verified`, `latitude`, `longitude`, `last_seen`, `created_at`.

#### `barangays`
`id`, `name`, `municipality` (default: `Norzagaray`), `province` (default: `Bulacan`), `latitude`, `longitude`, `created_at`. Pre-seeded with all Norzagaray barangay coordinates.

#### `barangay_users`
Barangay-scoped user accounts. Fields: `id`, `barangay_id`, `full_name`, `email`, `phone`, `password_hash`, `role` (enum: `barangay_admin`, `barangay_tanod`), `status`, `is_verified`, `verification_status`, `verification_ref_no`, `duty_status`, `last_seen`, timestamps.

#### `incident_reports`
Resident-submitted reports. Fields: `id`, `reporter_id`, `barangay_id`, `incident_type`, `severity`, `description`, `latitude`, `longitude`, `address`, `status`, `media_url`, `proof_urls` (array), `proof_types` (array), `responder_media` (JSONB), `send_to`, `mdrrmo_response_status`, `mdrrmo_responded_at`, `mdrrmo_responded_by`, `mdrrmo_responder_name`, `mdrrmo_response_notes`, timestamps.

#### `incidents`
Municipal-level incident records (created/managed by MDRRMO). Separate from `incident_reports`. Fields: `id`, `title`, `type`, `severity`, `latitude`, `longitude`, `address`, `status`, `reported_by`, `assigned_by`, `resolved_at`, timestamps.

#### `tasks`
Tanod dispatch assignments. Fields: `id`, `incident_id`, `assigned_to`, `assigned_by`, `status` (enum: `pending`, `accepted`, `in_progress`, `completed`, `cancelled`), `type` (enum: `specialist`, `general_labor`), `notes`, `accepted_at`, `completed_at`, timestamps.

#### `evacuation_centers`
`id`, `barangay_id`, `name`, `address`, `latitude`, `longitude`, `max_capacity`, `current_occupancy`, `current_families`, `status` (enum: `open`, `limited`, `full`, `closed`), `updated_by`, `last_updated_at`, timestamps.

#### `barangay_dispatcher_verifications`
`id`, `user_id`, `barangay_id`, `full_name`, `email`, `password_hash`, `phone`, `position_designation`, `punong_barangay_name`, `punong_barangay_position`, `reference_no` (unique), `document_url`, `status` (enum: `pending_document`, `under_review`, `verified`, `rejected`, `needs_correction`), `rejection_reason`, `submitted_at`, `reviewed_at`, `reviewed_by`, `verification_history` (JSONB audit trail), timestamps.

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
`certifications`, `inventory`, `resource_requests`, `relief_shipments`, `blocked_routes`, `dispatch_units`, `respond_units`, `officers`, `notifications`, `hospitals`, `schools`, `municipality_info`.

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
2. Barangay admin opens the report detail screen, reviews GPS location on map, assesses severity, and inspects attached media.
3. Admin selects an On-Duty verified Tanod from the team panel and creates a dispatch via the backend.
4. Dispatch alert (`task:new`) is emitted to the Tanod's personal socket room.
5. Tanod receives an audible SnackBar alert on `home_screen.dart`, reviews the dispatch in the Dispatches tab, and accepts it.
6. Tanod navigates to the incident using OSRM turn-by-turn routing and updates operational status: **En Route → On Scene → Resolved**.
7. At resolution, the Tanod uploads photo proof and submits closing remarks through `task_detail_screen.dart`.

### MDRRMO Co-Response
1. For high-severity incidents (e.g., fires, medical emergencies), the barangay admin can request MDRRMO direct co-response in addition to dispatching a local Tanod.
2. MDRRMO dispatcher sees the co-response request on the Command Center.
3. MDRRMO responder updates `mdrrmo_response_status`, `mdrrmo_responded_at`, and `mdrrmo_response_notes` via API.
4. Barangay app reflects the MDRRMO co-response status in the report detail view.

### MDRRMO Escalation Pipeline
1. Barangay admin initiates an escalation from the report detail screen when local resources are insufficient.
2. Escalation record is created with status `requested` and reason notes.
3. MDRRMO command receives a notification and sees the escalation in the Command Center queue.
4. MDRRMO reviews incident details and field updates, then approves or rejects with a recorded decision note.
5. The barangay immediately receives the escalation decision notification.
6. Full escalation history is retained for audit and after-action review.

### Evacuation Center Monitoring
1. Barangay admin adds or updates shelters via `add_evac_center_screen.dart` and `evac_centers_screen.dart`.
2. As evacuees arrive, occupancy and family counts are updated in real time. The system automatically sets status to `full` when `current_occupancy >= max_capacity`.
3. MDRRMO Command Center displays all municipal shelters on the map and list with real-time availability.
4. Residents browse open shelters with live capacity indicators in `evacuation_centers_screen.dart` and can self-register as evacuees.

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

Each Flutter app maintains its own constants file. To update all three simultaneously when using a tunnel (e.g., ngrok), run:

```bash
node update-tunnel-url.js https://your-tunnel-url.ngrok-free.app
```

This script updates:
- `mobile_app/lib/core/constants.dart` → `apiBaseUrl`
- `barangay_app/lib/services/api_service.dart` → `baseUrl`
- `barangay_app/lib/services/auth_service.dart` → `_apiBaseUrl`
- `barangay_app/lib/services/socket_service.dart` → `_socketUrl`
- `resident_app/lib/core/constants.dart` → `apiBaseUrl`, `socketUrl`
- `web-dashboard/.env` → `VITE_API_URL`
- `backend/.env` → base URL reference

---

## Implemented Screens Summary

### MDRRMO Web Portal (14 pages)
`LoginPage`, `CommandCenter`, `ReportsPage`, `VerificationPage`, `MissionsPage`, `RespondUnitsPage`, `OfficersPage`, `EvacuationCentersPage`, `InventoryPage`, `ResourceRequestsPage`, `ShipmentsPage`, `AnalyticsPage`, `WeatherMonitoringV2`, `UsersPage`

### Barangay Admin App (10 screens)
`login_screen`, `home_screen`, `reports_screen`, `report_detail_screen`, `barangay_report_incident_screen`, `evac_centers_screen`, `add_evac_center_screen`, `team_screen`, `assistance_requests_screen`, `dispatcher_verification_screen`

### Tanod Responder App (11 screens)
`splash_screen`, `login_screen`, `register_screen`, `registration_form_screen`, `home_screen`, `task_detail_screen`, `my_reports_screen`, `silo_bridge_screen`, `resource_request_screen`, `reporting_screen`, `profile_screen`

### Resident Emergency App (7 screens)
`reporting_screen`, `emergency_camera_screen`, `my_reports_screen`, `report_detail_screen`, `evacuation_centers_screen`, `evacuee_registration_screen`, `profile_screen`

---

## Real-Time, Offline, and Mapping Requirements

- **Socket.IO rooms**: `commanders`, `professional_units`, `barangay:<id>`, `user:<id>`, `role:<role>`.
- **GPS updates**: Emitted only for On Duty Tanods. Redis entries expire after 30 minutes of inactivity.
- **Offline resilience**: Unsent incident reports and attached media are queued locally in the resident app and synchronized when connection returns. Previously loaded advisories are cached for offline viewing.
- **Maps**: Leaflet + OpenStreetMap throughout. Severity-based incident markers, barangay boundary overlays (when GeoJSON available), evacuation center pins by availability status, and GPS-tracked responder positions.
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
- Family registration records within evacuation centers (occupancy count only)

---

## Deliverables

1. ✅ React web portal (`web-dashboard/`) — 14 pages, Leaflet map, heatmap, Socket.IO real-time updates
2. ✅ Flutter Barangay Admin app (`barangay_app/`) — 10 screens, dispatch pipeline, PDF accreditation workflow
3. ✅ Flutter Tanod Responder app (`mobile_app/`) — 11 screens, GPS tracking, OSRM navigation, real-time dispatch alerts
4. ✅ Flutter Resident app (`resident_app/`) — 7 screens, incident reporting, report tracking, offline-capable
5. ✅ Node.js + Express backend (`backend/`) — 21 API route files, Socket.IO server, background weather/river sync, PDF generation
6. ✅ Supabase database migrations (`database/migrations/`) — 7 migration files with full schema, RLS, indexes, and Realtime setup
7. ✅ Authentication and RBAC — 5-role permission system with JWT, bcrypt, and Supabase RLS
8. ✅ Real-time workflows — incident alerts, dispatch notifications, GPS broadcast, escalation events, evacuation center sync
9. ✅ Maps and navigation — Leaflet/OpenStreetMap incident maps, severity heatmaps, OSRM routing, GPS responder tracking
10. ✅ PDF document service — Dispatcher authorization form generation via PDFKit
11. ✅ Tunnel URL sync utility (`update-tunnel-url.js`) — one-command propagation of ngrok/tunnel URLs across all apps
12. ⬜ API documentation and environment template — pending
13. ⬜ Formal test plan (ISO/IEC 25010:2023) — pending
