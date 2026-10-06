# Real-Time Incident Lifecycle Implementation Plan

## Goal

Make the complete incident lifecycle visible to the resident, barangay/MDRRMO operators, responders, and dashboard as soon as each change is durably committed. The connected path must not wait for polling intervals or media uploads before an operational queue is notified.

Literal zero network delay cannot be guaranteed across mobile radios, internet links, servers, and push delivery. The strict target is therefore **no intentional online polling wait**, with measured end-to-end delivery objectives below. HTTP/database state remains authoritative; socket events make committed state visible quickly, and reconnect catch-up repairs missed events.

## Lifecycle in Scope

1. Resident submits an incident and receives a durable report ID and acknowledgment.
2. The appropriate barangay or MDRRMO queue receives the new report.
3. An operator reviews, verifies, assigns, dispatches, or rejects the report.
4. Responders receive assignments and publish accepted, en-route, on-scene, and resolution updates.
5. The resident, operator queues, responder views, and dashboard show the same ordered status history through closure.

### Explicit actor coverage

| Actor | Real-time responsibilities |
| --- | --- |
| Resident | Submit a report; see acknowledgment, review/verification, rejection, assignment/dispatch, responder progress, evidence state, and resolution. |
| Barangay dispatcher | Receive reports routed to their barangay; review and assign/dispatch local responders; see responder progress and closure. |
| Barangay responder | Receive local assignments; publish accepted, en-route, on-scene, resolved, and return/available stages as supported by the agreed transition model. |
| MDRRMO dispatcher | Receive reports routed or escalated to command; review, coordinate, assign/dispatch MDRRMO responders, and see field progress and closure. |
| MDRRMO responder | Receive command-level assignments; publish accepted, en-route, on-scene, resolved, and return/available stages as supported by the agreed transition model. |

The server must route each event according to report jurisdiction, escalation/assignment state, and authenticated role membership. Barangay and MDRRMO responders are separate audiences; a responder in one group must not receive the other's assignments unless explicitly assigned through an authorized cross-agency workflow.

## Current-State Audit

- **Resident status is polling-based.** `resident_app/lib/screens/main_navigation_screen.dart` calls the resident reports endpoint on a five-second timer. The resident app has no Socket.IO client dependency, and `resident_app/lib/services/report_updates_service.dart` is only an in-process notifier. A status change can therefore sit unseen for almost five seconds plus request latency.
- **Report submission has work before operational notification.** `resident_app/lib/screens/reporting_screen.dart` waits for location and sends a multipart request. In `backend/src/routes/incidentReports.ts`, evidence files are uploaded sequentially before the incident is inserted. After insertion, timing estimation and optional task creation are awaited before the main incident event is emitted. The resident only receives the HTTP acknowledgment after this work completes.
- **Lifecycle delivery is scattered.** Backend routes in `incidentReports.ts`, `barangay.ts`, `mdrrmoReports.ts`, and `tasks.ts` emit several event names with inconsistent audiences. Some events are emitted globally with report payloads, while close/update paths do not consistently notify the reporter room.
- **Socket delivery is not durable.** Events are emitted directly after database operations. If the process stops or the socket is disconnected between commit and emit, clients have no event replay path. No transactional outbox or lifecycle revision/cursor was found.
- **Operations clients use sockets, but reconnect recovery is incomplete.** The barangay and MDRRMO Flutter clients subscribe to lifecycle events, but there is no consistent authoritative catch-up on every reconnect. MDRRMO report socket ownership is tied to the reports screen. The web Reports page handles updates but does not subscribe to the new-report event; responder tracking also has a 30-second refresh timer.
- **Automated end-to-end coverage is missing.** There is no wired lifecycle E2E test or event-latency measurement suite covering resident-to-dispatch-to-resolution. Existing tests are mostly sample/widget or manual scripts.

These findings are from static code inspection. No live incident was created or closed as part of this audit.

## Required Delivery Contract

### Latency objectives

Measure from durable database commit to the relevant connected client rendering the new revision:

| Path | Objective |
| --- | --- |
| New report visible in the correct operator queue | p95 ≤ 1 second; p99 ≤ 2 seconds |
| Status/assignment/resolution visible to authorized connected clients | p95 ≤ 1 second; p99 ≤ 2 seconds |
| Missed lifecycle changes reconciled after reconnect | within 2 seconds of authenticated reconnect |
| Intentional polling wait while online and connected | 0 seconds |

Track server commit-to-outbox, outbox-to-socket, socket-to-client-apply, and client render separately. Report creation timing starts when the core report is durably accepted; pre-submit location capture and user media selection are outside the push-delivery SLO. Upload time must be displayed separately and must never be hidden as server “thinking”.

### Event and recovery contract

