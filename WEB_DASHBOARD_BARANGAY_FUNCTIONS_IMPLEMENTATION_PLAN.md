# Barangay Web Dashboard Functions Implementation Plan

## Objective

Complete the barangay-facing web dashboard so every supported barangay role can perform its web-appropriate work from a browser. The plan covers barangay account administration, team management, barangay announcements/community posts, assistance requests, barangay reporting and analytics, and the existing incident workflow. It complements [WEB_DASHBOARD_CENTRAL_COMMAND_CENTER_REBUILD_PLAN.md](WEB_DASHBOARD_CENTRAL_COMMAND_CENTER_REBUILD_PLAN.md).

Evacuation stations/centers are explicitly out of scope. This plan does not remove or migrate unrelated mobile or database evacuation data.

## Current-state assessment

The backend already exposes many barangay operations in `backend/src/routes/barangay.ts`, including account/profile and location settings, hotline management, account requests, team CRUD, report statistics, incident assignment work, assistance requests, and barangay broadcasts. MDRRMO approval of barangay account requests is in `backend/src/routes/verification.ts`. These capabilities are not yet presented as a complete, connected barangay web workspace.

The current web dashboard has barangay access to the shared command center and incident pages, a responder workspace, and a limited resolved-history page for staff. The navigation does not yet provide a complete barangay administration workspace for account status, team, posts, assistance requests, analytics, profile/location/hotline settings, and submission/verification history. Some shared pages are MDRRMO-focused and should not be treated as a complete barangay implementation just because their route exists.

The first implementation step must validate current page/API coverage against the endpoints and role checks; it should extend existing workflows instead of duplicating them or creating new data models when current APIs are sufficient.

## Implementation checkpoint

Barangay web surfaces have now been added for administrator registration by email OTP, account-request/document status, profile and operational settings, team account management, barangay and MDRRMO announcements, responder/admin assistance requests, and barangay-scoped analytics. The dashboard navigation and route guards distinguish barangay accounts from MDRRMO accounts, and inactive barangay administrators are directed to the account-request workspace. A scoped hotline-settings read endpoint and team-member activation endpoint support the new screens; team deactivation remains non-destructive and cannot target an administrator or the signed-in administrator.

The implementation has not yet been build- or role-verified against a live database. Apply no new schema migration for these screens; the added routes use existing barangay tables. The remaining rollout work is to run the web build and review each workflow with active, inactive, and role-specific accounts, then check that the connected database contains the existing barangay assistance and public-broadcast tables.

## Scope and role boundaries

| Barangay role | Web capabilities to provide |
| --- | --- |
| Admin | Barangay overview; assigned and historical reports; barangay account request and activation status; team/member management; profile, command location, and hotlines; review and decide assistance requests; manage barangay announcements/posts; view barangay-scoped analytics. |
| Dispatcher | Assigned incident queue; local dispatch, status, escalation, and closure actions allowed by the API; view eligible barangay team members; review/decide assistance requests; read barangay and MDRRMO advisories. No account, profile, or team administration unless separately authorized. |
| Responder | Assigned response work; automatic acceptance on dispatch/assignment; maintain response crew using only the responder's own barangay roster; field notes/media and arrival/closure actions permitted by the API; submit and track own assistance requests; read advisories. |
| Staff | Barangay resolved-history access and the other read capabilities allowed by the API. If staff retains the current API permission to create/edit/pin/delete barangay posts, expose those actions consistently; otherwise tighten the API and UI together under an explicitly approved role policy. |

Backend authentication, active-account checks, role checks, and barangay scoping remain authoritative. UI route guards and hidden controls are usability measures only.

## Feature inventory and target outcome

