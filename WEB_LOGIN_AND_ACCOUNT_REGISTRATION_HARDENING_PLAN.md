# Web Login and Account Registration Hardening Plan

## Objective

Simplify web sign-in so the account type is detected automatically, present the identifier field as **Username**, enforce case-insensitive username uniqueness across all sign-in account types, and allow a barangay administrator to register with a mobile number, an email address, or both while verifying through an available channel.

The attached login screenshot is the reference for the simplified form.

**Implementation status (2026-10-15):** The login, account creation, username uniqueness, and optional barangay email changes in Phases 1–4 have been implemented in the workspace. The database preflight and registry migration are included but have not been applied to a live database. Run the preflight, resolve any reported duplicates, then apply the registry migration before deploying the backend changes. Functional/build verification and deployment remain rollout work.

## Current-state assessment

- `web-dashboard/src/pages/LoginPage.tsx` renders an **Account type** selector. Its default is `auto`, and the identifier label and placeholder change based on the selected kind. The barangay registration link is currently shown only when **Barangay team** is selected.
- `web-dashboard/src/context/AuthContext.tsx` already supports automatic account lookup. In `auto` mode it tries MDRRMO, barangay, then resident login and stores the account kind after success.
- The web login endpoints continue to accept some legacy identifiers: MDRRMO and barangay logins accept username or email; resident login accepts username, mobile number, or email. The request changes the visible label, so this plan keeps those server-side aliases during rollout while showing **Username** in the web form.
- Usernames are currently unique case-insensitively inside each table only. Migrations `20261014_mdrrmo_username_accounts.sql`, `20261014_barangay_username_accounts.sql`, and `20261014_resident_web_self_service_accounts.sql` add separate per-table indexes for `users`, `barangay_users`, and `resident_user`. The same normalized username can therefore exist in more than one account type.
- Username entry and validation are inconsistent across account paths. The dashboard user UI and barangay team UI collect usernames, while master-admin setup, the legacy central-account registration route, legacy resident registration, and public barangay-admin registration do not currently apply the same cross-table username rule.
- Barangay-admin registration in `web-dashboard/src/pages/BarangayRegistrationPage.tsx` requires email, treats phone as optional, sends an email OTP, and emails a temporary password. `backend/src/routes/barangay.ts` keys the pending OTP by email and creates the barangay admin after verification.

## Target behavior and implementation decisions

### Web login

- Remove the **Account type** label and selector. Every sign-in submits with `accountKind: 'auto'` so `AuthContext` identifies the account type.
- Show the exact field label **Username** and a username-focused placeholder. Remove the current "Email, username, or mobile number" wording from this page.
- Keep the existing automatic lookup order and account-kind session handling. Preserve the resident and barangay account-creation links in a visible location that no longer depends on a selector choice.
- Keep backend email/mobile aliases during this UI change to avoid breaking existing accounts and clients. The form communicates username as the primary identifier; retiring aliases would be a separate authentication policy change.

### Username uniqueness

- Treat a username as `trim().toLowerCase()` for comparison. Keep the existing 3–32 character allowed set (`A–Z`, `a–z`, digits, `.`, `_`, and `-`) consistent across web forms, APIs, and database enforcement.
- Make usernames required for new sign-in-capable accounts and apply the rule to all account creation routes, including account setup, administrator-created users, barangay administrators and team members, and resident web and legacy registration routes. Update all corresponding forms and API payloads.
- Enforce uniqueness globally across `users`, `barangay_users`, and `resident_user`. Application availability checks should produce a quick, clear validation message; a database-level unique registry/constraint must be authoritative so simultaneous requests cannot claim the same name.
- Extend the same global reservation rule to username changes and profile edits. Releasing a username on deletion and maintaining it on account rename must be transactionally consistent.
- Before enforcing the global rule, identify existing cross-table duplicates and resolve them deliberately with the account owners/admins. Do not silently rename existing login names.

### Barangay administrator registration and OTP

- Make email optional and provide a username field. Require at least one usable OTP destination: mobile number, email, or both.
- Offer only verification channels for which the applicant supplied a destination: SMS for a mobile number and email for an entered email. If both exist, let the applicant choose. If email is blank, do not offer, enqueue, or send an email OTP for this registration.
- Bind the selected channel, destination, username, and registration details to the pending OTP record. Verify that record before creating the account, then enforce global username uniqueness again at final creation.
- Persist an omitted email as `NULL` and maintain existing barangay eligibility, approval, and activation behavior.
- Resolve temporary-password delivery as part of the implementation: use the selected, verified channel for the temporary password, or change the registration flow to let the applicant set a password after OTP verification. Prefer the password-setup step if SMS delivery of credentials is not supported or appropriate.
- Scope email-OTP suppression to account creation when no email was provided. Keep unrelated password-reset and password-change OTP flows intact unless a separate policy change is requested.

## Phased implementation

### Phase 0 — Inventory and migration preflight

