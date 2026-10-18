# Web dashboard incident time implementation plan

## Goal

Add the resident app's incident-time choice to the web emergency report forms. Place it beside **Incident category** on wider screens, matching the attached reference with **Just now**, **Earlier**, and **Not sure** choices. Keep the controls usable on narrow screens and submit the chosen incident time with the report.

## Status

Implemented in the public and signed-in resident emergency forms. The dashboard production build passes.

## Findings

- The attached target matches the dark themed intake form in `web-dashboard/src/pages/PublicReportPage.tsx`. Its incident category is currently rendered as a standalone label and select.
- Signed-in residents are redirected from `PublicReportPage` to `ResidentIncidentReportPage`, which has a separate emergency category field. Both emergency entry points need the time control so the behavior is consistent.
- `resident_app/lib/screens/reporting_screen.dart` already implements the requested choices. **Earlier** reveals hours-ago and minutes-ago selectors and an **Exact / Approximate** precision choice. The default is **Just now**; **Not sure** clears the timestamp.
- The dashboard's `reportAPI.guestReport` type already includes `incident_time_choice`, `incident_occurred_at`, and `incident_time_precision`. `backend/src/routes/incidentReports.ts` already validates and normalizes these fields, persists the timestamp and precision, and uses `client_submitted_at` for **Just now**. No database migration or backend endpoint change is expected.
- `PublicReportPage` currently sends the submission time for idempotency but does not include the incident-time fields. `ResidentIncidentReportPage` does the same.
- Community concern reporting has a separate category and should not show this emergency incident-time control.

## Implementation

1. Add incident-time state and selection logic to the web emergency report forms, using the resident app's behavior:
   - Start at `just_now`, with `exact` precision.
   - **Just now** sets the timestamp to the current submission time and precision to `exact`.
   - **Earlier** opens hours-ago and minutes-ago controls, keeps the selection within the current day, updates the timestamp as the values change, and lets the reporter choose `exact` or `approximate` precision.
   - **Not sure** clears the timestamp and sets precision to `unknown`.
2. Render **Incident category** and **When did the incident happen?** as two labeled field groups in one row in both web emergency forms. Match the attached dark theme and selected-chip treatment on the public form, and follow the resident form's existing theme. Keep the **Other emergency** detail field below that row at full width.
3. Add responsive styles so the two groups sit side by side when there is enough room and stack cleanly on narrow screens. Ensure chip labels wrap without overflowing.
4. Include the selected choice, ISO timestamp (or `null` for unknown), and precision in each emergency submission through the existing `guestReport` API. Include the incident-time choice and values in the request fingerprint so changing the time creates a new idempotency request instead of reusing the prior one.
5. Reset the incident-time controls to their default after a successful submission, alongside the existing category and form reset behavior.

## Acceptance criteria

- On desktop, **Incident category** and **When did the incident happen?** appear side by side as in the reference image; on mobile, they stack without horizontal scrolling.
- The default **Just now** selection is visibly selected and submits an exact timestamp.
- Choosing **Earlier** exposes bounded hours/minutes controls and the exact/approximate precision choice; changing either updates the submitted timestamp.
- Choosing **Not sure** clears the occurred-at timestamp and submits `unknown` precision.
- Both guest emergency reports and signed-in resident emergency reports submit these fields; community concern reports remain unchanged.
- Existing backend validation and report display continue to receive the supported timestamp and precision fields without a schema change.
