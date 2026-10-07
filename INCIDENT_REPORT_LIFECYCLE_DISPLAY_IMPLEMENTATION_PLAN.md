# Incident Report Lifecycle Display Implementation Plan

## Purpose and scope

Make every incident report show the same correct lifecycle state from intake through final resolution in the backend APIs, resident app, responder mobile app, and web dashboard. The current code in `backend/`, `resident_app/`, `mobile_app/`, and `web-dashboard/` is the implementation source of truth for this plan. The review is static; no application code or tests have been changed.

The strict requirement is that routing, review outcome, barangay response, MDRRMO response, and overall case status remain distinct. A change in one agency's response cycle must not hide another agency's active work or mark the whole incident resolved prematurely.

## Audit findings

1. **A barangay close can make an escalated incident look globally resolved while MDRRMO work remains open.** `backend/src/routes/barangay.ts` sets the shared `status` to `resolved` when the barangay closes its own cycle. The same row can still have `mdrrmo_response_status: pending` or `responding`.
2. **An escalation can lose its durable MDRRMO routing signal.** Barangay escalation currently sets `status: escalated`; the shared MDRRMO visibility helper recognizes that status, the `is_escalated` / beyond-capability fields, or the word “escalated” in response notes. If barangay closure replaces the shared status and no explicit flag was saved, the escalated report may stop qualifying for the MDRRMO queue and map. Free-text notes must not decide access or routing.
3. **Client status precedence disagrees with the channel-specific backend and mobile models.** `resident_app/lib/models/incident_report.dart` returns resolved when the shared or barangay status is resolved before checking whether MDRRMO is still responding. `web-dashboard/src/pages/ReportsPage.tsx` and `web-dashboard/src/pages/CommandCenter.tsx` also treat a resolved shared status or either agency's resolved status as final. This can put a still-active MDRRMO report in the Resolved queue, hide it from active map filters, and show the resident a final resolution too early.
4. **The mobile response models already separate agency cycles.** `mobile_app/lib/models/incident_report.dart` scopes the barangay queue to barangay status and channel-specific timestamps; `mobile_app/lib/mdrrmo/models/mdrrmo_report.dart` scopes the MDRRMO queue to MDRRMO status. Preserve this separation and use it to align the other clients.
5. **Arrival is a distinct milestone, even when the queue has only three tabs.** The web Command Center can represent `arrived`; report details contain arrival timestamps. Resident status normalization and list badges currently collapse this into `responding`. Keep an arrived/on-scene milestone visible without creating a new queue unless the product owner later requests one.
6. **Some action guards rely on the shared status.** For example, `backend/src/routes/requests.ts` blocks a request when `status` is resolved, even though the report may have a separate active response cycle. Route actions must check the relevant agency cycle and assignment, not infer it from another channel's closeout.

## Required status and routing contract

Keep these concepts separate in API responses and all displays:

| Concept | Required meaning |
| --- | --- |
| Routing | Barangay, direct MDRRMO, or escalated to MDRRMO. Escalation remains recorded after either agency closes its own cycle. |
| Review outcome | Inconclusive or false report. This is a review decision, not a response status; it must not be dispatchable. |
| Barangay response | Its own pending, responding, arrived, or resolved state and timestamps. |
| MDRRMO response | Its own pending, responding, arrived, or resolved state and timestamps. |
| Overall case state | Active while any applicable, actually engaged response channel remains open; resolved only after all applicable engaged channels are resolved. Do not let a default `pending` value on an unused channel block a valid final resolution. |
| Incident and receipt time | Resident-reported occurrence time with exact/approximate/unknown precision, separate from server `created_at`. Never substitute one for the other. |

Use explicit persisted routing data for escalation. Persist an explicit escalation marker when an escalation is created (use `is_escalated` if that column is present; otherwise add the smallest compatible durable value) and preserve it after either channel closes. Do not infer routing from status text or free-text notes. If the current stored fields cannot identify which response channels are engaged, resolve that data contract before implementation and add the smallest compatible backend field/API value needed.

Expose one backend-derived display state additively while migrating existing clients. It must include the route, review outcome, overall state, and each agency's applicable state, handler/assignment, and lifecycle timestamps. Keep current flat API fields during migration; do not let each client independently reinterpret the shared `status` field.

## Required information by screen

### Resident app

- Report list: incident type/title, a clear current status (including **On scene** where arrived), destination or escalation state, server receipt time, and occurrence time with its precision or **Incident time unknown**.
- Report detail: resident description, location/map pin, attachment state and proof, current handling agency, separate barangay and MDRRMO response states when applicable, and a time-ordered timeline for review, dispatch, acceptance, arrival, and resolution.
- Show a resolution summary only for the response channel that supplied it. If one channel is resolved while another remains open, show the open agency and its current stage; do not present the whole incident as resolved.
- Keep reporter-private information scoped to that resident's own report. Do not display another responder's private account information.

