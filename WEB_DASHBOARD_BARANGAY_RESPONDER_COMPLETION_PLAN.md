# Barangay Responder Web Dashboard Completion Plan

## Objective

Make the Barangay Responder experience clear and complete in the web dashboard, while reusing the existing responder workspace and barangay APIs. The responder must land on a useful, barangay-scoped view of assigned work and reach permitted support tools without seeing dispatcher or administrator controls.

## Current-state audit

The Barangay Responder is already partially supported in the web dashboard:

- `web-dashboard/src/App.tsx` includes barangay responders in the dashboard access check, routes `/my-responses` to `ResponderWorkspacePage`, and sends barangay responders there after login.
- `web-dashboard/src/pages/ResponderWorkspacePage.tsx` detects `account_kind === 'barangay'` and loads barangay reports and the barangay crew roster. It supports assigned-work status, crew selection on eligible central assignments, arrival, field media, and resolution actions.
- `web-dashboard/src/pages/BarangayAssistancePage.tsx` lets responders create and follow their own assistance requests.
- Barangay board and team pages/routes are already available to responders; team management controls are hidden for non-admin roles.
- `backend/src/routes/barangay.ts` has responder-only role gates for crew-roster and field actions. The barangay report endpoint scopes data to the authenticated barangay and filters responder results to work assigned to that responder.

The main gap is presentation and cohesion: responders land directly in a shared “My responses” workspace, and responder-facing tools are spread across role-filtered navigation. The dashboard should make its barangay-responder context, assignment status, and permitted next actions obvious. The existing broad plans remain relevant: `WEB_DASHBOARD_BARANGAY_FUNCTIONS_IMPLEMENTATION_PLAN.md` and `WEB_DASHBOARD_CENTRAL_COMMAND_CENTER_REBUILD_PLAN.md`.

## Recommended target

Keep `/my-responses` as the Barangay Responder landing route. Extend it into a responder-focused home/workspace instead of creating a second incident queue. Keep MDRRMO responders on the existing MDRRMO version of the same route, selected by `account_kind`.

### Barangay Responder capability map

| Area | Barangay Responder access |
| --- | --- |
| My responses | View only assignments for the signed-in responder in their barangay; update permitted field-response actions. |
| Assistance requests | Submit and follow own requests; edit, cancel, and acknowledge only where the current API permits. |
| Barangay board | Read barangay and permitted MDRRMO posts; no dispatcher/admin-only post management unless explicitly authorized. |
| Barangay team | Read the own-barangay roster only; no account creation, editing, activation, or deactivation. |
| Dispatcher/admin workspaces | No access to incident dispatch queues, assistance decision inboxes, analytics, or account settings outside the responder's permitted profile functions. |

## Phased implementation

### Phase 0 — Confirm capability and access boundaries

- Compare responder web flows, API role checks, account activation rules, and mobile responder behavior.
- Confirm which report statuses the responder can change, which central assignments allow crew selection, and the exact rules for arrival, media upload, resolution, assistance request editing/cancellation, and team acknowledgement.
- Verify that direct URLs and API identifiers cannot expose another responder's work, another barangay's roster, or dispatcher/admin actions.
- Record any behavior already implemented so later phases extend it instead of duplicating it.

**Exit criteria:** A signed-off capability matrix distinguishes Barangay Responder from MDRRMO Responder, Barangay Dispatcher, and Barangay Admin.

### Phase 1 — Responder landing and navigation

- Keep the responder post-login destination at `/my-responses` and clearly label the workspace as a barangay response workspace, including the barangay name.
- Organize the responder sidebar around operational tasks: **My Responses** under Incident Monitoring; **Assistance Requests**, **Barangay Board**, and read-only **Barangay Team** under an operations section.
- Remove or hide dispatcher/admin sections and ensure the selected navigation item matches nested responder pages.
- Add clear links between My Responses and the responder's assistance requests and board.

**Exit criteria:** A responder can identify their barangay context and reach each permitted page from the sidebar; direct navigation to restricted routes returns them to an authorized page.

