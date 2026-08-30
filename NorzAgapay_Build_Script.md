# NorzAgapay — Full System Build Script
### Prompt for AI Editor (Antigravity)

---

## CONTEXT & GOAL

You are building **NorzAgapay** — a full-stack, real-time crisis management and volunteer-driven relief logistics system for MDRRMO (Municipal Disaster Risk Reduction and Management Office) in the Philippines.

This is a thesis-grade production system. Build it completely, following every specification below. Do not skip any module, screen, or feature. Every user role must be fully functional.

---

## TECH STACK

### Mobile App (for Volunteers & Emergency Responders)
- **Framework:** Flutter (preferred) or React Native
- **Key capabilities:** GPS tracking (real-time), push notifications for task alerts, offline-first architecture (cache critical data locally for use in areas with no signal), QR code scanning

### Web Dashboard (for Commanders & Administrators)
- **Framework:** React.js (Vite + TypeScript)
- **Key capabilities:** Real-time data visualization, interactive map (Leaflet with CartoDB Dark Matter), inventory management UI, live status monitoring

### Backend / API Layer
- **Architecture:** Node.js Express API
- **Auth:** JWT-based, multi-role (Admin, Commander, Volunteer-Specialist, Volunteer-General, Professional Unit)
- **Matching Engine:** Custom algorithm (see logic below)
- **GIS & Routing:** Leaflet / OpenStreetMap
- **Real-time:** Supabase Realtime + Socket.io

### Data Layer
- **Primary DB:** Supabase (PostgreSQL) — user profiles, certifications, incidents, tasks, logs
- **GPS Cache:** Upstash Redis (serverless) — high-frequency location pings
- **File Storage:** Supabase Storage (bucket: `norzagapay-files`) — IDs, certification documents, photos

---

## DATABASE SCHEMA

Create the following tables in Supabase:

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| full_name | text | |
| email | text | unique |
| phone | varchar(15) | |
| role | enum | `admin`, `commander`, `volunteer_specialist`, `volunteer_general`, `professional_unit` |
| unit_type | enum | `police`, `fire`, `medical`, `null` — for professional units only |
| status | enum | `active`, `inactive`, `pending_verification` |
| verified | boolean | default false for specialists |
| latitude | float | last known GPS coordinate |
| longitude | float | last known GPS coordinate |
| last_seen | timestamp | |
| created_at | timestamp | |

### `certifications`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid (FK → users) | |
| cert_type | text | e.g. "PRC License", "Red Cross EMT" |
| cert_number | text | |
| file_url | text | Supabase Storage URL |
| verified | boolean | default false |
| verified_by | uuid (FK → users) | admin who approved |
| verified_at | timestamp | |

### `incidents`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| title | text | |
| type | enum | `flash_flood`, `fire`, `earthquake`, `medical_emergency`, `typhoon`, `other` |
| severity | enum | `low`, `moderate`, `high`, `critical` |
| latitude | float | |
| longitude | float | |
| address | text | |
| status | enum | `open`, `in_progress`, `resolved` |
| reported_by | uuid (FK → users) | |
| created_at | timestamp | |
| resolved_at | timestamp | |

### `tasks`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| incident_id | uuid (FK → incidents) | |
| title | text | |
| description | text | |
| task_type | enum | `specialist`, `general_labor` |
| required_skill | text | nullable — e.g. "EMT", "Rescue" |
| assigned_to | uuid (FK → users) | |
| status | enum | `pending`, `accepted`, `in_progress`, `completed`, `cancelled` |
| proof_photo_url | text | Supabase Storage URL |
| created_at | timestamp | |
| completed_at | timestamp | |

### `inventory`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| item_name | text | |
| quantity | integer | |
| unit | text | e.g. "packs", "liters", "sacks" |
| location | text | warehouse/zone |
| incident_id | uuid (FK → incidents) | nullable — if assigned to a zone |
| donated_by | text | |
| created_at | timestamp | |
| updated_at | timestamp | |

### `relief_shipments`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| inventory_id | uuid (FK → inventory) | |
| quantity_sent | integer | |
| driver_user_id | uuid (FK → users) | |
| origin | text | |
| destination | text | |
| qr_code | text | unique tracking code |
| status | enum | `loading`, `in_transit`, `delivered` |
| created_at | timestamp | |
| delivered_at | timestamp | |

