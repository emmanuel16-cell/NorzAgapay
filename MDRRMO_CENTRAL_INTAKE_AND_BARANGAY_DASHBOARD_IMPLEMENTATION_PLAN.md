# MDRRMO Central Intake and Barangay Dashboard Implementation Plan

## Goal

Let residents choose the closest active barangay or MDRRMO when submitting an incident report. A barangay can escalate its assigned report to MDRRMO; an MDRRMO dispatcher can route an MDRRMO report to the closest active barangay. Keep barangay users scoped to reports assigned to their barangay.

## Current-state findings

- `backend/src/routes/incidentReports.ts` stores new reports as canonical `mdrrmo_reports` records. The resident's `send_to` choice determines whether the record receives an immediate closest-active-barangay assignment or enters the MDRRMO queue without one; `barangay_id` continues to describe incident geography.
- MDRRMO reports already have a central queue in `backend/src/routes/mdrrmoReports.ts`. Barangay operations use a separate `barangay_reports` table and `/api/barangay/reports` endpoints.
- Barangay authentication already exists at `/api/barangay/login`. Its token includes `barangayId`, and `authenticateBarangay` rechecks the account and barangay activation. Most barangay report queries filter using that token scope.
- The web dashboard currently signs in through the MDRRMO auth flow. `AuthContext` only grants dashboard access to MDRRMO roles, and `App.tsx` routes are written for MDRRMO roles. Barangay users cannot currently use this dashboard session.
- The backend Debug Quick Login already supports a `barangay` audience when debug login is enabled, but the web login page requests only the `standard` audience and its quick-login action always submits `standard`.
- Barangay records already have latitude/longitude values used when resolving a report's location to a barangay. The new official barangay map pin should not change those values unless their current purpose is confirmed to be the same.
- MDRRMO report dispatch to municipal responder units is already implemented. Barangay escalation is also implemented in the opposite direction, from `barangay_reports` into MDRRMO. The new flow needs a distinct MDRRMO-to-barangay assignment path.

## Recommended workflow and data rules

1. Every new report is one canonical `mdrrmo_reports` record. A resident choosing MDRRMO enters the central queue; a resident choosing the closest barangay receives an active assignment to the nearest approved, active barangay with a known location. The report's location barangay remains recorded for geography and filtering.
2. MDRRMO can dispatch municipal responders or assign an MDRRMO-routed report to an approved, active barangay. Offer the nearest eligible barangay first, ranked by distance from the incident coordinates, while allowing a dispatcher to select another destination.
3. Keep the incident as one canonical `mdrrmo_reports` record. Use the barangay assignment record for both resident-selected local routing and MDRRMO assignments, retaining the assignment source, destination, time, notes, and lifecycle. Do not use `barangay_id` as the assignment destination or create an unlinked duplicate report.
4. Allow only one active barangay assignment per report. MDRRMO can reassign or recall an open assignment with a recorded reason. Completed or closed incidents cannot be silently reassigned.
5. The assigned barangay can dispatch its own responders, update field status, document the result, resolve the incident, or report/escalate it directly to MDRRMO. Escalation ends the active barangay assignment, returns the incident to the MDRRMO queue immediately with its history and notes, and has no separate assistance-request approval step. MDRRMO retains the full incident view and authority over assignment and reassignment.
6. Keep municipal responder lifecycle separate from barangay response lifecycle so the two dispatch paths do not overwrite each other's status, timestamps, or notes. Resident tracking presents one coherent timeline assembled from the central report and its assignment history.

## Implementation phases

### 1. Database and lifecycle foundation

- Add a migration for MDRRMO-to-barangay assignments and assignment history. Link assignment rows to `mdrrmo_reports`, `barangays`, and the assigning user; store assignment notes, state, and barangay-side response lifecycle separately from MDRRMO responder dispatch fields.
- Enforce one active assignment per report, valid assignment states, and indexes for the MDRRMO queue and barangay-scoped queue. Keep database access behind the backend service role and add restrictive RLS/grants consistent with the existing schema.
- Add a transactional database function or equivalent transaction boundary for assign, reassign, and recall operations. It must update the assignment and lifecycle audit atomically and reject invalid report states or inactive/unapproved destinations.
- Add storage for each barangay's official location pin and the MDRRMO office pin. Keep the display pins distinct from existing coordinates used to resolve incident locations when those coordinates have a different purpose.
- Prepare a one-time, duplicate-safe transition for unresolved legacy `barangay_reports`: link or move active cases into the central intake workflow without losing their history. Keep resolved legacy reports available as historical records.

### 2. Centralize all new report intake

