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
7. **Dispatch-scoped live responder marker:** Show a live responder dot and dashed route only for active assignments to eligible MDRRMO reports. Restrict location updates to the responder's authenticated socket, deliver them only to Dispatcher and Master Admin, keep them in a 30-second ephemeral store, remove them on arrival or assignment end, and center the map when a responder dot is selected. Do not persist live locations to responder profiles.
8. **Review:** Inspect the final diff, check for stale Resource Requests navigation and broad MDRRMO report filters, and confirm live GPS is limited to assigned responders and the Dispatcher/Master Admin audience.

## Live responder location behavior

The MDRRMO mobile app sends responder GPS over its authenticated socket only. The backend accepts a location only from the same responder account while it has an active, non-arrived assignment to an eligible report. Dashboard snapshots and live events are available only to Dispatcher and Master Admin. Locations expire after 30 seconds without a GPS heartbeat and are never written to the responder profile.
