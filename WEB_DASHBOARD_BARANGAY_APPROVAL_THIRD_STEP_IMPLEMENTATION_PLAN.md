# Barangay Approval Third-Step Implementation Plan

## Goal

Show Barangay account setup as three clear stages and send a Barangay administrator who has not been approved by MDRRMO to stage 3 of the registration/onboarding flow after they sign in. Do not send an unapproved administrator to Barangay Settings or the dashboard.

## Proposed stages

1. **Account details** — enter administrator details and the Barangay information.
2. **Mobile verification** — verify the mobile number by SMS.
3. **MDRRMO review** — complete the Barangay Account Request, download and sign the authorization outside the app, upload it, and check the review status and any MDRRMO feedback.

## Implementation

1. Update the registration step indicator to show all three stages. Steps 1 and 2 continue to reflect the existing form and SMS verification flow.
2. Make stage 3 an onboarding/registration view for the Barangay administrator. Put the request details, signed-document upload, pending status, and review feedback there so the unapproved admin does not need to enter the dashboard or Barangay Settings to continue.
3. Make stage 3 status-aware:
   - `pending_document`: explain that the request details and signed document still need to be submitted.
   - `under_review`: show that MDRRMO is reviewing the submitted request.
   - `needs_correction` or `rejected`: show MDRRMO feedback and the existing correction/resubmission actions.
   - `verified`: show approval as complete.
   - `activation_pending`: show that an activation request is awaiting review.
4. After successful login, route any unapproved Barangay administrator directly to stage 3 of the onboarding/registration flow, not `/barangay-settings` or the dashboard. Use the latest `coordination_verified` and verification status from the server.
5. After approval, route the Barangay administrator to the normal dashboard. Keep other roles and account types on their existing routes.
6. Keep MDRRMO decision actions in the existing **Administration → Barangay Verification** dashboard page.
7. Build the web dashboard and verify signup, unapproved-admin login, pending-review, correction, approved, and activation-pending states.

## Routing behavior

The public login form accepts the administrator's credentials. Once authenticated, an unapproved Barangay administrator lands on the registration/onboarding flow's stage 3. They remain signed in so the page can show their request status and provide the required upload or correction actions, but they do not enter the dashboard or Barangay Settings until MDRRMO approves the account.

## Scope

Update the Barangay registration/onboarding stages and the unapproved-admin landing behavior. Keep SMS verification, document submission, MDRRMO review endpoints, and approval logic intact; move or reuse the existing account-request actions in stage 3 instead of requiring an unapproved admin to open Barangay Settings.
