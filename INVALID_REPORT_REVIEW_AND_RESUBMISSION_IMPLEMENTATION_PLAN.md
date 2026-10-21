# Invalid Report Review and Resubmission Implementation Plan

## Goal

Let MDRRMO dispatchers review a questionable report as **Inconclusive** or **False Reporter**. An assigned responder can mark their incident **False Reporter** only, including after arrival if the incident has not been resolved. Show the decision to the reporter, allow the reporter to correct and resubmit the same report, and restore it to the MDRRMO queue with a fresh notification. Keep resident-account and guest identities distinct even when their phone numbers match.

The attached image is the visual reference for the initial “Why is Resident’s Report Invalid?” choice dialog. The reason field and confirmation steps below extend that flow.

## Current implementation findings

- The Command Center already has an invalid-review choice dialog and a separate reason-entry step for inconclusive reviews. Choosing False Reporter currently submits immediately. The Reports queue has a separate browser `confirm()` action that only submits a false-report review, so the two dispatcher entry points do not share one consistent flow.
- `PATCH /api/incident-reports/:id/review` calls `review_incident_report`. The current database function changes the report to rejected, requires a reason for inconclusive reviews, and permits false-report decisions only for reports with `reporter_type = 'resident'`. It increments `resident_user.false_report_count` and deactivates a resident account at three marks.
- MDRRMO visibility filters out every report with a `review_outcome`, so an inconclusive report currently disappears instead of remaining visible with the requested white marker and black icon. False-report reports are also hidden, which matches the requested map behavior.
- Resident report history and guest report tracking already display a closed-after-review state and the inconclusive reason. Neither surface currently provides a structured edit-and-resubmit flow.
- `PATCH /api/incident-reports/:id` updates report text and evidence, but does not enforce reporter ownership or implement the reviewed-report resubmission lifecycle. Do not use it as the resubmission endpoint without adding those protections.
- Report data distinguishes `reporter_type`, `reporter_id`, and `reporter_phone`. Guest tracking verifies the report ID and phone. Preserve that distinction: a resident account is identified by its account ID; a guest is identified by its report and normalized phone. A shared phone number must not merge a guest report into an account’s reports or review counter.
- The review route currently emits dispatcher updates and a resident socket event. Guest tracking has its own authorized socket room, and new reports use `incident_report:new` to notify dispatchers. Resubmission must notify both the right reporter channel and the MDRRMO queue again.
- Responder workspaces do not currently expose an invalid-report action. The review API only authorizes admin/dispatcher roles and only accepts pending reports.
- The existing review RPC is part of the larger database schema, while report lists and map views read the `mdrrmo_reports` and `barangay_reports` tables. Confirm and preserve one authoritative, transactional review state across the canonical report row and any paired copy.

## Behavior and interaction

1. Clicking **Invalid Report** opens the choice dialog shown in the image.
2. Choosing **Inconclusive** opens a confirmation modal first. After confirmation, show a required reason textarea in the review dialog. The reason is saved with the decision and displayed to the reporter.
3. Choosing **False Reporter** opens a confirmation modal before saving. The confirmation explains that the report will be marked false and hidden from the dispatcher map until the reporter resubmits it.
4. Keep a report marked inconclusive visible on the MDRRMO map with a white marker and black icon. It remains unavailable for dispatch until it is resubmitted. Show its inconclusive status and reason in signed-in resident reports and guest tracking.
5. Hide a report marked false reporter from the MDRRMO map and normal pending queue. Keep it accessible to its owner in resident report history or guest tracking, with the reason/status and a **Edit and resubmit** action.
6. Let the owner correct the same report, including its structured incident details, location, and evidence, then resubmit it. On success, clear the active review state, set it back to pending, show the normal marker, and send a new dispatcher notification.
7. Let an assigned responder mark their incident **False Reporter** while the assignment is active, including while responding/en route and after arrival, up until the incident is resolved or closed. Do not offer Inconclusive to responders. If the responder marks it false, close the active assignment transactionally and preserve any arrival history so no response remains active against a hidden report.

## Implementation plan

### 1. Define review and identity state

- Treat each review or resubmission as a report lifecycle cycle. Keep the latest `review_outcome` and `review_reason` on the report for current UI state, and add durable review history so a later resubmission does not erase who marked the report or why.
- Track repeat false marks on the report across resubmission cycles. Increment the visible count each time that same report is marked false again; reset/close the active count when its resubmitted report is successfully dispatched or a responder begins responding. Preserve the existing resident account strike count and three-mark account enforcement as a separate cumulative control.
- Support false-report reviews for guests without requiring a resident account. Scope guest tracking to `reporter_type = 'guest'` plus the normalized phone for that report. Scope account reports to `reporter_type = 'resident'` plus `reporter_id`. Never join or merge these identities by phone alone.
- Audit the current report tables and review RPC. Make review, repeat-review counting, resubmission, assignment release, and lifecycle revision updates atomic and idempotent in the database. Add a migration for any new review history/cycle fields and update the schema snapshot.

### 2. Unify dispatcher review UI

- Extract or share one review dialog across the Command Center and Reports queue so both entry points offer Inconclusive and False Reporter with the same styling and behavior.
- Add an explicit confirmation modal for each selected outcome before it is written. For Inconclusive, continue from confirmation to an inline required reason field; validate and store the reason with a clear final action. False Reporter submits only after its confirmation.
- Replace the Reports queue’s native `window.confirm()` and false-report-only handler with the shared dialog.
- Display the current report’s repeat false-mark count in the decision dialog. Use accurate labels for both account and guest reports; do not show “No linked resident account” as a reason a guest cannot be marked.
- On success, update the report list/map immediately from the server response and display the relevant saved outcome. Prevent duplicate submissions while the write is in flight.