- Inventory every creation and username-update path in `backend/src/routes/auth.ts`, `backend/src/routes/users.ts`, `backend/src/routes/barangay.ts`, associated frontend registration/account forms, and any other backend/mobile API that writes to the three account tables.
- Confirm which legacy clients call registration endpoints and determine a compatible rollout for making usernames mandatory on new account creation.
- Add a read-only database preflight query/report for null usernames and usernames that collide after lowercasing across the three account tables.
- Decide how to resolve existing collisions before applying the global constraint.

**Exit criteria:** Every sign-in-capable account write/update path is listed, existing conflicts are understood, and the rollout does not strand existing accounts or clients.

### Phase 1 — Global username enforcement

- Add a migration for a shared normalized-username registry, or an equivalent database mechanism with a single global unique key. Associate each reservation with its account table and row ID.
- Backfill existing usernames after the collision cleanup. Add database triggers or transactional database functions for inserts, updates, and deletes so direct writes and concurrent registration attempts are protected.
- Retain per-table indexes where useful, but treat the global constraint as the source of truth.
- Add a shared backend username normalization/validation helper and map the global uniqueness violation to HTTP `409` with a consistent message such as “That username is already in use.”
- Update account creation and username edits to check global availability for early feedback and rely on the database check for final enforcement.
- Require usernames for newly created sign-in accounts after all supported forms and API clients send them. Existing username-less accounts can continue signing in through their current aliases while their usernames are migrated.

**Exit criteria:** A case-insensitive duplicate cannot be created across any two account tables, including concurrent requests or direct supported API paths; rename and delete operations preserve registry consistency.

### Phase 2 — Simplify login UI

- Remove the account-kind state from the login form where it is only needed to drive the selector and call `login(identifier, password, 'auto')` for every sign-in.
- Replace the conditional identifier label and placeholder with **Username** and a username-focused prompt.
- Keep `autoComplete="username"` and the current password behavior.
- Place **Create a resident account** and **Register a barangay administrator account** links in a stable visible area independent of account type.
- Preserve automatic account-kind selection in `AuthContext`, including the correct dashboard landing route after success.

**Exit criteria:** The login screen matches the requested copy, contains no account-type selector, account detection remains automatic, and both registration links remain reachable.

### Phase 3 — Username capture across account creation

- Add required username fields and global availability feedback to master-admin setup, central dashboard account creation/registration, public barangay-admin registration, barangay team creation, and every resident registration form that creates a web-capable account.
- Update API schemas and `web-dashboard/src/lib/api.ts` payload types to send the normalized username.
- Add server-side checks to each path and ensure final inserts return the same conflict response when the database uniqueness rule wins a race.
- Extend account profile and team edit flows to use the global check, excluding the account being edited.
- Review serialization and error handling for any route that creates an account plus related records; ensure a uniqueness conflict does not leave a partial account, officer row, certification, or pending-registration record.

**Exit criteria:** Every supported new account creation screen asks for a username, and every corresponding backend route rejects a username already assigned to any account type.

### Phase 4 — Optional barangay-admin email and channel selection

- Update `BarangayRegistrationPage.tsx` so email is optional, mobile/email OTP options reflect entered contact details, and username is required.
- Update the registration API wrapper and `barangayRegistrationOtpSchema` to accept an optional email and the chosen delivery method while requiring at least one destination.
- Send OTPs only through the selected available channel, namespace OTP keys by registration purpose/channel, and retain expiry and attempt limits.
- Update verification to identify the pending registration without assuming email is present; persist nullable email and use SMS or email credential/password-setup flow according to the chosen channel.
- Ensure the no-email path never invokes email delivery. Keep unrelated email-based recovery workflows unaffected.

**Exit criteria:** Applicants with only a mobile number can complete registration through SMS; applicants with email can choose an available channel; no email means no email OTP or email-only password delivery.

### Phase 5 — Verification and rollout

- Build the web dashboard and backend after implementation.
- Verify auto-login for MDRRMO, barangay, and resident accounts using a unique username, including correct role/session routing.
- Verify visible copy and registration links at desktop and narrow/mobile viewport sizes.
- Verify case-only duplicates, duplicate usernames across each pair of account tables, simultaneous duplicate submissions, username edits, and account deletion cleanup.
- Verify username conflicts return a clear validation error without partial account side effects.
- Verify barangay signup with SMS-only, email-only, and both-channel choices; test incorrect, expired, resent, and already-used OTPs, missing destinations, and omitted email.
- Verify existing resident/barangay/MDRRMO password reset and change flows still use their currently supported channels.
- Deploy the collision cleanup before the global registry migration, then deploy backend enforcement and frontend updates in a coordinated order. Monitor unique-constraint conflicts and OTP delivery failures during rollout.

## Acceptance criteria

1. Login has no **Account type** selector and labels its identifier field **Username**.
2. Login always uses automatic account discovery and routes each successful account to the correct workspace.
3. No new sign-in-capable account can reuse a username, regardless of capitalization or account type.
4. All supported new-account forms collect a username, and account/profile edits preserve global uniqueness.
5. Barangay-admin registration works with mobile only, email only, or both, and offers OTP delivery only to supplied contact destinations.
6. When no email is supplied for barangay-admin registration, no email OTP or email-only credential is generated or sent.
7. Existing unrelated email OTP/recovery workflows continue to work.