### Barangay responder and dispatcher screens in `mobile_app`

- Preserve jurisdiction and assignment restrictions. The queue may retain Pending, Responding, and Resolved tabs; an arrived report stays in the active response queue but receives an **On scene** badge.
- Report row/detail: incident title/type, description, reporter contact as authorized, barangay, occurrence and receipt times, location and coordinates/map action, evidence, classification/severity, barangay assignment, assistance/SOS request state, response notes, and the barangay-specific lifecycle timeline.
- Keep MDRRMO status visible as a separate coordination line on escalated reports. A barangay closeout must not erase MDRRMO routing or status.
- Only expose actions valid for the barangay channel and authenticated role. Arrival and resolution controls must continue to follow the backend's assignment and required-field checks.

### MDRRMO responder screens in `mobile_app`

- Keep the MDRRMO queue scoped to eligible direct-to-MDRRMO and explicitly escalated reports. Preserve its MDRRMO-specific pending/responding/resolved status.
- Report row/detail: report and reporter details, incident and receipt times, location/map action, evidence, category/severity, escalation reason/coordination notes, assigned MDRRMO responder(s), assistance request where linked, field assessment/media, arrival, resolution notes, and the MDRRMO-specific timeline.
- A barangay resolution must not remove an open MDRRMO response from this queue.

### Web dashboard

- Reports queue: use the backend-derived state for counts, tabs, list badges, deep links, and selection. Keep the current report grouping and status tabs, with **On scene** visible on an arrived item inside the active response group.
- Selected report: show reporter/contact, description, occurrence time and precision, server receipt time, location/pin, attachments, incident classification/severity, durable route/escalation notes, assigned responder(s), response-channel states, lifecycle timestamps, field assessment/media, and resolution notes.
- Command Center counters, filters, pins, and selected-report details must use the same overall-state rule and strict MDRRMO visibility rule as the Reports queue. An escalated report remains visible after local barangay resolution while MDRRMO work is open.
- Keep assistance request details linked to the report and show requester, request type/details, created time, and request status where available.

## Implementation sequence

1. **Freeze the transition and channel applicability table.** Document the allowed state changes for direct barangay reports, direct MDRRMO reports, and barangay-to-MDRRMO escalations. Define when a channel is engaged so default statuses on unused channels do not affect overall resolution.
2. **Correct backend routing and state derivation.** Set and retain an explicit escalation marker on escalation and assistance-decision paths. Centralize report visibility, overall state, and channel state derivation in backend helpers used by report feeds, map feeds, action guards, and serializers. Make close/request/dispatch guards check the relevant channel and assignment. Keep review outcomes non-dispatchable.
3. **Correct lifecycle delivery.** Ensure the outbox event state and authorized audience include the durable route marker, overall state, agency states, and changed timestamps. Keep events minimal and scoped; preserve revision ordering and authoritative refresh on reconnect. A partial close must notify both the resident and every still-authorized active channel.
4. **Update mobile models and screens.** Keep barangay and MDRRMO channel-specific models; add a shared display-state parser for resident-facing overall status and on-scene presentation. Remove any reliance on the shared legacy status for agency-specific queue decisions.
5. **Update resident list and detail.** Display the overall state and both applicable channel timelines. Do not mark the case resolved while an applicable response channel remains open. Keep occurrence time separate from server receipt time.
6. **Update dashboard queues and map.** Replace duplicated `resolved`/`responding` precedence in Reports and Command Center with the backend-derived state. Use the same result for status counts, map filters/pins, and selected-report status.
7. **Review the final diff against the acceptance criteria.** Confirm the backend, resident app, responder app, and dashboard all render the same route, channel states, overall state, occurrence/receipt times, and final resolution for each lifecycle path.

## Acceptance criteria

- Escalation visibility is explicit and survives barangay closeout; it is not determined by free text.
- A report with an open MDRRMO cycle remains visible in MDRRMO queue/map and is not shown as globally resolved when the barangay cycle closes.
- A report with an open barangay cycle remains active when MDRRMO completes its own cycle.
- Overall **Resolved** appears only after every applicable engaged response channel is resolved; unused default channel states do not prevent resolution.
- **On scene** is visible when the applicable channel has an arrival timestamp, while the item remains in the active response group.
- Review outcomes remain distinct from response stages and cannot be dispatched.
- Every app shows occurrence time with precision or an explicit unknown label separately from server receipt time.
- Only the resident, authorized agency roles, and assigned responders receive the report details and actions permitted for their scope.
- Lifecycle updates do not regress to an older revision after socket events, refresh, or reconnect.

## Out of scope

This plan does not change evacuation-center workflows, unrelated logistics pages, or other non-report features. It does not assume the thesis or older planning documents describe the current product.