### Phase 2 — Assigned incident workspace

- Refine the current workspace with distinct active and resolved counts and filters, clear assignment/response states, and an actionable empty state.
- Keep assignment lists scoped to the signed-in responder and preserve report/assignment history.
- Make each assignment's location, incident details, current state, and allowed next action easy to scan on desktop and mobile.
- Preserve automatic acceptance on dispatch/assignment; do not add a manual accept step.

**Exit criteria:** Responders can find active and completed assignments quickly and do not see unassigned barangay or municipality-wide incidents.

### Phase 3 — Field response actions

- Confirm and polish the existing crew selection, arrival recording, field media upload, and resolution-summary actions.
- Clearly explain why an action is unavailable, such as a response not yet being in a state that permits arrival or resolution.
- Prevent duplicate submissions while a mutation is pending and show the saved status after refresh or live update.
- Preserve the separation between barangay crew records and MDRRMO responder/unit rosters.

**Exit criteria:** Each permitted field action is visible only in the correct assignment state, saved to the correct barangay assignment, and reflected in the response history.

### Phase 4 — Supporting responder tools

- Polish the existing personal assistance-request form and history, including linked active assignments, decision notes, and permitted request actions.
- Keep request decision controls exclusive to dispatcher/admin roles.
- Keep the barangay board readable and scoped; show author/source clearly and hide actions the responder cannot perform.
- Keep the team page read-only for responders and return only their own barangay roster/contact details.

**Exit criteria:** Responders can request/follow support and access relevant community information without gaining team, post, or request-management privileges.

### Phase 5 — Authorization, realtime, accessibility, and responsive review

- Recheck every read and mutation against the authenticated barangay ID and responder ID on the server; frontend hiding is not an authorization boundary.
- Confirm authenticated socket events refresh only the intended responder or barangay data.
- Review keyboard navigation, accessible labels, error/loading/empty states, and mobile field-action layouts.
- Ensure account deactivation or coordination changes immediately prevent further dashboard/API access as intended.

**Exit criteria:** No cross-responder or cross-barangay data is exposed, and responder workflows remain usable on supported desktop and mobile browser sizes.

### Phase 6 — Verification and rollout

- Build the web dashboard and run the agreed lint/type checks.
- Verify with separate accounts for a Barangay Responder, MDRRMO Responder, Barangay Dispatcher, and Barangay Admin.
- Test an assigned barangay incident through arrival, media upload, and resolution; test assistance request submission and status updates.
- Test empty assignments, inactive/unverified accounts, stale sessions, direct unauthorized URLs, and cross-barangay IDs.
- Update the README role matrix and this plan's implementation checkpoint after the work ships.

**Exit criteria:** The role matrix passes, all responder actions match backend permissions, and no duplicate responder queue or data model is introduced.

## Likely implementation files

- `web-dashboard/src/App.tsx` — role guards and landing route.
- `web-dashboard/src/components/DashboardLayout.tsx` — responder-specific sidebar groups and active states.
- `web-dashboard/src/pages/ResponderWorkspacePage.tsx` — responder home, assignment filters, and field actions.
- `web-dashboard/src/pages/BarangayAssistancePage.tsx` — personal request workflow and role-specific controls.
- `web-dashboard/src/pages/BarangayBoardPage.tsx` and `BarangayTeamPage.tsx` — responder read-only affordances.
- `web-dashboard/src/index.css` — responsive workspace and navigation styling.
- `backend/src/routes/barangay.ts` — source-of-truth role and barangay scope checks; modify only for a verified API gap.
- `README.md` — role/access matrix and web capability description.

## Out of scope

- Rebuilding responder authentication or creating a second account type; `account_kind: 'barangay'` plus `role: 'responder'` already identifies this user.
- Replacing the existing `/my-responses` workflow with a duplicate incident queue.
- Granting responder dispatch, account administration, analytics, or another barangay's data access.
- Database migrations unless Phase 0 finds a concrete missing capability that cannot be supported by the current schema/API.