### `blocked_routes`
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| reported_by | uuid (FK → users) | |
| latitude | float | |
| longitude | float | |
| description | text | |
| active | boolean | default true |
| created_at | timestamp | |

---

## USER ROLES & FULL FLOWS

### ROLE 1 — MDRRMO Admin / Ground Commander

**Web Dashboard screens to build:**

1. **Login Screen** — Email + password, role-based redirect after auth

2. **Main Dashboard (Command View)**
   - Full-screen Leaflet map as base layer
   - Live animated dots for every active volunteer and professional unit (color-coded by role)
   - Heatmap overlay toggle: shows concentration of responders vs. active incidents — highlights zones with resource gaps in red
   - Sidebar: list of all open incidents with severity badges
   - Top stats bar: total active volunteers, open incidents, relief items in transit

3. **Incident Management Screen**
   - Create new incident: form with type, severity, address (with geocoding), description
   - View incident detail: assigned personnel, task list, inventory allocated, live map of the incident zone
   - Manual Override: drag-reassign tasks to different volunteers on the map

4. **Volunteer Verification Screen**
   - Pending verifications queue: shows uploaded ID/certification documents
   - Preview document (PDF/image viewer inline)
   - Approve / Reject buttons with optional rejection note
   - Approved specialists move to `verified: true`
   - General Labor volunteers are auto-approved on registration — do NOT appear in this queue

5. **Inventory Management Screen**
   - Add new donation: item name, quantity, unit, donor name
   - Table view of all inventory with filter by location/incident zone
   - Assign inventory to a specific incident zone
   - QR code generator for relief packs (generates unique code per shipment)
   - Shipment tracker: live GPS of truck driver + shipment status

6. **Reports Screen**
   - Resource utilization per incident (charts)
   - Volunteer deployment history
   - Export to PDF / CSV

---

### ROLE 2 — Volunteer: Certified Specialist

**Mobile App screens to build:**

1. **Onboarding / Registration Screen**
   - Full name, email, phone, password
   - Upload government ID (camera or file picker)
   - Upload certifications (PRC License, Red Cross cert, etc.) — allow multiple uploads
   - Role auto-set to `volunteer_specialist`, status set to `pending_verification`
   - Show "Your account is under review" holding screen after submission

2. **Home / Dashboard Screen**
   - Status toggle: Active / Inactive (prominent toggle, top of screen)
   - If `pending_verification`: show banner "Restricted to General Labor tasks until certified"
   - Nearby incidents list (within 10km) with severity indicators

3. **Task Notification (Push Alert)**
   - Receive push notification when Matching Engine assigns a task
   - Notification shows: incident type, distance, required skill, urgency level

4. Task Detail Screen
   - Incident description, address, map preview
   - Accept / Decline buttons
   - On Accept: open full GPS navigation (OpenStreetMap/Leaflet)
   - "I Have Arrived" button — updates task status to `in_progress`
   - "Task Complete" button — triggers photo upload requirement before marking complete

5. **Task History Screen**
   - Past completed tasks with timestamps and proof photos

6. **Profile Screen**
   - View/edit personal info
   - Certification upgrade path: upload new certifications for specialist status review

---

### ROLE 3 — Volunteer: General Labor

**Mobile App screens to build:**

1. **Registration Screen**
   - Full name, email, phone, password
   - Upload government-issued ID only (no certifications)
   - Account auto-approved instantly on submission
   - Role set to `volunteer_general`, `verified: true`, status `active`
   - Redirect immediately to Home screen

2. **Home / Dashboard Screen**
   - Same layout as Specialist Home
   - Only shows General Labor task types (no specialist tasks visible)

3. **Task Notification & Detail Screen**
   - Same UX as Specialist, but task types are restricted to:
     - Carrying and distributing relief goods
     - Setting up evacuation tents
     - Crowd control and guidance
     - Basic sanitation and clean-up
     - Runner/messenger duties within evacuation zones

4. **GPS Navigation & Task Completion**
   - Same flow as Specialist: navigate → arrive → photo proof → complete

5. **Upgrade Path Screen**
   - Button: "Apply for Specialist Status"
   - Upload certifications — triggers Admin verification queue

---

### ROLE 4 — Professional Emergency Unit (Police / Fire / Medical)

**Mobile App screens to build:**

1. **Login Screen** — High-priority credentials, unit type selection