- Change `POST /api/incident-reports` so every new resident report is inserted into `mdrrmo_reports`; validate `send_to`, and create an active closest-barangay assignment when the resident selects `barangay`.
- Continue resolving and storing the incident's geographic barangay. Stop treating that field as proof that a barangay owns the report.
- Preserve idempotency (`client_request_id`), evidence uploads, reporter details, coordinates, and resident tracking behavior during the routing change.
- Add a public resident incident-reporting option beside the web dashboard login. Residents can submit a report without creating an account; require and validate a mobile number on this guest form and store it as the report contact number.
- Below the public web reporting option, show a hotline directory available without login. Include published MDRRMO hotlines and hotlines added by barangays, labeled with the responsible barangay; load the list from a public read-only endpoint and keep hotline management restricted to authorized users.
- Keep incident reporting in `resident_app` available without login. Require a valid mobile number when the reporter is not signed in; for signed-in residents, use their account contact details. The backend must enforce this distinction and reject guest submissions with a missing or invalid number.
- Give residents the same `Closest barangay` / `MDRRMO` choice in `resident_app` and the public web report form. Explain that a barangay can escalate to MDRRMO and an MDRRMO dispatcher can route its reports to a nearby barangay.
- Notify the selected operational queue at intake. For resident-selected local routing, notify only the assigned barangay and report owner; for MDRRMO routing, notify MDRRMO.

### 3. Add MDRRMO assignment controls

- Add an “Assign to Barangay” action to the MDRRMO report detail view alongside the existing municipal dispatch path.
- Load eligible destinations from the server using verified/active barangay status, sorted by distance from the incident location. Preselect and label the nearest eligible destination while allowing dispatcher choice. Show both the incident location barangay and the selected response barangay.
- Require a destination and assignment notes; provide reassign and recall actions with a reason. Show current assignment, assignment history, and barangay response progress to MDRRMO users.
- Publish assignment changes to the MDRRMO dashboard, resident timeline, and only the destination barangay's scoped realtime room.
- Keep false-report review, municipal dispatch, and assignment as distinct actions with clear server validation so only one response path is active at a time.

### 4. Enable barangay dashboard access

- Extend the existing dashboard login flow to support barangay accounts through `/api/barangay/login` and `/api/barangay/me`. Store the account kind and `barangay_id` in the authenticated session so MDRRMO and barangay tokens cannot be confused.
- Extend Debug Quick Login to include active barangay accounts. Show each account's barangay name and role, request the `barangay` audience when selected, and initialize the same barangay-scoped dashboard session used by normal barangay login. Keep the picker available only when the existing debug-login feature flag is enabled.
- Reuse the same web-dashboard UI, navigation, page layouts, and report workflows for MDRRMO and barangay accounts. Each page must load the signed-in barangay's own assigned reports, responders, activity, and other supported operational data; the dashboard must not switch barangay users to a separate product interface.
- Provide the same incident detail and evidence views, with barangay-appropriate actions for local dispatch/status updates, field documentation, resolution, and direct reporting/escalation to MDRRMO. Where a page has no barangay-owned data or allowed operation, retain the shared UI structure and enforce the role/scope in the page and API.
- Make the entire web dashboard strictly responsive on phone-sized screens, not only the login and report pages. Adapt navigation, maps, tables, report queues/details, dialogs, forms, charts, and action controls for narrow viewports and touch input. Prevent page-level horizontal overflow, clipped content, and controls that require precision mouse interaction; preserve all essential workflows in portrait and landscape layouts.
- Add a map-based setting in the shared web dashboard for an authorized barangay admin to place or update that barangay's official location pin. Add an MDRRMO office-location setting for authorized MDRRMO admins. Validate coordinates and enforce these permissions in the backend.
- Display the configured locations in the shared Command Center map: barangay users see their own barangay pin and the MDRRMO office pin; MDRRMO users see the MDRRMO office and configured pins for all barangays. Label each marker clearly and show a useful empty state until a location is configured.
- Define responder availability from server-verified state: an active responder with no current responding/active incident assignment is available when their latest valid GPS position is within 100 meters of their own barangay location pin or the MDRRMO office pin, according to their responder organization. Stale or missing GPS, an inactive account, or an active response makes them unavailable. Calculate the distance on the server and use the existing live-location freshness rules.
- Make the MDRRMO office and barangay pins selectable in the Command Center. Selecting the MDRRMO office shows available MDRRMO responders within 100 meters; selecting a barangay pin shows available responders belonging to that barangay who meet the same 100-meter and not-responding rules. In a barangay session, only that barangay's pin and its responders' availability list are accessible; the MDRRMO office pin may remain visible as a location marker without exposing MDRRMO responder availability.
- Refresh the available-responder list when responder location, response state, account state, or a location pin changes. Do not treat the pin click or map filtering as authorization; the endpoint must enforce organization and barangay scope.
- Use role-specific capabilities based on existing barangay roles: admins manage permitted barangay operations, dispatchers manage incident dispatch and escalation, responders handle assigned field work, and staff receive only the permitted read or administrative functions.
- Filter every list, detail, mutation, export, media access, and socket event on the server using `barangayId` from the verified token and the active assignment record. Never accept a client-supplied barangay ID as the authorization scope.
- Keep MDRRMO-only routes unavailable to barangay sessions even if a user edits the browser URL or calls the API directly. Recheck account activation and barangay coordination activation on requests, using the existing barangay authentication rules.
- Keep the shared dashboard navigation and visual structure. Scope maps, queues, analytics, and report data to the barangay account; restrict municipal administration and dispatch actions by role, and never return other barangays' records.