- Define a versioned canonical lifecycle event, for example `incident.lifecycle.v1`, with `event_id`, `report_id`, monotonically increasing `revision`, `event_type`, status/stage, actor, server `occurred_at`, and a minimal state delta.
- Persist the event and the corresponding state change atomically. Use a database transaction/RPC and an `incident_event_outbox`; a retrying relay publishes pending events to Socket.IO and marks them delivered. Delivery is at-least-once, so clients deduplicate by `event_id` and apply only newer revisions.
- Expose an authenticated snapshot/catch-up API with `since_revision` (or cursor). On connect/reconnect, clients rejoin authorized rooms and fetch changes since their last applied revision; if the cursor is expired or has a gap, fetch the full current report snapshot and timeline.
- Make commands idempotent with a client request key and optimistic concurrency/revision checks. A retry must not create a duplicate incident, assignment, or resolution.
- Keep a durable, append-only incident timeline so every accepted, assigned, dispatched, responder-stage, and resolution change is auditable and replayable.

### Audience and privacy contract

- Replace broad `io.emit` report payloads with authorized recipient rooms: the relevant barangay, command-center role, assigned responder users, and the reporting resident as appropriate.
- Derive identity and room membership on the server from the authenticated token and current database membership. Clients must not select arbitrary recipient rooms.
- Send minimal event data and let clients fetch authorized details. Never broadcast resident contact details, evidence URLs, or full report objects to global or unrelated rooms.
- Apply the same reporter notification rule to barangay and MDRRMO transitions, including rejection, assignment, closure, and resolution.

## Implementation Phases

### Phase 1 — Specify the canonical lifecycle and establish a baseline

1. Map existing status fields and transitions across `incident_reports`, MDRRMO assignments/tasks, barangay reports, and responder stages. Document a single allowed transition table and identify duplicate or contradictory status sources.
2. Agree on lifecycle semantics and client-visible labels, including the distinction between incident resolved and responder returned/available.
3. Add correlation IDs and timestamps for request accepted, database commit, event queued, socket published, client received, and client rendered. Record event revision and audience type without logging sensitive report data.
4. Build a staging-only synthetic lifecycle fixture and capture baseline latency and lost-update behavior.

**Exit:** every lifecycle action has one owner, one canonical state transition, one audience rule, and baseline measurements.

### Phase 2 — Make backend transitions atomic and events durable

1. Implement the lifecycle event schema, revision counter, outbox table, and transactional transition functions/RPCs.
2. Route create, review, assignment, dispatch, responder stage, rejection, and close/resolve commands through the canonical transition service. Update related report and assignment records in the same transaction where they represent one action.
3. Start an outbox relay with retry/backoff, duplicate-safe delivery, health metrics, and alerts for oldest pending event and failed delivery age.
4. Consolidate route-specific Socket.IO event names behind the canonical event publisher. Keep temporary compatibility adapters only during migration.
5. Remove global report payload broadcasts and enforce scoped room membership on all lifecycle events.
6. Return the report ID, committed revision, and accepted state as soon as the core transaction succeeds. Move expensive SLA/timing analytics and non-critical task side effects off the request-critical path.

**Exit:** every committed lifecycle state has a durable event, retries cannot duplicate the state transition, and unauthorized rooms receive no report content.

### Phase 3 — Decouple evidence upload from urgent intake

1. Commit the report's core fields first with an explicit evidence state (`pending`, `ready`, or `failed`) and stable upload session identifiers.
2. Notify the correct operations queue immediately after that core commit. Upload evidence directly/resumably or through background workers, preferably in parallel rather than sequentially.
3. Publish evidence-ready/failed changes through the same lifecycle stream and show clear upload progress to the resident.
4. Confirm the operating policy for whether triage/dispatch may begin while evidence is pending. If evidence is mandatory for a later verification step, enforce that at that step while still showing the queue the newly received report.
5. Preserve the existing requirement for evidence if policy requires it, but do not make large file transfer the hidden delay before an emergency report enters the queue.

**Exit:** a slow or failed attachment transfer cannot silently delay or erase the core incident alert, and upload state is visible and recoverable.

### Phase 4 — Replace resident polling with push plus catch-up

1. Add the maintained Socket.IO Flutter client dependency and a resident-session socket service using the existing authenticated token flow.
2. Join only the authenticated resident's server-authorized user room; subscribe to the canonical lifecycle stream for that resident's reports.
3. Replace the five-second timer in `main_navigation_screen.dart` with event-driven updates. Keep snapshot fetch on screen entry and pull-to-refresh; use reconnect catch-up as the automatic recovery path.
4. Apply events idempotently by report revision to My Reports and Report Detail. Show pending/sending/accepted states distinctly so an optimistic UI never claims a report was durably received before the API confirms it.
5. Handle app foreground/background transitions and socket reconnect without requiring the resident to reopen the screen.

**Exit:** with a healthy connection, resident status updates do not wait for a timer; offline changes reconcile automatically on reconnect.

### Phase 5 — Complete operations and dashboard subscriptions

1. Move socket lifetime to the authenticated app session for barangay and MDRRMO clients rather than tying core delivery to a particular screen.
2. Rejoin all authorized rooms on every connection and perform cursor catch-up before marking lifecycle data current.
3. Update Flutter reports, assignments, responder views, and dashboard Reports/Command Center/Responder Tracker to consume the canonical event and revision. Ensure new-report events insert records into the Reports page without a page revisit.
4. Remove recurring refresh timers that exist only to hide missed event delivery after the push path and recovery path pass acceptance; retain explicit user refresh controls.
5. Show a visible stale/offline indicator when the device cannot meet the live delivery contract.

