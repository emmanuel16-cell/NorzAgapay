# Assistance Requests and Command Map Implementation Plan

## Goal

Move responder resource requests into the Operations workspace as **Assistance Requests**, expose the queue only to Dispatcher and Master Admin, show the linked request in the Command Center, and make Command Center report pins easy to find and select.

## Report visibility rule

Use one strict eligibility rule across MDRRMO report feeds and the Assistance Request queue:

- Include a resident report only when `reporter_type` is `resident` and its explicit `send_to` value (or persisted `[SEND_TO:mdrrmo]` marker) is `mdrrmo`.
- Include a report when it has an explicit escalation state/flag, is marked beyond barangay capability, or has barangay escalation notes.
- Exclude all other reports, including barangay-only reports and un-routed emergencies. Exclude reports rejected during review.

## Implementation steps

1. **Role and navigation:** Move the existing request entry into Operations, rename it Assistance Request, and show it only to Dispatcher and Master Admin. Protect the page and list/status APIs with the same role rule.
2. **Assistance queue backend:** Return responder requests only when they link to an eligible MDRRMO report. Include the linked report and requester details, support filtering to one report ID for deep links, and retain existing approve/reject/fulfill actions for authorized staff.
3. **Assistance queue UI:** Replace the table with the existing Reports split-view visual language: title/live indicator, Resident Reports and Escalate Reports tabs, a selectable request queue, and a full selected-request detail view. Omit the separate Pending/Responding/Resolved tab row. Keep request status and existing actions in the detail view. Select a requested report from the `incident_id` URL parameter.
4. **Command Center request detail:** Load the selected report’s linked assistance request and replace the placeholder with its requester, type, details, timestamp, and status. Add a View All button that opens Assistance Requests filtered to that report.
5. **Strict report feeds:** Apply the report visibility rule to both the MDRRMO Reports queue and the Command Center’s report feed. Use the same resident/escalation classification when labeling pins.
6. **Map viewport and clustering:** Fit the initial map to all visible report and unit points. Center and zoom to a report when selected. At close zoom levels, group nearby report pins behind the supplied list-style marker; its popup lists every report with a colored dot and a clear Resident/Escalation plus Pending/Responding/Arrived/Resolved label. Selecting a popup row opens that report and focuses its exact pin.
7. **Responder tracker removal:** Remove the live responder GPS overlays and focus panel from Command Center, and remove the backend location update endpoint, GPS socket handlers, Redis location store, and live-location matching override. Keep the one-time GPS checks used to validate responder arrival.
8. **Review:** Inspect the final diff, check for stale Resource Requests navigation and broad MDRRMO report filters, and review remaining mobile GPS sender references.

## Scope note

The mobile app's GPS sender is outside the approved dashboard/backend edit scope. It still attempts the legacy location API and socket event; the removed endpoint returns not found and the removed socket handler ignores the event. Remove that sender separately if the mobile client should stop collecting and transmitting responder locations too.