### 5. Keep the mobile and resident flows consistent

- Update `mobile_app` so barangay operations users see MDRRMO-assigned incidents in their barangay queue and can use the existing local response workflow for those assignments.
- Preserve legacy local reports during rollout. A barangay escalation/report to MDRRMO must transfer the incident into the MDRRMO queue immediately, retain its history, and avoid a separate assistance-request approval step.
- Update `resident_app` report status retrieval to combine central review, barangay assignment, field response, and resolution into a single timeline.
- Route push and socket notifications to MDRRMO, the assigned barangay, and the report owner according to the event and authorization scope. A barangay escalation notifies MDRRMO directly. Avoid broadcasting report details to every barangay room.

### 6. Rollout and completion checks

- Apply the database migrations before enabling the new intake and dashboard paths. Roll out the backend before the web and mobile clients; reports remain canonical and server-side routing validates the resident's selected destination.
- Verify that a resident-selected closest-barangay report appears only in that barangay's queue and can be escalated to MDRRMO, while an MDRRMO-selected report appears in the MDRRMO queue and can be assigned to the nearest eligible barangay.
- Verify that a barangay can list and update only its active assignments; attempts to access another barangay's report, media, export, or mutation return an authorization failure.
- Verify that MDRRMO can assign, reassign, recall, and track reports, while the resident sees the complete report timeline.
- Verify existing municipal dispatch, direct barangay-to-MDRRMO escalation, evidence uploads, legacy report history, and both dashboard login paths continue to work through the transition.
- Verify barangay admins can update only their own location, MDRRMO admins can update the MDRRMO office location, and the shared Command Center shows the correct scoped markers for each account type.
- Verify responders are available only when active, not responding, and within 100 meters of the correct organization pin with a fresh GPS fix; verify they disappear from the list when any condition stops applying.
- Verify MDRRMO can select the office and any barangay pin to see only the eligible responder group for that pin, while barangay users can see eligible responders from their barangay only.
- Review every dashboard route at common phone viewport widths in portrait and landscape. Confirm navigation, maps, tables, dialogs, media, forms, and primary actions remain usable without horizontal page scrolling or hidden content.

## Acceptance criteria

- Resident reporting offers `Closest barangay` and `MDRRMO` in the resident app and public web form.
- A closest-barangay choice creates one canonical report and assigns it to the nearest active, verified barangay based on incident coordinates; the barangay can escalate that report directly to MDRRMO.
- An MDRRMO choice enters the MDRRMO queue; dispatchers can assign the nearest active, verified barangay or choose another eligible barangay.
- Residents can submit reports from beside the web login without an account, with a mandatory valid mobile number.
- A public hotline directory appears below the web guest reporting option and includes published barangay-added hotlines labeled with their barangay names.
- `resident_app` does not require login to submit a report; guest submissions require a valid mobile number, while signed-in submissions use the resident's account details.
- The incident location and response-assigned barangay are stored and displayed as separate values.
- MDRRMO can assign an open report to an eligible barangay, see its progress, and reassign or recall it with an audit trail.
- Barangay users can access the web dashboard using their barangay credentials and see only reports assigned to their own barangay.
- When debug quick login is enabled, the dashboard login offers active barangay accounts labeled by barangay and role and opens them with barangay-scoped permissions.
- Barangay users see the same dashboard interface as MDRRMO users, populated only with their barangay's permitted data and actions.
- The shared Command Center displays the signed-in barangay's location and MDRRMO office to barangay users, and all configured barangay locations plus the office to MDRRMO users.
- Clicking a location pin shows only responders from the matching organization who are not responding and whose fresh GPS position is within 100 meters; barangay users can view only their own responders.
- Every web-dashboard page and critical workflow is usable on phone-sized screens in portrait and landscape, without page-level horizontal overflow or inaccessible controls.
- A barangay escalation appears in MDRRMO's queue immediately with its history and notes, without an intermediate approval workflow.
- Barangay dashboard APIs enforce scope server-side for reads, writes, files, and realtime events; UI hiding alone is not considered authorization.
- Barangay response updates and MDRRMO responder dispatches retain separate lifecycle state, and the resident receives one coherent status timeline.
- Existing report and escalation history is preserved without duplicate active reports during migration.

## Out of scope for the first implementation

- Automatic assignment of MDRRMO-routed reports based only on coordinates. MDRRMO dispatchers choose whether to assign those reports to a barangay.
- Giving barangay accounts access to municipality-wide or other-barangay data, even though they use the shared dashboard interface.
