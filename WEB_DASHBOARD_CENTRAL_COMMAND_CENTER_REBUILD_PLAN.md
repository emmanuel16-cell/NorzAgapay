# MDRRMO Central Command Center Web Dashboard Rebuild Plan

## Objective

Rebuild `web-dashboard` as the shared web command center for Norz-Agapay. New public and resident-submitted incident reports enter the MDRRMO central intake queue. MDRRMO triages each report, dispatches municipal responders or assigns the report to an eligible barangay, and receives direct barangay escalations in the same central queue. Each account sees the workspace and actions permitted for its identity and jurisdiction.

This plan supersedes the earlier resident-selected barangay routing proposal in `MDRRMO_CENTRAL_INTAKE_AND_BARANGAY_DASHBOARD_IMPLEMENTATION_PLAN.md`. Existing records and lifecycle history must remain readable during the transition.

## Scope decisions

- Build on the current `main` branch.
- Rework the full web dashboard shell, navigation, page layout, responsive behavior, and role-specific workspaces. Do not limit the redesign to the public report page.
- Include public/guest users, resident accounts, MDRRMO master admins, MDRRMO admins, dispatchers, logistics staff, MDRRMO responders, and authorized barangay administrators, dispatchers, staff, and responders where their identity and API capabilities support web access.
- Every new emergency incident report enters MDRRMO intake. The public report form does not offer a barangay destination. Dispatchers can route an incident to MDRRMO responders or assign it to an eligible barangay after central triage.
- The shared incident-submission API enforces MDRRMO intake for new submissions from web and mobile clients. The resident app reflects that by offering one MDRRMO destination; legacy mobile clients cannot override the server route.
- Preserve existing barangay-originated work, direct barangay-to-MDRRMO escalations, and past resident-to-barangay records as history. Do not silently duplicate, erase, or re-route an already active report during migration.
- Exclude evacuation stations/centers from the rebuilt web dashboard: no navigation item, dashboard page, admin workflow, resident station finder, or new station API work in this effort. Keep unrelated database/mobile behavior untouched unless a dependency must be removed to ship the dashboard safely.
- Keep authorization and barangay scoping enforced by backend APIs. Hiding a page or button is never the security boundary.

## Implementation checkpoint

The current implementation slice on `main` now includes the role-aware dashboard routes and workspaces, MDRRMO-only public submission with **Not sure** as its default category, resident report history, guest report tracking by reference plus matching mobile number, and assigned responder views. A dispatch or barangay responder dispatch starts in `responding` with acceptance time recorded automatically; no responder accept action is needed. MDRRMO crew selection uses the municipal unit roster, while barangay crew selection uses only active staff/responders from that barangay. Barangay and MDRRMO crew are stored separately. The evacuation-center dashboard route, page, and navigation have been removed.

The automatic-acceptance and crew changes require `database/migrations/20261012_auto_accept_response_crews.sql` to be applied to the connected database. This migration is also appended to `database/schema.sql` for fresh installs. Remaining work includes completing the shared visual-system replacement across all legacy admin pages, reviewing every backend route and realtime channel against the capability matrix, reconciling all legacy lifecycle records into one resident-facing timeline, and completing role-by-role rollout hardening. The full phase exit criteria below are not yet met.

## Target report lifecycle

1. A guest or signed-in resident submits an emergency or community safety report with contact details, incident category (default **Not sure**), description, location, and optional evidence.
2. The backend stores one canonical report and places it in MDRRMO intake. Historical report source, original destination, barangay assignment, and escalation events remain distinguishable.
3. MDRRMO reviews and classifies the report, then chooses an allowed next action: dispatch municipal responders, assign to a verified active barangay, request more information, mark invalid, or close/resolve according to policy. A dispatch or assignment is accepted automatically when issued; responders do not need to accept the report.
4. An assigned barangay handles only its scoped assignment, records local response progress, and can escalate directly to MDRRMO with notes and history. The responder or crew lead records that response's members from the barangay's own roster, such as its driver and first aider.
5. MDRRMO responders record response members from the municipal MDRRMO responder/unit roster. Barangay responders record members from their own barangay roster. Keep these crew rosters separate and scoped; do not use a shared member list or picker. Residents can follow their own report's status timeline and response updates.
6. All transitions, assignment changes, notifications, and evidence access follow authenticated identity, active status, role, and jurisdiction.

## User workspaces

| User | Web experience |
| --- | --- |
| Public / guest | Public home, hotlines, submit an incident without an account, see submission confirmation and a safe tracking reference. |
| Resident | Sign in, submit incident/community safety reports, view and track only their own reports, manage permitted profile/contact settings, and receive status updates. |
| MDRRMO dispatcher | Central intake queue, map and incident detail, triage/classification, municipal dispatch, barangay assignment/reassignment/recall, escalation review, and lifecycle history. |
| Barangay admin / dispatcher | Barangay-scoped assigned incident queue, local dispatch and progress, direct escalation to MDRRMO, barangay profile/location/hotline settings as permitted. |
| Barangay staff / responder | Scoped read-only or assigned field actions supported by their verified backend role; no access to other barangays or municipal administration. Barangay response crews use only that barangay's roster. |
| MDRRMO responder | Assigned response queue, incident details, response status/proof updates, crew roster entry from the municipal MDRRMO responder/unit roster, location sharing controls, and resource requests supported by existing APIs. Dispatch is accepted automatically; no separate accept action is required. |
| MDRRMO logistics staff | Municipal MDRRMO responder/unit roster, activation and availability, officer directory, and operational readiness tools; no evacuation-station feature. |
| MDRRMO admin / master admin | System administration, users and access, verification, operational configuration, broadcasts, and aggregate reporting with clear master-admin boundaries. |