2. **Dispatch Alerts Screen**
   - Real-time high-priority task alerts
   - Shows fastest route (OSRM), live traffic overlay
   - Accept dispatch button

3. **Silo-Bridge Map View**
   - Live map showing locations of ALL other professional units (police, fire, medical) simultaneously
   - Color-coded: police = blue, fire = red, medical = green
   - This breaks departmental information silos

4. **Resource Request Screen**
   - Request more volunteers (specify: specialist or general labor, with skill requirement)
   - Request specific relief goods from inventory
   - Request gets routed to Commander dashboard instantly

5. **Task Completion** — same photo proof flow as volunteers

---

## CORE LOGIC: MATCHING ENGINE

This is the heart of the system. Implement as a backend microservice.

### Trigger
Fires when a new incident is created or when a task is manually added to an incident.

### Algorithm Steps

```
FUNCTION matchRespondersToIncident(incident):

  1. Classify incident:
     - Flash Flood → required_skill = "Water Rescue" or "EMT"
     - Fire → required_skill = "Firefighting" or "Medical"
     - Medical Emergency → required_skill = "EMT" or "Paramedic"
     - Other → general_labor tasks only

  2. Scan for Professional Units:
     - Query users WHERE role = 'professional_unit' AND status = 'active'
     - Filter by unit_type matching incident type
     - Sort by distance (Haversine formula) from incident coordinates
     - Dispatch top 3 closest units

  3. Scan for Certified Specialists (within 5km radius):
     - Query users WHERE role = 'volunteer_specialist'
       AND verified = true
       AND status = 'active'
     - JOIN certifications WHERE cert_type matches required_skill
     - Filter by distance ≤ 5km
     - Sort by distance ASC
     - Send Task Request push notification to top 5 matches

  4. Scan for General Labor Volunteers (within 5km radius):
     - Query users WHERE role = 'volunteer_general'
       AND status = 'active'
       AND distance ≤ 5km
     - Sort by distance ASC
     - Assign non-specialized tasks to top 10 matches

  5. Dynamic Routing:
     - For each dispatched unit/volunteer, call OSRM (Open Source Routing Machine) API
     - Pass current GPS coordinates → incident coordinates
     - Check blocked_routes table; if a route passes near a blocked point, request alternative route
     - Send fastest route to mobile app

  6. Logistics Trigger:
     - If incident type requires relief goods (flood, typhoon):
       - Flag inventory items (food packs, water) as "mobilization needed"
       - Create relief_shipment record
       - Notify Commander dashboard

  RETURN: list of assigned units, volunteers, and routes
```

---

## REAL-TIME FEATURES

Implement using Supabase Realtime + Socket.io:

- **GPS Broadcast:** Mobile app pings GPS coordinates every 10 seconds when status = `active` → stored in Upstash Redis → streamed to Commander dashboard map in real-time
- **Task Status Updates:** Any task status change (`accepted`, `arrived`, `completed`) triggers a real-time event that updates the Commander dashboard instantly
- **Incident Feed:** New incidents broadcast to all active professional unit apps immediately
- **Inventory Changes:** Any inventory add/assign action updates the dashboard inventory table in real-time

---

## OFFLINE-FIRST (MOBILE)

Implement for Flutter using `hive` or `drift` local storage:

- Cache the last known task assignment locally
- Cache the last rendered map tiles for the user's current region
- Allow "Task Complete" + photo submission to queue locally if offline — auto-sync when connection restores
- Show a clear "Offline Mode" banner when the device has no connectivity

---

## FILE UPLOAD FLOW (Supabase Storage)

For certification documents, ID photos, and task completion proof photos:

1. Mobile app or web captures/selects file
2. App calls backend API: `POST /api/upload/presigned-url` with file type and category
3. Backend generates a signed upload URL for Supabase Storage (valid 5 minutes)
4. Client uploads directly to Supabase using the signed URL
5. On success, client confirms to backend: `POST /api/upload/confirm` with the object path
6. Backend stores the public URL in the relevant table (certifications.file_url, tasks.proof_photo_url, etc.)

---

## QR CODE TRACKING (RELIEF GOODS)

