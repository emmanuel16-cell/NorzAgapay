# Incident Occurrence Time Implementation Plan

## Recommended solution

Keep the time the incident happened separate from the time the system received the report. The resident form should ask **“When did the incident happen?”** with clear choices:

- **Just now** — records the time selected on the resident's device.
- **Earlier** — opens date and time pickers; the resident can mark the time exact or approximate.
- **Not sure** — records that the occurrence time is unknown instead of inventing one.

The dispatcher should see two clearly labeled values in the report list and detail view:

- **Incident occurred:** the resident-reported time, labeled exact, approximate, or unknown.
- **Report received:** the server's `created_at` time.

The existing `client_submitted_at` records when the resident first tried to submit from the device. Keep it as separate offline/retry audit metadata; do not use it as the incident time or the official server-received time. Start response-time calculations from server `created_at`, so an offline delay does not make responders appear to have received the report earlier than they did.

Example: a resident sees a fire at 2:05 PM, taps Submit at 2:15 PM without a connection, and resubmits at 2:40 PM. Dispatch sees **Incident occurred: 2:05 PM (resident reported)** and **Report received: 2:40 PM**. The first attempt at 2:15 PM can remain available as secondary audit metadata.

## Current state

- The resident form records a default device time, supports an earlier exact or approximate time, and allows an unknown time.
- Drafts preserve the occurrence choice, timestamp, precision, first submit-attempt time, and saved coordinates across reopen and retry.
- The API stores validated occurrence time separately from server-generated `created_at`; invalid or too-far-future times become unknown without rejecting the report.
- Resident, barangay, and MDRRMO report lists and details show occurrence time separately from report-received time.
- Lifecycle outbox state carries the occurrence fields, and connected clients refresh the authoritative report.
- Build and end-to-end verification remains outstanding.

## Implementation steps

1. **Resident form:** [x] Add the occurrence-time choice, date/time picker, and precision selector. Default to a clearly selected **Just now** option, and make it easy to correct when the resident reports an older incident. Do not block a report when the time is unknown.
2. **Draft persistence:** [x] Save and restore the occurrence choice, timestamp, and precision alongside description, media, saved coordinates, and `client_submitted_at`. Reopening or retrying must not reset any of these values. A deliberate resident edit updates only the chosen field.
3. **Database and API:** [x] Add nullable `incident_occurred_at TIMESTAMPTZ` and `incident_time_precision` (`exact`, `approximate`, `unknown`) to `incident_reports`, with legacy rows interpreted as unknown. Validate timestamp shape and precision. Prevent future times in the form; malformed or implausibly future occurrence times must not prevent an emergency report from reaching dispatch. Preserve server `created_at` and current idempotency behavior.
4. **Resident model and UI:** [x] Parse the occurrence fields. Show them in the resident report list and detail screen with explicit precision labels; continue to show the server receipt time separately.
5. **Dispatcher clients:** [x] Add both labels to the barangay and MDRRMO queue rows and report details. For unknown time, show **Incident time unknown**. Keep sorting, response timers, and current queue age based on `created_at`; never silently substitute `created_at` for a missing occurrence time.
6. **Lifecycle delivery:** [x] Include occurrence-time fields in the minimal new-report event state, and refresh/fetch the authoritative report as clients already do. Do not expose the resident's first device submit time as if it were server receipt.
7. **Verification:** [ ] Build resident and operations apps and backend. With synthetic accounts, test a new incident, an older exact time, an approximate time, unknown time, offline draft/reopen/resubmit, duplicate request retry, server receipt time, and both dispatch consoles. Confirm the original occurrence time and coordinates survive reconnect and the operational response timer starts at server receipt.

## Acceptance criteria

- A resident can state when an incident actually happened independently of when they submitted or when the server received it.
- Offline draft/reopen/resubmit preserves the occurrence time and its exact/approximate/unknown precision.
- Barangay and MDRRMO dispatchers can distinguish occurrence time from report-received time without inferring one from the other.
- Unknown occurrence time stays visibly unknown; it is never replaced with the received time.
- `created_at` remains server-generated and continues to drive dispatch ordering and response-time measurements.
- No emergency report is lost because a resident cannot provide an occurrence time.
