# MDRRMO dispatch implementation plan

## Goal

Dispatch an incident from the web Command Center to the selected active MDRRMO responder, persist the assignment and dispatcher notes, and make the assignment available in the mobile responder app. A failed request must not hide a dispatch that the database already committed.

## Findings

- Production dashboard `https://norz-agapay.vercel.app/` serves a bundle that sends `POST` to `https://norzagapay-backend.onrender.com/api/mdrrmo/reports/{id}/dispatch`. CORS preflight allows POST. The previous GET/client-version failure is resolved.
- The user now observes HTTP 500 for that POST. The browser console only contains Axios' generic rejection; it does not include the API response body or identify whether the report was committed.
- The backend runs validation, active-unit roster checks, responder loading, the transactional `dispatch_mdrrmo_report_v2` RPC, report/assignment readback, and socket notifications. Previously, any post-RPC readback failure returned 500 even after the RPC had committed the dispatch.
- The local workspace has no Supabase URL/service-role credentials, so I cannot inspect production report state or database logs from this machine. I have not retried or mutated the live report.

## Implementation

1. Keep dispatch as authenticated POST; retain PATCH compatibility and reject GET without a write. **Implemented and confirmed in the production dashboard bundle.**
2. Keep escalation notes (`coordination_notes`) separate from dispatcher notes (`dispatch_notes`). **Already implemented in the dispatch path.**
3. Treat the RPC transaction as the commit boundary. Build a fallback success payload immediately after it commits, and keep subsequent database readback and socket delivery failures from returning a misleading 500. **Implemented in `backend/src/routes/mdrrmoReports.ts`.**
4. Return a safe diagnostic `stage` and database `cause_code` for failures before commit; map missing/stale database objects to a 503 with the migration name. **Implemented.**
5. Show the response stage and cause code in the dashboard dispatch error toast. **Implemented in Command Center and Reports; production dashboard build passes.**
6. Build and publish the backend changes. **Backend TypeScript build passes; commit `2a8a9d9` was pushed to `main`. Render health responds, but its public health endpoint does not identify the running revision.**
7. After Render serves the new backend, inspect the report and mobile queue before retrying. If not assigned, make one authenticated dispatch attempt and use the displayed `stage`/`cause_code` to fix any remaining pre-commit failure. **Pending production state and authenticated evidence.**
8. Confirm the mobile Team Leader receives the incident and can accept with a Driver Responder and First Aider in the selected unit. Confirm dispatcher notes and escalation notes remain separate. **Pending end-to-end verification.**

## Acceptance criteria

- Command Center sends authenticated POST and the route persists one assignment per selected responder.
- A response/readback/realtime failure after the database commit does not present as a failed dispatch.
- A pre-commit failure has a stage-specific diagnosis and does not claim success.
- The mobile Team Leader sees and accepts the assignment; dispatcher notes remain separate from escalation notes.
