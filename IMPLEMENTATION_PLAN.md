# NorzAgapay Unified App Implementation Plan

## Audit findings

- The backend has three identity scopes: MDRRMO users in `users`, barangay users in `barangay_users`, and residents in `resident_user`.
- MDRRMO and barangay sessions share role names such as `admin` and `dispatcher`, but have separate login routes, JWT claims, authorization middleware, and barangay coordination approval. The web dashboard currently authenticates only MDRRMO accounts.
- The former barangay app covers barangay reports, field response, dispatch/escalation, team access, broadcasts, hotlines, analytics, coordination requests, and adding evacuation centers.
- The former `mobile_app` was the separate Tanod responder client. Its assigned-task status updates, responder GPS, unit membership, and navigation have been copied under `lib/mdrrmo/` in the unified app.
- The web dashboard has MDRRMO roles (Master Admin, Admin, Dispatcher, Logistics), incident reporting, a command map, a responder tracker, logistics pages, verification, broadcasts, officers, analytics, and weather. It has no barangay account login or barangay operations workspace.
- Barangay endpoints are already scoped to the authenticated barangay and gated by the shared coordination activation. MDRRMO endpoints use a separate middleware and cannot accept barangay tokens.
- The `Missions` screen is a second presentation of incidents/tasks rather than a separate mission data model. The incident/task pipeline is still required for dispatch and responder tracking; removal should target the mission page and its standalone matching/mission actions, not incident reports or response tasks.
- Evacuation-center management is split by role: barangay users add their own stations, while MDRRMO views, searches, and filters barangay-added stations on a map. Residents see nearest-station distance and travel-time estimates.

## Role and capability matrix

| Scope / role | Mobile app | Web dashboard |
|---|---|---|
| MDRRMO Master Admin | Cross-barangay incident overview, dispatch monitoring, account oversight, verification, broadcasts, analytics, weather, and responder/unit operations | Full municipal command center and all MDRRMO administration, operations, logistics, monitoring, and reporting |
| MDRRMO Admin | Account/officer verification and management, broadcasts, analytics, weather, and cross-barangay overview | Full admin workspace: verification, users, officers, broadcasts, analytics, weather, and municipal overview |
| MDRRMO Dispatcher | Incident review/verification, response dispatch, live responder tracking, and incident status monitoring | Command center, reports, dispatch, tracker, weather, and incident coordination |
| MDRRMO Logistics | View/search/filter barangay-added evacuation stations on a map, manage resource requests and response units, view responder tracker and municipal situation | Full logistics workspace and all-barangay station/request/unit monitoring |
| Barangay Admin | Own-barangay command summary, reports, team, broadcasts, hotlines, analytics, coordination request, and add station | Own-barangay command center and full barangay operations/admin functions |
| Barangay Dispatcher | Own-barangay command queue, assess/dispatch/escalate/close reports, decide assistance requests, monitor response | Own-barangay command center, incident queue, dispatch/escalation, assistance decisions, and response tracking |
| Barangay Responder | Own-barangay assignments, status updates, GPS/navigation, field media/closure, assistance requests, and adding response team members where allowed | Own-barangay response queue, task/status/media, assistance requests, and team actions permitted by the backend |
| Barangay Staff | Own-barangay advisories/broadcasts, hotlines, and add station where allowed | Own-barangay content, hotlines, and station entry where allowed |
| Resident | Submit/track reports; see nearest active evacuation stations and estimated distance/time | No dashboard account |

Mobile layouts may simplify navigation and dense tables, but must retain each role's authorized actions. Web layouts remain the full-capability workspace.

## Coordination and data flow