## Role capability matrix

| Account | Reports it may read | Report actions | Administrative scope |
| --- | --- | --- | --- |
| Guest | Its own submission confirmation and public information | Submit a report; no access to the operational queue | None |
| Resident | Its own reports and status history | Submit and update permitted contact/profile details; no dispatch or review actions | Own profile only |
| MDRRMO dispatcher | Central intake and all municipality response records needed for coordination | Triage, classify, dispatch responders, assign/reassign/recall barangay work, review escalation, resolve within policy | Operational configuration exposed to dispatchers |
| MDRRMO responder | Reports assigned to that responder/unit | Work starts as accepted when dispatched; record crew members from the municipal MDRRMO responder/unit roster, arrival, field assessment/media, and resolution after required evidence | Own response and municipal MDRRMO unit roster |
| MDRRMO logistics | Operational roster and readiness records | Manage unit availability and roster; no incident triage or report assignment | Respond units and officer readiness |
| MDRRMO admin | Admin-approved aggregate and audit views | No operational dispatch unless explicitly granted by policy | Users, verification, broadcasts, analytics, and configuration |
| MDRRMO master admin | Platform-wide administration and audit data | Operational access only through explicitly granted capabilities | All administrative scopes; no resident-private report ownership is implied |
| Barangay admin / dispatcher | Reports assigned to that barangay, its historical cases, and its own escalation history | Assign local responders, update local progress, escalate to MDRRMO, close eligible assignments | Its own barangay profile and operational settings only |
| Barangay responder | Only reports assigned to that responder in its barangay | Work starts as accepted when assigned; record crew members from that barangay's own roster, arrival, field evidence, and resolution of eligible assigned cases | Its own assignments and barangay roster only |
| Barangay staff | Read-only history and any additional reports explicitly allowed by the backend | No dispatch, escalation, or mutation unless separately authorized | Read-only barangay workspace |

The UI must follow this matrix, while the API independently enforces each read and mutation scope. A master-admin role must not grant access to a resident's private report list or another barangay's scoped queue by default.

## Phased implementation

### Phase 0 — Audit and lock the contract

- Inventory current routes, roles, API endpoints, report tables, assignment history, notifications, and legacy sources.
- Document the canonical report lifecycle, allowed state transitions, role/capability matrix, data ownership, and legacy record compatibility.
- Identify API or schema gaps for resident web access and responder web actions before building UI against assumptions.
- Remove evacuation stations from the target route/navigation map while avoiding unrelated mobile/backend changes.

**Exit criteria:** Every route and action has an owner role, API, data scope, and explicit allow/deny rule; the report lifecycle is documented; all evacuation-center dashboard surfaces are identified for exclusion.

### Phase 1 — Shared design system and application shell

- Replace the current page-by-page visual treatment with a consistent dashboard design system: typography, colors, spacing, forms, status chips, cards, tables, empty/loading/error states, and dialogs.
- Rebuild shared shell components: role-aware navigation, responsive sidebar/header, account menu, notifications, breadcrumbs/page heading, and mobile navigation.
- Create shared accessible primitives for incident rows/cards, filters, maps, evidence previews, confirmation dialogs, and timeline events.
- Remove evacuation-center navigation and route references. Use a valid command-center landing route for logistics accounts instead of redirecting to an excluded page.
- Ensure every layout works on narrow screens, keyboard input, high zoom, and touch controls.

**Exit criteria:** All existing included dashboard routes use the shared shell; no evacuation-center link or page is reachable from dashboard navigation; shell adapts to desktop, tablet, and phone.

### Phase 2 — Identity, role access, and landing pages

- Unify MDRRMO and barangay session handling without conflating tokens, account kinds, or barangay scopes.
- Add resident authentication/session restoration for the existing resident identity endpoints and provide a usable guest path.
- Give responders a web session and only the field operations their APIs authorize.
- Replace scattered role checks with an explicit capability matrix used by navigation, route guards, and page actions. Keep backend authorization authoritative.
- Give each role a useful landing workspace and safe redirect when opening an unauthorized route.
- Cover loading, expired session, deactivated account, unverified barangay, and sign-out cases consistently.

**Exit criteria:** Each supported account type can sign in and land on its workspace; direct URL/API access remains scoped; guests can still submit reports without a login.

### Phase 3 — Central intake and resident reporting

