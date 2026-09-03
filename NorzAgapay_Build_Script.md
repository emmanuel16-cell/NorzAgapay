# NorzAgapay — Full System Build Script

## Project context

Build **NorzAgapay**, an integrated web and mobile-based Emergency Response and Crisis Management Coordination System for Norzagaray, Bulacan. It connects the Municipal Disaster Risk Reduction and Management Office (MDRRMO), Barangay Local Government Units, Barangay Tanods, and residents.

The system supports real-time incident reporting, incident assessment and dispatch, responder duty-status tracking, GPS-based incident mapping and navigation, barangay-to-MDRRMO escalation, evacuation-center monitoring, and localized safety advisories.

### Scope exclusions

Do **not** build resource inventory, relief-goods allocation or distribution, shipment tracking, QR logistics, volunteer management or certification, volunteer task matching, AI or computer-vision functions, drone integration, IoT sensors, national DRRM integrations, or private emergency-service integrations. Evacuation-center monitoring is included, but it covers only location, capacity, occupancy, and availability—not relief goods.

## Technology stack

- **MDRRMO web portal:** React, Vite, TypeScript, Leaflet, OpenStreetMap.
- **Mobile application:** Flutter and Dart for Barangay officials, Barangay Tanods, and residents.
- **Backend:** Node.js, Express.js, TypeScript, Socket.IO.
- **Services:** Supabase PostgreSQL, Auth, Realtime, and Storage; Upstash Redis for short-lived high-frequency responder-location updates; OSRM for routing.

## Roles and authorization

| Role | Platform | Permissions |
|---|---|---|
| `mdrrmo_admin` | Web | Municipality-wide monitoring, escalation approval, advisories, responder and evacuation-center oversight |
| `mdrrmo_dispatcher` | Web | Incident and dispatch monitoring, escalation processing, advisories as authorized |
| `barangay_admin` | Mobile | Barangay assessment, Tanod dispatch, escalation requests, evacuation-center updates |
| `barangay_tanod` | Mobile | Duty-status updates, dispatch reception, GPS navigation, field updates, incident documentation |
| `resident` | Mobile | Report submission, own-report tracking, evacuation-center viewing, safety-advisory viewing |

Barangay administrative offices verify and manage Tanod accounts. Barangay users can access only their jurisdiction. Residents can access only their own reports and public information. MDRRMO users can access municipality-wide information.

## Database schema

Create Supabase migrations, foreign keys, indexes, timestamps, audit logs, and Row Level Security policies for all tables below.

### `barangays`

`id` uuid PK; `name` text; `boundary_geojson` jsonb nullable; `is_active` boolean.

### `profiles`

`id` uuid PK/FK to `auth.users`; `full_name`; `email` unique; `phone`; `role` enum (`mdrrmo_admin`, `mdrrmo_dispatcher`, `barangay_admin`, `barangay_tanod`, `resident`); `barangay_id` FK nullable for MDRRMO; `account_status` enum (`active`, `inactive`, `pending`, `suspended`); `is_verified`; `last_known_latitude`; `last_known_longitude`; `last_seen_at`; timestamps.

### `incidents`

`id` uuid PK; `reference_number` unique; `title`; `description`; `incident_type` enum (`flood`, `fire`, `medical_emergency`, `landslide`, `earthquake`, `typhoon`, `other`); `severity` enum (`low`, `moderate`, `high`, `critical`); `status` enum (`pending`, `assessed`, `dispatched`, `responding`, `resolved`, `cancelled`); `barangay_id` FK; `latitude`; `longitude`; `address` nullable; `reported_by` FK; `assigned_by` FK nullable; `resolved_at` nullable; timestamps.

### `incident_media`

`id` uuid PK; `incident_id` FK; `uploaded_by` FK; `file_path`; `media_type` enum (`image`, `video`, `document`); `caption` nullable; timestamps.

### `incident_updates`

`id` uuid PK; `incident_id` FK; `updated_by` FK; `status` enum (`pending`, `assessed`, `dispatched`, `en_route`, `on_scene`, `responding`, `resolved`, `cancelled`); `notes` nullable; `latitude` nullable; `longitude` nullable; timestamps.

### `responder_duty_status`

`id` uuid PK; `responder_id` FK to a Tanod profile; `status` enum (`off_duty`, `on_duty`, `assigned`, `en_route`, `on_scene`, `unavailable`); `updated_at`.

### `dispatches`

`id` uuid PK; `incident_id` FK; `responder_id` FK; `assigned_by` FK; `status` enum (`assigned`, `accepted`, `en_route`, `on_scene`, `completed`, `declined`, `cancelled`); `assignment_note` nullable; `accepted_at` nullable; `completed_at` nullable; timestamps.

### `escalations`

`id` uuid PK; `incident_id` FK; `requested_by` FK; `reason`; `status` enum (`requested`, `under_review`, `approved`, `rejected`, `closed`); `reviewed_by` FK nullable; `review_note` nullable; `reviewed_at` nullable; timestamps.

### `evacuation_centers`

`id` uuid PK; `barangay_id` FK; `name`; `address`; `latitude`; `longitude`; `maximum_capacity` integer; `current_occupancy` integer; `availability_status` enum (`open`, `limited`, `full`, `closed`); `updated_by` FK; `last_updated_at`; timestamps. Automatically show `full` when occupancy reaches capacity.

### `announcements`