| Function | Current implementation surface | Web-dashboard target |
| --- | --- | --- |
| Barangay incident operations | Shared web command center/reports and barangay endpoints for assigned reports, dispatch, crew, field updates, escalation, closure, and history | A role-scoped barangay incident workspace with clear assigned, active, escalated, and resolved views; preserve the central report lifecycle and history. |
| Account request and verification | Barangay account-request/document/status endpoints; MDRRMO verification routes and existing MDRRMO verification page | Barangay admin can prepare, submit, inspect, and resubmit a request; track approval, correction, rejection, deactivation, and activation state. MDRRMO reviews the same request from the existing verification workspace. |
| Team management | Barangay team list/responders/crew roster and admin CRUD endpoints | Admin-managed barangay roster with active state, role/designation, safe deactivation, and a separate responder crew picker. No municipal MDRRMO members in the barangay roster. |
| Profile, command location, and hotlines | Barangay profile, location, and hotline endpoints | Admin settings page with validated forms, saved-state feedback, map/location controls, and public hotline preview. Keep public hotline access independent from private account data. |
| Barangay posts and broadcasts | Barangay broadcast feed, create/edit/delete/pin, and MDRRMO repost endpoints | Barangay-scoped community/advisory board with media, draft/edit flows where supported, pinning, deletion confirmation, incoming MDRRMO posts, and repost attribution. |
| Assistance/resource requests | Responder create/edit/own-list/team action endpoints; admin/dispatcher list and decision endpoints; MDRRMO request coordination | Responder request composer and personal status list, linked to the incident when applicable; admin/dispatcher decision inbox with status, notes, and team acknowledgement. Preserve request source and decision history. |
| Barangay analytics | Barangay report-statistics endpoint, currently admin-scoped | Dedicated barangay-only analytics page with time filters and operational counts/trends; numbers must be derived from the barangay's own permitted data. |
| Staff read workspace | Resolved-history web page | Expand the read workspace with permitted announcements and useful report history/search without granting operational mutations. |

## Phased implementation

### Phase 0 — Capability and endpoint audit

- Inventory every barangay route, role gate, frontend API wrapper, dashboard page, mobile-only function, and relevant schema/table.
- Mark each capability as implemented in web, partially implemented in web, API-only, mobile-only, or out of scope.
- Confirm role policy for staff post management and any other mismatch between backend gates and intended barangay responsibilities.
- Confirm account-request states and transitions, report/assistance-request ownership, and which actions require an audit record.
- Record existing database migration requirements; do not add schema changes unless the audit identifies a concrete gap.

**Exit criteria:** A capability map identifies the exact page, API, roles, data scope, existing history behavior, and acceptance checks for each function.

### Phase 1 — Barangay navigation and workspace foundation

- Add barangay-specific navigation sections and landing routes for incidents, assistance, announcements, analytics, and administration/settings.
- Keep the active barangay name and account state visible so users can tell which jurisdiction they are working in.
- Apply role-aware navigation and direct-route guards for admin, dispatcher, responder, and staff accounts.
- Build reusable barangay page patterns: summary cards, scoped tables/lists, filters, forms, media preview, event history, confirmation dialogs, and loading/empty/error states.
- Keep resident, MDRRMO, barangay, and responder identity/session types distinct.

**Exit criteria:** Every barangay role has an appropriate landing page and cannot navigate into unauthorized barangay or MDRRMO-only pages.

### Phase 2 — Account, profile, location, and hotline administration

- Create a barangay admin account page showing current verification/activation state, submitted documents, correction requests, reviewer notes, and history.
- Support the API-backed account-request lifecycle: prepare/update request, submit required certificate/document, resubmit corrections, and request activation where available.
- Add profile/contact and command-location forms using the existing barangay APIs.
- Add hotline management with validation and a public-facing preview.
- Link MDRRMO account approval/rejection/correction actions to the same request identity and show the resulting state back to barangay admins.
- Explain inactive/pending states with the allowed next action instead of presenting broken operational pages.

**Exit criteria:** Barangay admins can complete the supported account and settings workflows in the browser and see accurate MDRRMO review state; other roles cannot mutate these settings.

### Phase 3 — Barangay team and responder roster

- Build team roster list, add/edit, activate/deactivate, role/designation, and contact workflows from existing endpoints.
- Show team availability and responder eligibility to admins/dispatchers where returned by the API.
- Keep crew selection separate from team administration: responders can only choose members in their own barangay roster for a response; MDRRMO crews remain municipal and separate.
- Preserve historical crew snapshots when a roster member is later deactivated or edited.
- Use safe deactivation instead of destructive deletion when a member is referenced by reports or historical responses; confirm existing API behavior before exposing deletion.

**Exit criteria:** Admin can maintain the barangay roster; dispatchers can see the authorized roster; responders can record an eligible barangay-only crew without exposing MDRRMO or other barangay members.