### 3. Add map and queue states

- Update MDRRMO filtering so `false_report` remains hidden and `inconclusive` remains visible. Keep both outcomes blocked from dispatch until the owner resubmits.
- Add a dedicated inconclusive marker: white fill with a black icon, including the same style in clustered marker entries and selected-report details. Normal pending reports keep the current marker; resubmission clears the inconclusive style.
- Keep a false-report report out of the regular pending queue and map while preserving it in its reporter-owned report history.
- Ensure dispatcher selection, report counts, map clusters, and dispatch guards all use the same review-state rules.

### 4. Implement secure edit and resubmit

- Add a dedicated resubmit API operation instead of reusing the generic report `PATCH` route. Accept only reports currently marked inconclusive or false reporter, with no dispatched/accepted/arrived/resolved response.
- For resident reports, require an authenticated resident whose ID matches `reporter_id` and whose report type is `resident`.
- For guest reports, require the guest report ID and a matching normalized phone. Do not grant guest ownership to a signed-in account just because the account has the same phone.
- Validate editable fields and evidence, update the existing report ID, clear the active review outcome/reason/reviewer fields, return status to pending, increment the resubmission/lifecycle revision, and retain review history and false-mark audit records.
- Add an edit form/action to signed-in resident report history and guest report tracking. Prefill current values, allow corrected details/location and evidence, show validation/upload errors, and refresh status after resubmission.
- Make the operation atomic and idempotent so retries cannot create duplicate reports, lose evidence, or clear a concurrent dispatch/review.

### 5. Notify reporters and dispatchers

- When a review is recorded, send resident accounts the existing targeted socket/push status update with the outcome and inconclusive reason. For guests, send an authorized guest-report room invalidation so the tracking page refreshes without exposing report data to other guests.
- On resubmission, emit a new MDRRMO intake notification as well as the usual report update. Include a review-cycle/resubmission revision in the event so the same report ID can notify again without duplicate toasts for a single retry.
- Send the resident account a resubmitted status update. Guest tracking should refresh live and display the resubmitted status.
- When dispatch/response starts, clear the active false-mark counter as specified above and publish the updated count/status to the reporter and dispatcher views.

### 6. Add the responder False Reporter action with server-side limits

- Add a **False Reporter** action to the assigned responder’s workspace for an incident they own. Keep it available before and after arrival while the assignment remains active and the incident is not resolved/closed.
- Do not give responders an Inconclusive action. Use a confirmation modal before applying False Reporter; no reason field is required for this outcome.
- Enforce assignment ownership and the active, unresolved assignment state in the API/database transaction. Do not rely on hiding the UI action alone. In particular, arrival must not disable this action.
- Atomically mark the report false and close the active assignment when the responder confirms. Preserve arrival timestamps/history if the responder had already arrived, and notify the dispatcher, reporter, and affected responder workspace.

### 7. Verify the full lifecycle

- Verify dispatcher review for Inconclusive and False Reporter, including confirm/cancel, missing reason, repeated click, and visible map state.
- Verify both resident-account and guest reports when they use different phone numbers and when they share the same phone number. Confirm their report lists, review counts, edit permissions, and events remain separate.
- Verify resident and guest owners can edit and resubmit the same report, while another account or a guest with the wrong phone cannot edit it.
- Verify resubmission restores the normal marker and dispatch eligibility and generates a new dispatcher notification for the same report ID.
- Verify repeat false review increments the report’s visible count to 2; verify dispatch/responding clears the active counter while review history remains intact.
- Verify a responder can mark only their own assigned incident as False Reporter, both before and after arrival but before resolution/closure. Confirm Inconclusive is unavailable to responders, the assignment closes after the false mark, arrival history is preserved, and the API rejects unassigned responders and resolved/closed incidents.
- Verify related report copies, resident push/outbox state, guest tracking refresh, map clusters, and dispatcher counts stay consistent through each transition.

## Acceptance criteria

- Dispatcher review uses the image-based choice modal, with confirmation before either outcome is recorded and a required reason for Inconclusive.
- Inconclusive reports remain on the MDRRMO map with a white marker and black icon; false-reporter reports disappear from that map until resubmission.
- Resident and guest report views show the review result and reason, and each owner can edit/resubmit their own report.
- Account reports and guest reports remain separate even when their phone numbers match; phone verification grants access only to the matching guest report.
- Resubmitting restores the existing report to the normal pending queue, restores its normal marker, and produces a fresh dispatcher notification.
- Repeated false review increments the report-level visible count; dispatch/responding clears the active count without deleting the review audit history.
- An assigned responder can mark only False Reporter, and can do so before or after arrival until resolution/closure. The backend closes the assignment, preserves arrival history, and rejects unassigned responders or resolved/closed incidents.
- Review, resubmission, and dispatch state remain consistent across the authoritative report record, any paired copy, notifications, and map/queue views.

## Rollout notes

1. Add and apply the database migration before deploying backend code that depends on new fields or review history.
2. Deploy backend authorization, review/resubmit transactions, and socket/push events.
3. Deploy the shared dispatcher dialog, map states, resident/guest edit forms, and responder action.
4. Verify a test account report and guest report end to end, including a repeated false mark and successful resubmission/dispatch, before enabling the responder action in production.
