# Resident Draft Location and Time Persistence Plan

## Goal

When an offline incident submission is saved as a draft, reopening and resubmitting it must retain the incident coordinates and the time of the resident's first submit attempt. The server's `created_at` remains the authoritative time the report was actually received.

## Implementation steps

1. Restore saved latitude and longitude into the report form as the incident location. Validate the restored point against the currently configured municipality boundary. Do not replace a valid restored location with an automatic GPS scan; retain the explicit location refresh control so the resident can intentionally update it.
2. Capture `client_submitted_at` once when the resident first taps Submit. Save and restore it with the local draft, and reuse it on every retry. Keep draft `saved_at` separate because that value describes local draft saves, not the first submit attempt.
3. Add nullable `client_submitted_at` to the incident report schema and backend create endpoint. Validate and normalize the supplied ISO timestamp, and retain it separately from the server-generated `created_at` so queue ordering and response-time calculations stay based on server receipt.
4. Parse the field in the resident report model and show the original device submission-attempt time in report details. Continue showing server receipt time in the operational response timeline.
5. Build both affected targets and manually verify draft restoration and retry payload behavior where an app session and API are available.

## Acceptance criteria

- A saved draft reopens with the same latitude/longitude and first submit-attempt timestamp.
- Resubmitting sends the same coordinates and timestamp; opening or saving the draft again does not reset the first attempt time.
- A deliberate location refresh updates the draft location and subsequent resubmission uses the refreshed coordinates.
- A successfully accepted report stores the original `client_submitted_at` while `created_at` remains the server receipt timestamp.
- Existing drafts without the new timestamp continue to work; their first Submit tap creates the timestamp.

## Implementation status — 2026-10-06

- Restored saved coordinates are boundary-checked and preserved through submit. The explicit GPS refresh action intentionally replaces the saved location.
- The first submit-attempt time is retained in local drafts, shown in the Drafts list, sent as `client_submitted_at`, stored separately from server `created_at`, and exposed in resident report details. The report list uses that original attempt time when available.
- Added the nullable timestamp column to the base schema, incident lifecycle migration, and an additive migration for databases that already applied the earlier migration.
- Backend TypeScript build passed. Resident Android debug APK build passed.
- The offline/reopen/resubmit flow was not exercised against a live API; apply the updated database migration before verifying server persistence in staging.