- Consolidate new public and signed-in resident report creation into the canonical MDRRMO report pipeline.
- Enforce central routing in the backend so legacy/mobile clients cannot bypass MDRRMO triage for a newly created report; preserve the original route for idempotent retries of existing records.
- Keep **MDRRMO** as the only public report destination. Add an incident category selector below mobile number with **Not sure** as the default and persist the exact category.
- Support emergency and community safety report origins without mixing a community post with a dispatchable incident unless the server workflow explicitly converts it.
- Preserve contact number validation, location selection, optional media, idempotent retries, abuse controls, and immediate submission feedback.
- Give residents an authenticated report list and a unified status timeline for their own reports. Keep guest tracking scoped by a verifiable tracking reference/ownership mechanism.
- Keep historical resident-to-barangay submissions readable with their original source and routing history.

**Exit criteria:** Every new resident/guest emergency report enters MDRRMO once with the selected category, contact, location, and evidence; residents cannot read another resident's report; old reports remain correctly labeled.

### Phase 4 — MDRRMO central operations

- Rebuild the central map, queue, filters, incident detail, evidence viewer, and lifecycle timeline as one coordinated workflow.
- Support triage, classification, urgency, invalid/duplicate review, assignment to eligible barangays, municipal responder dispatch, reassignment/recall with reasons, and resolution.
- Make assignment destination separate from the incident's geographic barangay; show both clearly.
- Add realtime queue and detail updates without leaking report data into unauthorized rooms.
- Keep one active operational path per report and preserve audit history for every state transition.

**Exit criteria:** A dispatcher can take a central report from intake through either response path with auditable transitions, current status, and reliable resident updates.

### Phase 5 — Barangay and responder operations

- Give barangay accounts a scoped queue for assigned incidents, local responder dispatch/status, field notes/evidence, resolution, and direct escalation back to MDRRMO.
- Preserve barangay-originated and resident-to-barangay historical cases without creating a parallel active copy.
- Give MDRRMO and barangay responders role-appropriate assigned-work views, incident navigation, automatic acceptance on dispatch/assignment, en-route/on-scene/resolved updates, crew roster entry, field documentation, and availability/location controls supported by server APIs. MDRRMO crew entry uses the municipal responder/unit roster; barangay crew entry uses only that barangay's roster. Do not require responders to accept a report manually or expose a shared crew-member picker.
- Keep assistance requests and resource requests where they support the incident lifecycle, with clear source and ownership.
- Ensure residents see the same lifecycle in their report timeline as the operational teams.

**Exit criteria:** Barangay staff see only their own assignments, responders see only their assigned work, and an escalation appears in MDRRMO intake with the original report and full history.

### Phase 6 — Administration and shared operations

- Rebuild user/account administration, barangay verification, officer/unit readiness, command locations, hotlines, broadcasts, analytics, and weather/situational context where it supports incident response.
- Enforce least-privilege capabilities across master admin, admin, logistics, and dispatcher responsibilities.
- Remove evacuation-center screens and dashboard-only dependencies from routes and navigation; do not add replacement station features.
- Provide operational audit/history and useful empty/error states for incomplete configuration.

**Exit criteria:** Every included administrative tool has explicit role access, supports responsive interaction, and contains no evacuation-station workflow.

### Phase 7 — Data transition, hardening, and rollout

- Add forward-only migrations for any report, identity, lifecycle, or index changes; make them safe to apply to existing records.
- Reconcile legacy report sources and active barangay work into the canonical timeline without deleting history or creating duplicate active reports.
- Review backend auth/scope checks for list, detail, mutation, evidence, export, and realtime operations.
- Prepare a staged rollout: database compatibility, backend endpoints, web sessions/workspaces, then feature enablement and legacy cleanup.
- Complete role-by-role workflow review, responsive/accessibility review, security review, and operational handoff documentation.

**Exit criteria:** Legacy and new records coexist safely; every role follows its permitted workflow; unauthorized reads/writes are rejected server-side; the central system can be enabled without losing active work.

## Cross-phase acceptance criteria

- New emergency reports have one canonical record and enter MDRRMO centrally; no public resident destination selector offers direct barangay routing.
- **Not sure** is the initial category and remains **Not sure** in storage and views until an authorized operator changes it.
- Public/guest, resident, MDRRMO, barangay, and responder experiences all have explicit role-aware routes and useful mobile layouts.
- MDRRMO can assign reports to eligible barangays or dispatch municipal responders; barangays can work only assigned cases and escalate directly to MDRRMO.
- A report becomes accepted automatically when dispatched or assigned; responders have no separate accept action and can record the response crew from their own roster. MDRRMO and barangay crew rosters remain separate and jurisdiction-scoped.
- Residents can track only their own submissions; every report transition appears in one understandable timeline.
- Evidence, sockets, exports, and API mutations are scoped to the authenticated account and jurisdiction.
- Existing report history remains available, including emergency-to-barangay, community-to-barangay, direct MDRRMO, and barangay-escalated-to-MDRRMO origins.
- The rebuilt web dashboard contains no evacuation-station/center feature.

## Delivery notes

- Implement each phase as a reviewable set of changes on `main`, keeping migrations forward-compatible and isolating risky backend/data changes from visual work.
- The plan defines the target system; phase exit criteria must be met before dependent phases rely on that behavior.
- This plan does not authorize deletion of historical reports or database/mobile evacuation data.
