# Officers page and MDRRMO dispatch implementation plan

## Goal

Keep the Officers directory focused on operational details and make the dispatcher-to-mobile-response flow use the same MDRRMO Officer and responder identity. Before a Team Leader accepts a dispatch, the mobile app must let them select their response crew, including at least one Driver Responder and one First Aider Responder.

## Findings

- The Officers table showed Phone and Email columns even though these fields remain editable in the officer form.
- Dispatch assigns responder login accounts that are active Team Leaders of available units with a complete roster and activation for the current Manila date.
- The dispatch API and database RPC validate unit readiness and assign the report to the Team Leader’s mobile responder account.
- The mobile app already showed a crew checklist and the server already validated the selected member IDs and required roles. However, the app used its login-time roster cache when opening that checklist.
- Dispatch selection displayed account names without identifying the corresponding Officer profile or response unit.

## Implementation plan

1. Remove Phone and Email from the Officers table while keeping those fields available in create/edit forms.
2. Enrich dispatchable Team Leader records with their Officer profile name and response unit name, but retain responder account IDs for assignment and authentication.
3. Keep dispatch limited to active Team Leaders whose units are available, complete, and activated today. Return an actionable error if the required roster schema is missing.
4. Refresh the mobile responder’s unit and roster after they tap Accept and before building the checklist. Stop acceptance if the roster cannot be refreshed or the account is no longer the active Team Leader.
5. Require at least one Driver Responder and at least one First Aider Responder in the mobile checklist. Continue validating distinct, active members of the same unit on the server and snapshot the selected crew with the accepted assignment.
6. Build the dashboard and backend; format/analyze the mobile app and review the SQL/API changes.

## Acceptance criteria

- The Officers table has no Phone or Email columns.
- Dispatchers see ready mobile responders with their Officer profile and unit labels and can dispatch to their responder account.
- Only responders assigned as the selected unit’s active Team Leader can accept its dispatch.
- The acceptance checklist uses the latest roster, excludes the Team Leader from the selectable crew, and cannot submit without a driver and a first aider.
- The API and database reject duplicate, inactive, out-of-unit, or incomplete crew selections.
- A successful acceptance stores the selected crew with the assignment for later review.

## Implementation status

- Updated the Officers table and enriched the dispatcher list with Officer and unit identity.
- Added a fresh roster fetch before opening the mobile crew checklist, with an explicit error if refresh fails or Team Leader assignment changed.
- Confirmed that the existing API and database acceptance path enforce the required crew composition and store crew snapshots.
- Dashboard and backend builds pass. Targeted mobile analysis reports only existing info-level lint findings; it found no new issue on the changed lines. The full-app analysis also reports existing project-wide lint findings.