1. MDRRMO account operations use `/api/auth/login`, standard `authenticate`/`authorize` middleware, and the municipal `users` table.
2. Barangay operations use `/api/barangay/login` and barangay endpoints. The server validates the barangay account, membership, and active coordination approval; every report/team operation remains restricted to that account's barangay.
3. A barangay activation request is reviewed by MDRRMO verification. Until activated, all barangay roles stay gated in both mobile and web.
4. A resident report is routed to the requested barangay/MDRRMO audience. The receiving dispatcher reviews the report and evidence, assigns incident type and severity, then dispatches responders. A barangay responder can submit a support/escalation request linked to that report; the barangay dispatcher escalates it with the existing classification. The MDRRMO dispatcher receives those values prefilled, may revise them, and dispatches municipal responders. The classification remains on the report and drives responder task details and analytics.
5. Assigned responder tasks, GPS updates, and status events continue to feed the responder tracker and command maps. Removing the Mission screen must not remove these task/report endpoints.
6. Evacuation stations are created with a name, address, and map pin. Operational clients do not edit/deactivate stations from this workflow. Residents receive the nearest active stations with straight-line distance and an estimated road travel time based on an average-speed assumption.

## Implementation sequence

1. **Unified mobile client:** merged barangay and Tanod responder source, added MDRRMO role-based workspaces, connected both identity providers, resolved merged Flutter dependencies, and replaced the old root `mobile_app/` with the unified app.
2. **Barangay web access and analytics:** added scope-aware login/session restore, a dedicated barangay command center, coordination request/status page, barangay operations workspace, and role-scoped incident trend, type, severity, status, and weekday charts. MDRRMO analytics now uses actual incident reports and includes those charts plus a barangay comparison.
3. **Role boundaries:** barangay web operations call barangay-scoped APIs; municipal dashboards retain cross-barangay access, with role-specific navigation and route guards.
4. **Mission removal:** removed the MDRRMO Mission page/navigation and the separate mission/volunteer-dispatch API surface while retaining incident reports, responder tasks, and tracking.
5. **Evacuation workflow:** switched active station interfaces to add-only and resident interfaces to nearest station, straight-line distance, and estimated travel time; removed resident family registration and active occupancy workflows.
6. **Project cleanup:** updated README, build guide, and tunnel updater to describe the unified `mobile_app/` structure and role behavior; the old responder flows now live under `mobile_app/lib/mdrrmo/`.

## Verification and remaining work

- `flutter pub get` completed successfully for the staged unified mobile source and refreshed its lockfile.
- `git diff --check` found no whitespace errors; it reported only expected line-ending conversion notices.
- Tests, build, and static analysis were not run.
- The old generated build output was removed with the required Windows permission, and the unified source now resides at `mobile_app/`.

## Existing constraints / decisions

- No database rows are dropped as part of this work. Obsolete tables/columns can be retired separately after confirming deployment data is no longer needed.
- Barangay API JWT isolation and the shared coordination activation remain the authorization source of truth; client-side role checks are only presentation controls.
- The responder task system stays because responders need assigned tasks, GPS, and status history after the Mission screen is removed.
- Existing local Flutter and web styles are used for the responsive UI; a new Flowbite dependency is unnecessary for the requested behavior.

## Optional municipality map boundary

- Logistics and Master Admin can edit the shared Norzagaray boundary in the web dashboard by adding, moving, and removing map points. Saving requires at least three distinct points; the polygon closes from the last point to the first. Saved revisions can be restored.
- The existing Norzagaray GeoJSON is returned as the initial editable shape. The boundary starts disabled, so maps remain full and no boundary-based location or report restrictions apply until an authorized user enables it.
- When enabled, the same saved GeoJSON and setting are used by all in-app maps in `web-dashboard`, `mobile_app`, and `resident_app`. Map imagery and map markers outside the boundary are hidden; relevant location, evacuation-station, and report checks use the same boundary.
- When disabled or when no boundary is configured, maps show the full area and boundary-based restrictions are bypassed. Mobile clients cache the latest configuration and refresh it on app resume; the web dashboard refreshes periodically and when it becomes visible.
- Implementation files include the `municipality_boundary_config` and `municipality_boundary_history` migration, `/api/municipality-boundary`, the dashboard Municipality Boundary editor, and the boundary-aware map/location services in both Flutter apps. Apply `database/migrations/municipality_boundary_migration.sql` to Supabase before deploying the backend.
