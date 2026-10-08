# MDRRMO dispatch implementation plan

## Goal

Dispatch an incident from the web Command Center to the selected active MDRRMO responder, persist the assignment and dispatcher notes, and make the assignment available in the mobile responder app. A failed request must not hide a dispatch that the database already committed.

## Findings

- Production dashboard `https://norz-agapay.vercel.app/` and the user-pasted bundle both show `dispatchToMdrrmo` calling `POST` to `https://norzagapay-backend.onrender.com/api/mdrrmo/reports/{id}/dispatch`. The newest diagnostic toast is from the POST handler at `persist_dispatch`, so the prior GET error is superseded for this failed attempt.
- The user first reported Axios' generic 500, then supplied the dashboard toast `Stage: persist_dispatch · Code: 23503`, identifying a database foreign-key failure inside the dispatch RPC.
- The backend runs validation, active-unit roster checks, responder loading, the transactional `dispatch_mdrrmo_report_v2` RPC, report/assignment readback, and socket notifications. Previously, any post-RPC readback failure returned 500 even after the RPC had committed the dispatch.
- The local workspace has no Supabase URL/service-role credentials, so I cannot inspect production report state or database logs from this machine. I have not retried or mutated the live report.
- The user supplied the dashboard error `Stage: persist_dispatch · Code: 23503`. PostgreSQL `23503` is a foreign-key violation. The source schema confirms `mdrrmo_report_assignments.report_id` was originally linked to legacy `incident_reports`, while `dispatch_mdrrmo_report_v2` inserts canonical `mdrrmo_reports` IDs. The full schema has a correction, but the standalone migration was missing from `database/migrations`.

## Implementation

1. Keep dispatch as authenticated POST; retain PATCH compatibility and reject GET without a write. **Implemented and confirmed in the production dashboard bundle.**
2. Keep escalation notes (`coordination_notes`) separate from dispatcher notes (`dispatch_notes`). **Already implemented in the dispatch path.**
3. Treat the RPC transaction as the commit boundary. Build a fallback success payload immediately after it commits, and keep subsequent database readback and socket delivery failures from returning a misleading 500. **Implemented in `backend/src/routes/mdrrmoReports.ts`.**
4. Return a safe diagnostic `stage` and database `cause_code` for failures before commit; map missing/stale database objects to a 503 with the migration name. **Implemented.**
5. Show the response stage and cause code in the dashboard dispatch error toast. **Implemented in Command Center and Reports; production dashboard build passes.**
6. Build and publish backend/dashboard changes. **Both builds pass; the earlier handler/diagnostic changes are pushed and the Vercel bundle was confirmed live. The current specific FK mapping and migration are prepared for publish.**
7. Make both Command Center dispatch entry buttons explicitly `type="button"`. **Implemented; dashboard build passes.**
8. Apply the canonical report foreign-key migration in Supabase. **Migration added; no Supabase session or database credentials are available in this workspace, so production database application is pending.**
9. Inspect the report and mobile queue before retrying. After applying the migration, dispatch once if the report is still pending. **Pending production state and authenticated evidence.**
10. Confirm the mobile Team Leader receives the incident and can accept with a Driver Responder and First Aider in the selected unit. Confirm dispatcher notes and escalation notes remain separate. **Pending end-to-end verification.**

## Acceptance criteria

- Command Center sends authenticated POST and the route persists one assignment per selected responder.
- A response/readback/realtime failure after the database commit does not present as a failed dispatch.
- A pre-commit failure has a stage-specific diagnosis and does not claim success.
- The mobile Team Leader sees and accepts the assignment; dispatcher notes remain separate from escalation notes.