### Phase 4 — Barangay announcements and community posts

- Add a barangay board for current barangay posts and relevant MDRRMO broadcasts.
- Implement create/edit/pin/delete with existing media support and explicit confirmation for destructive actions.
- Clearly distinguish barangay-authored posts, original MDRRMO broadcasts, and barangay reposts; preserve source attribution and links.
- Confirm which post types are public and how deleted/expired posts behave before changing persistence or adding a draft state.
- Reconcile the staff post permissions from Phase 0 so the UI and API enforce one policy.

**Exit criteria:** Authorized barangay accounts can manage their own posts, read applicable MDRRMO broadcasts, and repost them without changing or misattributing the original source.

### Phase 5 — Assistance request workflows

- Add a responder request form for manpower, equipment, supplies, or other currently supported assistance, optionally linked to an assigned incident.
- Add a responder “My requests” list with decision status, dispatcher notes, timestamps, and permitted edits/team acknowledgement actions.
- Add an admin/dispatcher inbox with filters for pending/decided requests, incident context, requester, requested resources, and decision history.
- Support approve/coordinate, reject, or other statuses only where the backend contract allows; require a note when policy or API validation requires it.
- Link barangay requests that need MDRRMO support to the central request/incident view without making a second incident record.
- Provide realtime refresh only through authenticated, barangay-scoped channels; retain polling/manual refresh fallback.

**Exit criteria:** A responder can submit and follow a request, an authorized dispatcher/admin can make a traceable decision, and related MDRRMO coordination retains the original barangay request and incident link.

### Phase 6 — Barangay analytics and operational history

- Build a barangay-only analytics view using the existing statistics endpoint where sufficient.
- Provide date-range filters and clearly defined counts for assigned, active, resolved, escalated, and assistance-request outcomes where reliable source data exists.
- Add trend charts and downloadable summaries only if the API provides scoped aggregation and any export policy is defined; do not calculate global totals in the browser from records the user should not see.
- Improve the staff history page with search/filter and report detail/timeline access that respects staff read permissions.
- Label gaps in older records instead of inventing timestamps, categories, or outcomes.

**Exit criteria:** A barangay user sees only their barangay's permitted metrics and history, with totals that match the underlying records and filters.

### Phase 7 — Integration, authorization review, and rollout

- Wire each page to the existing API first; add a versioned backend endpoint or forward-only migration only where Phase 0 documented a real gap.
- Review each list, detail, mutation, media, export, and realtime path for barangay scoping and least privilege.
- Verify direct URL access, expired/deactivated accounts, pending verification, and cross-barangay identifiers are handled safely.
- Review mobile and responsive layout, keyboard operation, labels, contrast, and success/error feedback.
- Roll out in order: backend compatibility, admin/settings and roster, announcements and assistance, analytics, then role-by-role enablement.
- Document how to apply required migrations and how to roll forward if an endpoint fails; do not silently delete or rewrite historical posts, requests, reports, or crew snapshots.

**Exit criteria:** All in-scope barangay functions have usable web flows for their authorized roles, backend checks enforce the same scopes, and historical barangay data remains intact.

## Cross-feature acceptance criteria

- A barangay account can only view and modify records for its authenticated `barangay_id`.
- Admin, dispatcher, responder, and staff see different actions according to the confirmed capability matrix.
- Barangay responders never select MDRRMO or another barangay's crew members; MDRRMO and barangay crew rosters remain separate.
- Dispatch/assignment automatically starts response work as accepted; no manual responder acceptance is introduced.
- Barangay announcements and MDRRMO broadcasts keep their authorship, repost attribution, visibility, and media association.
- Assistance requests remain linked to their original requester and incident; decisions and coordination preserve audit history.
- Account verification and activation status shown in the dashboard matches the MDRRMO review record.
- Analytics are jurisdiction-scoped and do not infer missing historical data.
- No evacuation-center/station page, route, navigation item, or replacement station workflow is added.

## Delivery guidance

Implement this plan in small, reviewable phases on the current `main` branch, coordinating the incident workspace with the central command-center plan. Avoid a second barangay incident queue if the shared command center already covers the same assigned reports. Keep the web dashboard aligned with the existing mobile/API workflows while making backend authorization the final authority.
