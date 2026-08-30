# NorzAgapay — Real-time Crisis Management & Logistics

NorzAgapay is a full-stack, real-time crisis management and volunteer-driven relief logistics system designed for MDRRMO (Municipal Disaster Risk Reduction and Management Office).

## 🚀 Project Overview

- **Web Dashboard:** React + Vite + TypeScript (For Commanders & Admins)
- **Mobile App:** Flutter (For Volunteers & Professional Units)
- **Backend:** Node.js + Express + Socket.io (Microservices Architecture)
- **Database:** Supabase (PostgreSQL)
- **Caching:** Upstash Redis (GPS Tracking)
- **Storage:** Supabase Storage (Document & Photo Uploads)
- **Maps:** Leaflet + OpenStreetMap + Project OSRM (Completely Free)

---

## 🛠️ Setup Instructions

### 1. Database (Supabase)
1. Create a new project in [Supabase](https://supabase.com/).
2. Go to the **SQL Editor** and run the contents of `database/migrations/001_create_tables.sql`.
3. Enable **Realtime** for the tables specified in the SQL file.

### 2. Backend API
1. Navigate to `backend/`.
2. Install dependencies: `npm install`.
3. Create a `.env` file based on `.env.example` and fill in your credentials:
   - Supabase URL & Keys
   - JWT Secret
   - Upstash Redis URL & Token
4. Start the server: `npm run dev`.

### 3. Web Dashboard
1. Navigate to `web-dashboard/`.
2. Install dependencies: `npm install`.
3. Create a `.env` file and set `VITE_API_URL`.
4. Start the dashboard: `npm run dev`.

### 4. Mobile App (Flutter)
1. Ensure you have the Flutter SDK installed.
2. Navigate to `mobile_app/`.
3. Install dependencies: `flutter pub get`.
4. Update `lib/core/constants.dart` with your local IP address (for emulator use `10.0.2.2`).
5. Run the app: `flutter run`.

---

## 🧠 Core Features

- **Matching Engine:** Automatically assigns the closest professional units and certified volunteers to incidents based on skill requirements.
- **Silo-Bridge:** Breaks departmental silos by allowing all professional units (Police, Fire, Medical) to see each other's live locations on a unified map.
- **Two-Tier Volunteer System:** Distinguishes between General Labor (auto-approved) and Certified Specialists (admin-verified).
- **Relief Logistics:** QR code tracking for relief shipments from warehouse to delivery zone.
- **Offline-First:** Mobile app caches critical data for use in low-connectivity disaster zones.

---

## 🛡️ Security
- JWT-based multi-role authentication.
- RBAC (Role-Based Access Control) enforced on all API endpoints.
- Rate limiting on sensitive endpoints (Login).
- Secure file upload flow via presigned URLs.