**Exit:** all operational clients converge on the same revision and stage without relying on periodic refresh while online.

### Phase 6 — Strict verification, rollout, and cleanup

1. Add backend integration and cross-client E2E tests for every transition from report creation through resolution, with synthetic staging accounts only.
2. Exercise duplicate/out-of-order events, process restart after commit, relay retry, lost socket during transition, reconnect with missed revisions, expired cursor, app backgrounding, upload failure, and API retry.
3. Measure p50/p95/p99 commit-to-render latency under representative concurrent load and poor mobile-network conditions. Fail the release gate if p95 or p99 targets are missed or a lifecycle event is lost after reconnect.
4. Test all five actor paths above end to end, then test cross-barangay, unrelated resident, unassigned responder, barangay/MDRRMO audience separation, and non-command-center access; assert both room join and event payload are denied where unauthorized.
5. Roll out to staging, then a small authorized pilot group, then all users. Monitor latency, outbox backlog, reconnect catch-up, duplicate count, and event delivery errors.
6. Remove legacy polling and compatibility event handlers after the rollout is stable and dashboards confirm they are unused.

**Exit:** latency, recovery, consistency, and authorization gates all pass in staging and pilot before broad rollout.

## Acceptance Criteria

- No periodic timer is responsible for online incident-status freshness in any client.
- Every accepted command returns a durable ID/revision; every committed transition creates exactly one logical timeline entry.
- A connected, authorized recipient renders each committed revision within p95 1 second and p99 2 seconds in the staging load test.
- A recipient that was offline receives every missed transition or a current authoritative snapshot within 2 seconds after reconnect; duplicate delivery does not duplicate timeline entries or regress state.
- Resident, barangay dispatcher, barangay responder, MDRRMO dispatcher, and MDRRMO responder paths each pass the lifecycle E2E checks. Each receives the transitions for which it is authorized, and neither responder group receives an unassigned incident from the other group's audience.
- Core report queue notification is not blocked by sequential evidence upload, historical timing estimates, or non-critical secondary side effects.
- Outbox backlog age, commit-to-publish latency, publish failures, client event-apply latency, and reconnect catch-up latency are observable and alertable.
- Authorization tests prove unrelated users and jurisdictions cannot subscribe to or receive report details.

## Dependencies and Decisions

- Confirm policy for triage/dispatch while evidence is pending.
- Choose the database transaction/RPC implementation supported by the current Supabase/Postgres setup and confirm how the outbox relay is deployed and supervised.
- Confirm the operational definition of “resolved” versus responder return/available, then freeze the transition table before client migration.
- Decide whether existing API response/status names require a compatibility window for older installed app versions.

## Implementation Status — 2026-10-06

### Implemented in the workspace

- Added the lifecycle revision, idempotent client request ID, evidence state, and transactional event outbox migration. The backend relay listens to Postgres Changes for immediate dispatch and keeps a 30-second recovery sweep for relay recovery.
- Added authenticated and role-scoped socket rooms, validated responder status updates, and scoped lifecycle envelopes. Report creation acknowledges the durable report before optional evidence uploads and secondary work; evidence uploads use an idempotent retry queue in the resident app.
- Replaced resident status polling with lifecycle socket updates and reconnect/foreground snapshots. Barangay, MDRRMO, dashboard reports, command center, and responder tracker consume lifecycle updates and refresh authoritative state on reconnect.
- Added lifecycle revisions to client models so stale responses do not overwrite newer socket updates. Existing incident/task socket handlers were retained and access-checked.

### Validation performed

- Backend TypeScript build: passed.
- Web dashboard production build: passed (existing large-chunk warning).
- Resident and operations Android debug APK builds: passed and installed on the Android 15 emulator; both app processes remained alive after launch, with no AndroidRuntime/flutter error logs in the smoke check.
- Flutter analysis reported lint/info warnings (35 resident-app issues and 235 operations-app issues) but no Dart compile errors; both APK builds completed.
- `git diff --check`: passed; Git only reported line-ending normalization notices.

### Still required before a live lifecycle acceptance test

- Apply `database/migrations/incident_lifecycle_realtime_migration.sql` to the target Supabase database and restart/deploy the backend relay. The migration has not been applied to a live database from this workspace.
- Run staging integration tests using synthetic accounts for all five actors, including reconnect recovery, authorization isolation, evidence retry, and incident resolution. No real incident was created; commit-to-render latency percentiles have not been measured.
- The implementation removes intentional online polling waits, but absolute zero network delay is not guaranteed. The plan's p95/p99 acceptance targets remain unverified until staging measurement.

## Suggested Delivery Order

Backend transition contract and observability → durable outbox and secure rooms → evidence decoupling → resident push/recovery → barangay/MDRRMO and web migration → strict staging E2E and latency gates → staged rollout and removal of polling.