`id` uuid PK; `title`; `body`; `priority` enum (`normal`, `important`, `emergency`); `target_barangay_id` FK nullable for municipality-wide broadcasts; `published_by` FK; `published_at`; `expires_at` nullable; timestamps.

### `notifications`

`id` uuid PK; `recipient_id` FK; `type` enum (`incident`, `dispatch`, `escalation`, `announcement`, `evacuation_center`); `title`; `message`; `reference_id` nullable; `read_at` nullable; timestamps.

## Required workflows

### Resident reporting

Residents submit emergency or community reports with incident type, description, GPS coordinates, and optional photo/video media. Route the report to the resident’s barangay as `pending` and notify authorized Barangay Administrators in real time. Residents can track their own reports using public-safe status updates. Queue unsent reports and attachments locally if offline, then synchronize them when a connection returns.

### Barangay assessment and dispatch

Barangay Administrators view only reports from their jurisdiction. They assess severity, record notes, select an on-duty verified Tanod, and create a dispatch. Notify the Tanod immediately. The Tanod can accept or decline, update status to **En Route**, **On Scene**, and **Resolved**, submit notes and media, and navigate to the incident using GPS.

### MDRRMO escalation pipeline

A Barangay Administrator creates an escalation when local response capacity is insufficient. MDRRMO users receive a notification, review incident details and field updates, then approve or reject the escalation with a recorded decision note. Notify the requesting barangay immediately and retain the escalation history.

### Evacuation-center monitoring

Authorized Barangay users add or update a center’s name, location, capacity, occupancy, and availability. MDRRMO users view municipality-wide center data through the web portal and map. Residents view available center locations, capacity status, and occupancy. Do not include family registration, relief allocation, or distribution tracking.

### Localized safety advisories

MDRRMO users create municipal-wide or barangay-targeted advisories with priority and expiration. Deliver them through push notifications and the resident app. Cache previously loaded advisories for offline viewing only.

## Required screens

### MDRRMO web portal

1. Secure login and role-based routing.
2. Command Center with live incident map, heatmap, counters, escalation queue, dispatched Tanods, duty status, and evacuation-center occupancy summary.
3. Incident Management with filters, details, media, updates, status history, and dispatch visibility.
4. Escalations with review, approval/rejection, and decision notes.
5. Responder Monitoring with duty/operational status and authorized live locations.
6. Evacuation Centers with map, capacity, occupancy, availability, and last update.
7. Safety Advisories with create, target, publish, expire, and delivery status.
8. User Management for MDRRMO accounts and barangay assignments; do not add volunteer verification.

### Resident mobile application

1. Home dashboard.
2. Emergency Incident report with media and GPS.
3. Community Incident report with media and GPS.
4. My Submitted Reports with public-safe resolution timeline.
5. Evacuation Centers map and list.
6. Safety Advisories.

### Barangay Administrator / BDRRMC mobile portal

1. Barangay incident queue.
2. Incident assessment and severity screen.
3. Tanod selection and dispatch screen.
4. Escalation request screen.
5. Evacuation-center monitoring and update screen.
6. Barangay responder duty-status screen.

### Barangay Tanod mobile application

1. Duty-status controls: Off Duty, On Duty, Assigned, En Route, On Scene, Unavailable.
2. Dispatch alert and accept/decline action.
3. GPS navigation to the assigned incident.
4. Incident update and documentation screen.
5. Assigned-incident history.
6. Authorized evacuation-center occupancy update screen.

## Real-time, offline, and mapping requirements

- Notify Barangay Administrators of new reports; notify Tanods of dispatches; notify MDRRMO and barangays of escalations and decisions; notify intended audiences of announcements.
- Synchronize incident, dispatch, duty-status, escalation, evacuation-center, and advisory updates in real time for authorized users.
- Send GPS updates only for on-duty or dispatched Tanods. Redis entries expire after 30 minutes of inactivity.
- Use Leaflet and OpenStreetMap, not placeholder maps. Display severity-based incident markers, barangay boundaries when available, evacuation centers by availability, and authorized responder locations.
- Provide incident heatmap filtering by severity, status, date, and barangay.
- Use OSRM to provide route guidance for a dispatched Tanod.
- Show a clear connection-required state for real-time dispatch, GPS tracking, and instant notifications while offline.

## Security and quality

- Use Supabase Auth, JWT validation, backend authorization, and RLS for all protected data.
- Enforce role and barangay-jurisdiction access on every endpoint and query.
- Validate media uploads server-side with strict type and size limits.
- Keep audit logs for incident changes, dispatch actions, escalation decisions, evacuation-center updates, and announcements.
- Do not expose residents’ contact details or responder locations to unauthorized users.
- Design and test for ISO/IEC 25010:2023: Functional Suitability, Performance Efficiency, Interaction Capability, Reliability, and Security.
- Use large mobile action buttons, clear severity/status colors, confirmation before critical actions, loading and empty states, and low-bandwidth-friendly design.

## Deliverables

1. React web portal, Flutter mobile application, Node.js API, and Supabase migration files.
2. Authentication, RBAC, and RLS policies.
3. Real-time incident, dispatch, duty-status, escalation, evacuation-center, and advisory workflows.
4. Leaflet/OpenStreetMap maps, heatmaps, and OSRM navigation.
5. Push notifications and offline caching for unsent reports and loaded advisories.
6. Supabase Storage for report media and responder documentation.
7. API documentation, environment template, setup guide, and test plan.

Do not use mock data in final workflows or add features outside this scope.