1. Admin generates QR code for a shipment from the Inventory Management screen
2. QR code encodes: `relief_shipment.id` + item summary
3. Field staff scans QR code on the mobile app when loading goods onto truck
4. Truck driver's GPS is tracked live (same mechanism as volunteer GPS)
5. On arrival at evacuation center, staff scans QR again → shipment status → `delivered`
6. Commander dashboard shows shipment as confirmed received

---

## UI/UX REQUIREMENTS

### Color System
- Primary: `#1B4F72` (deep navy — authority, trust)
- Accent: `#E74C3C` (urgent red — critical alerts)
- Success: `#27AE60` (green — resolved/complete)
- Warning: `#F39C12` (amber — moderate/in-progress)
- Neutral: `#F4F6F7` (light gray — backgrounds)

### Map Dot Color Coding (Commander Dashboard)
- 🔵 Blue dots = Police units
- 🔴 Red dots = Fire units
- 🟢 Green dots = Medical units
- 🟡 Yellow dots = Certified Specialist volunteers
- ⚪ White dots = General Labor volunteers
- 🟠 Orange pulsing circle = Active incident location

### Severity Badge Colors
- Critical: `#C0392B` red
- High: `#E67E22` orange
- Moderate: `#F1C40F` yellow
- Low: `#2ECC71` green

### Mobile UX Principles
- All primary actions must be reachable with one thumb (bottom of screen)
- Task Accept / Decline buttons must be large (min 56px height)
- GPS navigation must launch in full screen
- Offline mode banner must be persistent and clearly visible

---

## SECURITY REQUIREMENTS

- All API endpoints require JWT authentication
- Role-based access control (RBAC): Admin-only endpoints reject all other roles with 403
- File uploads: validate file type server-side (allow only: jpg, png, pdf); reject all others
- Certification verification: only users with `role = 'admin'` can set `verified = true`
- General Labor auto-approval: handled only by backend on registration — never client-controlled
- Rate limiting on login endpoint: max 5 attempts per IP per 10 minutes
- All GPS data stored in Redis expires after 30 minutes of inactivity

---

## SCREENS SUMMARY (FULL LIST)

### Web Dashboard (React.js/Vue.js)
1. Login
2. Main Command Dashboard (Map + Live Feeds)
3. Incident List & Detail
4. Create/Edit Incident
5. Volunteer Verification Queue
6. Inventory Management
7. Shipment Tracker
8. Reports & Analytics
9. User Management (Admin only)

### Mobile App (Flutter/React Native) — Volunteer & Professional Unit
1. Splash / Onboarding
2. Registration — Specialist
3. Registration — General Labor
4. Registration — Professional Unit
5. Login
6. Pending Verification Holding Screen
7. Home Dashboard
8. Task Notification (push)
9. Task Detail + Accept/Decline
10. GPS Navigation (Leaflet/OSRM)
11. Task Completion + Photo Upload
12. Task History
13. Profile + Certification Upgrade
14. Silo-Bridge Map (Professional Units only)
15. Resource Request (Professional Units only)
16. Offline Mode State (applied globally)

---

## DELIVERABLES EXPECTED

1. Full working codebase for both web dashboard and mobile app
2. Supabase database migration SQL files
3. All backend microservices (Auth, Matching Engine, GIS/Routing, Inventory, Real-time)
4. Supabase Storage upload integration
5. Upstash Redis GPS caching integration
6. Leaflet map with live dots, heatmap overlay, and OSRM routing
7. Push notification setup (FCM for Android, APNs for iOS)
8. QR code generation and scanning
9. Offline-first mobile caching
10. README with setup instructions for each service

---

## IMPORTANT NOTES FOR THE AI EDITOR

- This is a **thesis system** — it must be complete, not a prototype. Every screen and every feature listed above must be implemented.
- The **Matching Engine** is the academic core of this system. Implement the algorithm in full detail, not as a placeholder.
- The **two-tier volunteer system** (Specialist vs. General Labor) is a key academic contribution — the distinction must be enforced at every level: registration, task assignment, task visibility, and data model.
- The **Silo-Bridge** feature (professional units seeing each other's locations) must be implemented — it is a named feature in the research.
- The **heatmap** on the Commander dashboard showing responder concentration vs. incident zones is required.
- Use real Leaflet + OpenStreetMap integration (not a placeholder map).
- Do not use mock data in final screens — all data must flow from Supabase.
- Apply the offline-first architecture seriously — this system is designed for use in disaster zones with unreliable connectivity.
