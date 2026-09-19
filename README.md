# NorzAgapay (An Integrated Web and Mobile-Based Emergency Response and Crisis Management Coordination System)

[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Flutter](https://img.shields.io/badge/Flutter-3.x-02569B?logo=flutter&logoColor=white)](https://flutter.dev/)
[![Dart](https://img.shields.io/badge/Dart-3.x-0175C2?logo=dart&logoColor=white)](https://dart.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-Realtime-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![Upstash Redis](https://img.shields.io/badge/Upstash-Redis-00E599?logo=redis&logoColor=white)](https://upstash.com/)

**NorzAgapay** is a full-stack, real-time crisis management, emergency response, and multi-agency coordination system developed for the **Municipal Disaster Risk Reduction and Management Office (MDRRMO)** of Norzagaray, Bulacan, in active coordination with **Barangay Local Government Units (BDRRMC)**, **Barangay Tanods (First Responders)**, and **local residents**.

The platform replaces fragmented phone calls, physical logbooks, and ad-hoc communication with a synchronized digital pipeline featuring real-time incident reporting, GPS mapping, responder duty tracking, automated routing, inter-agency escalation, evacuation center occupancy monitoring, and public safety advisories.

---

## 📌 System Architecture & Ecosystem

NorzAgapay is composed of five tightly integrated subsystems designed for specific operational roles:

```
                                  ┌───────────────────────────────┐
                                  │      MDRRMO Command Center    │
                                  │   (React + Vite Web Portal)   │
                                  └───────────────┬───────────────┘
                                                  │
                                                  │ REST / WebSockets
                                                  ▼
┌───────────────────────┐         ┌───────────────────────────────┐         ┌────────────────────────┐
│     Resident App      │ ◄─────► │     NorzAgapay Backend API    │ ◄─────► │      Barangay App      │
│  (Flutter Mobile App) │  HTTPS  │   (Node.js + Express + TS)    │  HTTPS  │  (Flutter Mobile App)  │
└───────────────────────┘  WSS    └───────┬───────────────┬───────┘  WSS    └────────────────────────┘
                                          │               │
                                          ▼               ▼
                              ┌──────────────────┐  ┌──────────────────┐
                              │ Supabase Cloud   │  │  Upstash Redis   │
                              │ (Postgres + Auth │  │ (Real-time GPS & │
                              │  + Storage + RLS)│  │   Cached State)  │
                              └──────────────────┘  └──────────────────┘
                                          ▲
                                          │ HTTPS / WSS
                                          ▼
                                  ┌───────────────────────────────┐
                                  │   Responder App (Tanod Unit)  │
                                  │     (Flutter Mobile App)      │
                                  └───────────────────────────────┘
```

### 1. 🌐 MDRRMO Web Command Center (`web-dashboard/`)
* **Technology**: React 18, Vite, TypeScript, TailwindCSS / Custom CSS, Leaflet, OpenStreetMap.
* **Target Users**: Municipal DRRMO Administrators and Central Dispatchers.
* **Key Capabilities**:
  - **Live Command Map & Heatmap**: Real-time geospatial tracking of active incidents, unit positions, and historical severity clusters across all Norzagaray barangays.
  - **Incident & Verification Queue**: Triage emergency reports, inspect uploaded photo/video proof, track operational timelines, and monitor resolution progress.
  - **Inter-Agency Escalation Pipeline**: Review and act upon escalation requests submitted by barangays when incident severity exceeds local capabilities.
  - **Responder Live Monitoring**: Track on-duty Tanods and professional emergency units with real-time GPS locations and active mission statuses.
  - **Evacuation Center Management**: Monitor municipal-wide shelter occupancy, maximum capacities, and vacancy statuses.
  - **Weather & Hydromet Monitoring**: Real-time weather integration (PAGASA / Open-Meteo) and Angat / river level gauges for early flood warning.
  - **Dispatcher Accreditation**: Review and verify Barangay Dispatcher credential submissions with prefilled PDF endorsements.

### 2. 🏛️ Barangay Administrator & BDRRMC App (`barangay_app/`)
* **Technology**: Flutter, Dart, Provider, Flutter Map / Leaflet.
* **Target Users**: Barangay Officials, BDRRMC Officers, and Barangay Dispatchers.
* **Key Capabilities**:
  - **Barangay Incident Queue**: Immediate intake and assessment of geotagged emergency reports submitted within the barangay's territorial jurisdiction.
  - **Responder Dispatch**: Assign available On-Duty Barangay Tanods to incidents with notes and instructions.
  - **MDRRMO Escalation**: Request backup assistance or municipal escalation with a single tap when local capacity is overwhelmed.
  - **Evacuation Center Updates**: Register new shelters and update real-time evacuee counts, family numbers, and vacancy states (`open`, `limited`, `full`, `closed`).
  - **Accreditation Workflow**: Submit dispatcher verification documents to the MDRRMO with auto-generated official PDF certifications.

### 3. 🚨 Barangay Tanod / First Responder App (`mobile_app/`)
* **Technology**: Flutter, Dart, Hive, Flutter Secure Storage, Location Service, Flutter Map / OSRM.
* **Target Users**: Frontline Barangay Tanods and Field Emergency Responders.
* **Key Capabilities**:
  - **Duty Status Management**: Switch between `On Duty`, `Off Duty`, and operational states with instant socket notification to commanders.
  - **Real-Time Dispatch Alerts**: Receive audible and visual alerts for assigned incidents with option to accept or acknowledge.
  - **GPS Route Navigation**: Turn-by-turn routing via OpenStreetMap and Project OSRM directly to the reported incident coordinates.
  - **Field Status Updates**: One-touch operational milestones (`En Route`, `On Scene`, `Resolved`).
  - **Incident Documentation**: Capture photos, add situation remarks, and submit proof of resolution directly to the command chain.

### 4. 📱 Resident Mobile Emergency App (`resident_app/`)
* **Technology**: Flutter, Dart, Hive, Image Picker, Location Service, Flutter Map.
* **Target Users**: Residents of Norzagaray, Bulacan.
* **Key Capabilities**:
  - **One-Tap Emergency Reporting**: Quick report submission with auto-detected GPS coordinates, incident type (`flash_flood`, `fire`, `landslide`, `medical_emergency`, `typhoon`, etc.), and media capture.
  - **Flexible Target Routing**: Send reports directly to Barangay, MDRRMO, or All responding authorities.
  - **Report Tracking Timeline**: Monitor the live resolution journey of submitted reports (`pending` ➔ `verified` ➔ `dispatched` ➔ `on_scene` ➔ `resolved`).
  - **Evacuation Centers Directory**: Browse open evacuation centers in Norzagaray with live capacity indicators and navigation assistance.
  - **Safety Advisories & Weather Alerts**: Receive official municipal disaster bulletins, flood alerts, and emergency notifications.

### 5. ⚡ Central Backend API & Socket Engine (`backend/`)
* **Technology**: Node.js, Express.js, TypeScript, Socket.IO, Supabase Client, Upstash Redis, PDFKit, Zod.
* **Target Role**: Core transaction, event coordination, and data abstraction layer.
* **Key Capabilities**:
  - **Multi-Role JWT Authentication**: Strict Role-Based Access Control (RBAC) across `mdrrmo_admin`, `mdrrmo_dispatcher`, `barangay_admin`, `barangay_tanod`, and `resident`.
  - **Socket.io Real-Time Rooms**: Event routing by role (`commanders`), jurisdiction (`barangay:<id>`), and user (`user:<id>`).
  - **High-Frequency GPS Caching**: Upstash Redis stores live responder coordinates with automatic TTL expiration for power and bandwidth efficiency.
  - **Automated Weather & River Sync**: Background jobs sync meteorological forecasts and water level data every 5 minutes.
  - **Official Document Generation**: Server-side PDFKit service generates standardized Barangay Dispatcher Authorization forms.

---

## 📂 Project Structure

```
NorzAgapay/
├── backend/                  # Node.js + Express + TypeScript API Server
│   ├── src/
│   │   ├── config/           # Supabase, Redis, and Environment Configurations
│   │   ├── middleware/       # JWT Auth, RBAC, Rate Limiting, File Uploads
│   │   ├── routes/           # Auth, Incidents, Dispatches, Barangays, Weather, Evac Centers
│   │   ├── services/         # PDF Generation, Notification, and Hydromet Services
│   │   └── server.ts         # Socket.io event engine & scheduled jobs
│   └── package.json
│
├── web-dashboard/            # MDRRMO Web Portal (React + Vite + TypeScript)
│   ├── src/
│   │   ├── components/       # Live Map, Heatmap, Modals, Navbar, Stat Cards
│   │   ├── context/          # Auth Context & WebSocket Subscriptions
│   │   ├── pages/            # CommandCenter, Verification, EvacCenters, Weather, Reports
│   │   └── App.tsx
│   └── package.json
│
├── barangay_app/             # BDRRMC / Barangay Dispatcher Flutter Mobile App
│   ├── lib/
│   │   ├── screens/          # Reports, DispatcherVerification, EvacCenters, Team
│   │   ├── services/         # API Service, Auth Service, Socket Service
│   │   └── main.dart
│   └── pubspec.yaml
│
├── mobile_app/               # Barangay Tanod / Responder Flutter Mobile App
│   ├── lib/
│   │   ├── screens/          # Home (Duty Status), Task Detail, GPS Nav, Documentation
│   │   ├── providers/        # Location, Incident, and Auth State Providers
│   │   └── main.dart
│   └── pubspec.yaml
│
├── resident_app/             # Citizen / Resident Flutter Mobile App
│   ├── lib/
│   │   ├── screens/          # Emergency Report, Camera, My Reports, Evac Centers
│   │   ├── services/         # Offline Report Cache, Auth, and Location Services
│   │   └── main.dart
│   └── pubspec.yaml
│
├── database/                 # Supabase SQL Migrations & Schemas
│   └── migrations/           # Tables, RLS policies, triggers, and indices
│
├── update-tunnel-url.js      # Utility to propagate ngrok/tunnel URLs across all mobile apps
└── README.md                 # System documentation
```

---

## 🔄 Core Operational Workflows

### 1. Incident Reporting to Resolution
1. **Resident Submission**: A resident submits an incident report via `resident_app` with high-accuracy GPS coordinates, category, description, and attached camera photos.
2. **Barangay Triage & Verification**: The report instantly appears on `barangay_app` for the specific jurisdiction. The BDRRMC dispatcher reviews the incident and verifies its legitimacy.
3. **Tanod Dispatch**: The barangay dispatcher assigns an active On-Duty Tanod. An audio/visual dispatch alert triggers on the responder's `mobile_app`.
4. **Field Response**: The Tanod accepts the dispatch and follows the OSRM GPS navigation route to the scene. The Tanod updates status to `En Route`, then `On Scene`.
5. **Resolution & Documentation**: Upon resolving the incident, the Tanod uploads proof media and remarks. The status transitions to `Resolved`, immediately updating the resident's tracking timeline and the MDRRMO Command Center.

### 2. Multi-Tier Escalation Pipeline
1. If an incident (e.g., severe flash flood or structure fire) exceeds the response capability of the barangay, the Barangay Administrator triggers an **Escalation Request** with justification notes.
2. The incident escalates to the **MDRRMO Web Command Center** (`web-dashboard`) with high-priority visual markers.
3. MDRRMO command reviews the situation, approves the escalation, and mobilizes municipal emergency units (e.g., BFP, PNP, Municipal Rescue).

### 3. Evacuation Center Monitoring
1. Barangay administrators create and update designated shelters in `barangay_app`.
2. As evacuees arrive, current headcounts and family counts are updated in real time.
3. The status automatically toggles to `Limited` or `Full` when capacity thresholds are reached.
4. Residents view real-time shelter statuses and vacancies in `resident_app` before evacuating.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.x or later
* **npm** / **pnpm**
* **Flutter SDK**: 3.x+ with Dart SDK
* **Android Studio / Xcode** (for mobile app building and emulators)
* **Supabase Project**: Cloud or local instance with PostgreSQL
* **Upstash Redis**: URL and token for GPS caching

---

### 1. Database Setup (Supabase)
1. Log in to [Supabase](https://supabase.com/) and create a new project.
2. Open the **SQL Editor** in your Supabase dashboard.
3. Run the migrations located in `database/migrations/`:
   - `migration.sql` (Core tables, schemas, and RLS policies)
   - `dispatcher_verification_migration.sql` (Barangay accreditation schema)
   - `evacuation_centers_migration.sql` (Evacuation shelter tables)
   - `add_send_to_to_incident_reports.sql` (Targeted recipient routing)
   - `add_multiple_proof_and_field_media.sql` (Multi-photo attachments)
4. Ensure **Realtime** is enabled on the `incidents`, `incident_reports`, `alerts`, `evacuation_centers`, and `activity_feed` tables.
5. Create a public Supabase Storage bucket named `incident-media` for report uploads.

---

### 2. Backend API Setup
```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Create environment configuration
cp .env.example .env
```

Configure your `.env` with your project credentials:
```env
PORT=3001
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
JWT_SECRET=your-secure-jwt-secret
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token
CORS_ORIGIN=*
```

Start the backend development server:
```bash
npm run dev
```

---

### 3. MDRRMO Web Command Center Setup
```bash
# Navigate to web dashboard directory
cd web-dashboard

# Install dependencies
npm install

# Create environment configuration
# Ensure VITE_API_URL points to your backend (e.g., http://localhost:3001/api)
```

Start the web dashboard:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### 4. Mobile Applications Setup (Flutter)

Each mobile app is configured independently and connects to the backend API:

#### A. Resident Emergency App
```bash
cd resident_app
flutter pub get
# Update lib/core/constants.dart with your API URL
flutter run
```

#### B. Barangay Administrator App
```bash
cd barangay_app
flutter pub get
# Update lib/services/api_service.dart with your API URL
flutter run
```

#### C. Barangay Tanod / Responder App
```bash
cd mobile_app
flutter pub get
# Update lib/core/constants.dart with your API URL
flutter run
```

> **💡 Multi-Device / Tunnel Testing Tip:**
> If testing on physical mobile devices or over the internet via `ngrok` or `localtunnel`, simply run:
> ```bash
> node update-tunnel-url.js https://your-tunnel-url.ngrok-free.app
> ```
> This script automatically updates the API and WebSocket endpoints across all three Flutter apps and the web dashboard simultaneously!

---

## 👥 User Roles & Access Control

| Role | Client Interface | Scope of Authority |
|---|---|---|
| `mdrrmo_admin` | Web Dashboard | Municipality-wide command, incident oversight, escalation review, advisory broadcasting, and system user management. |
| `mdrrmo_dispatcher` | Web Dashboard | Live emergency dispatch monitoring, incident status updates, and weather/river level tracking. |
| `barangay_admin` | Barangay Mobile App | Jurisdiction-specific report triage, Tanod deployment, evacuation center management, and MDRRMO escalation requests. |
| `barangay_tanod` | Responder Mobile App | Shift duty management (`On Duty`/`Off Duty`), dispatch acceptance, turn-by-turn navigation, and on-scene incident documentation. |
| `resident` | Resident Mobile App | Submitting geotagged incident reports with photos, tracking own report timeline, viewing evacuation shelters, and receiving advisories. |

---

## 🛡️ Security & Reliability

* **Multi-Tier Authentication**: Encrypted password storage using `bcryptjs` and stateless session management with JSON Web Tokens (JWT).
* **Row-Level Security (RLS)**: Enforced directly on Supabase PostgreSQL tables so users only query records authorized for their role and jurisdiction.
* **Network Resilience**: Offline caching of loaded safety advisories and offline queueing of unsent incident reports in the mobile apps.
* **Rate Limiting & Sanitation**: API endpoints are protected with `express-rate-limit` and payload validation schemas via `zod`.
* **ISO/IEC 25010:2023 Compliance**: Evaluated across Functional Suitability, Performance Efficiency, Interaction Capability, Reliability, and Security.

---

## 🏫 Academic Background & Research

This project was developed as an undergraduate capstone thesis titled:
> **"NORZAGAPAY: AN INTEGRATED WEB AND MOBILE-BASED EMERGENCY RESPONSE AND CRISIS MANAGEMENT COORDINATION SYSTEM"**
> 
> **Institution**: Norzagaray College, College of Computing Studies  
> **Degree**: Bachelor of Science in Computer Science  
> **Location**: Norzagaray, Bulacan, Philippines  
> **Researchers**: Kim Hyster L. Desca, Emmanuel M. Nabus, Maich Richard B. Ponce, Jerzon L. Reminajes, Jerome Rey B. Tatoy

---

## 📄 License

This software is developed for the Municipality of Norzagaray and the College of Computing Studies, Norzagaray College. All rights reserved.
