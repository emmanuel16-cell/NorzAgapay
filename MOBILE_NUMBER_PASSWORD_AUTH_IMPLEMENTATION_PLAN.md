# Mobile Number and Password Authentication Implementation Plan

## Objective

Remove email addresses and usernames from NorzAgapay account creation, sign-in, profile management, account recovery, and user-facing contact features. Authenticate every account with a Philippine mobile number and password. Keep verification codes SMS-only for mobile ownership checks, password resets, and password changes.

Historical migrations that introduced retired fields remain immutable; the new forward cleanup migration removes their active schema structures safely.

## Implementation status

- Backend and web clients now use phone/password authentication, SMS-only verification and recovery, phone-based account matching, and phone-only report contacts.
- Resident and operations mobile screens, account models, and API wrappers have been updated to the same contract.
- Added read-only phone and contact-data preflights, a global normalized mobile registry migration, and a forward schema cleanup migration. Apply `20261017_mobile_number_auth_preflight.sql`, resolve all phone gaps/collisions, then apply `20261017_mobile_number_registry.sql`; review/export data reported by `20261017_email_username_cleanup_preflight.sql` before applying `20261017_email_username_cleanup.sql`.
- The database migrations have not been applied to a live database.
- Backend and web production builds pass. Flutter analysis reports no compile errors; existing project-wide lint findings remain.

## Scope and target behavior

- Apply one sign-in contract to resident, barangay, MDRRMO, and dashboard staff accounts: mobile number plus password.
- Accept local 09XXXXXXXXX input and pasted +639XXXXXXXXX input, then normalize account numbers to the existing local 09XXXXXXXXX form. Use the existing SMS service to convert the normalized number to international form for delivery.
- Require a valid mobile number on every new sign-in-capable account. Require a password at signup, or let the account owner set one after SMS verification. Do not send temporary passwords.
- Reserve each normalized number globally across users, barangay_users, and resident_user so automatic account discovery cannot resolve one number to multiple accounts. Inactive accounts continue to reserve their number until an administrator changes or removes the account.
- Use SMS OTP for registrations, forgotten-password recovery, and password-change verification. Remove all email delivery choices and email-only recovery paths.
- Remove email and username fields from account forms, account APIs, JWT identity payloads, profiles, account listings, and auth-related models.
- Remove email collection and display elsewhere in the product too: incident reporter email, officer email, dispatcher-verification email, email hotline action, email report contact actions, email-only copy, and email-derived account matching. Preserve phone contact behavior.

## Current-state map

- The backend has distinct auth paths for users, resident_user, and barangay_users in backend/src/routes/auth.ts and backend/src/routes/barangay.ts. Login accepts a mixture of email, username, and mobile number depending on account type.
- The web dashboard has auto account discovery, resident registration, barangay administrator registration, master-admin setup, user creation, barangay team management, and profile/password settings in web-dashboard/src.
- resident_app handles resident signup/login and resident profile recovery. mobile_app handles barangay registration/team management and MDRRMO responder login/profile recovery.
- Registration routes currently mix SMS and email OTP and may create an account with a generated temporary password delivered by SMS or email. Password reset/change routes also select between SMS and email.
- Account tables users, barangay_users, and resident_user contain email and username fields. A global username registry is added by the 20261015 migration. Phone numbers are not globally unique or consistently required.
- Email is also used to match an officers row to an MDRRMO responder account, in dispatcher verification data, and in reporter contact fields in incident reports. The resident hotline screen includes an email action.

## Implementation phases

### Phase 0 — Inventory, data preflight, and account recovery

- Inventory all account inserts, updates, sign-in calls, account serializers, JWT consumers, and notification/profile models across the backend, web dashboard, resident_app, and mobile_app.
- Add read-only database preflight queries for missing, invalid, and duplicate normalized mobile numbers across users, barangay_users, and resident_user. Report affected table and account IDs; do not assign numbers automatically.
- Audit officers and barangay_dispatcher_verifications for email-based links to accounts. Prepare phone-based matches and a manual resolution list for records without an unambiguous phone.
- Count email values in account, verification, officer, and incident-report data. Prepare a secured backup/export for authorized retention review before deleting stored email values.
- Confirm each existing account owner can verify a mobile number. Define an administrator-assisted recovery path for accounts with no valid number or a number shared with another account.

**Exit criteria:** Missing numbers, collisions, account-to-officer link gaps, and email data requiring removal are enumerated and have an explicit remediation owner.

### Phase 1 — Phone identity rules and database enforcement

- Add one shared backend mobile-number normalizer/validator using the project’s existing Philippine-number rules: convert +639XXXXXXXXX to 09XXXXXXXXX and reject non-mobile or incomplete values.
- Add a phone reservation registry, or an equivalent transactional database constraint, keyed by normalized number and linked to account table and ID. Synchronize it on account create, phone change, and delete. Keep the database constraint authoritative under concurrent requests.
- Add a phone uniqueness preflight and migration. Resolve duplicates before enabling the constraint. Require phone for newly created sign-in accounts after all supported clients submit it.
- Update the consolidated fresh-install schema and add a forward migration for existing Supabase installations. Do not rewrite already-applied migrations.
- Keep officer phone data outside sign-in uniqueness where it is a roster profile, but use its normalized phone to link the profile to a responder account. Resolve duplicate or missing profile/account phones before switching the match key.

**Exit criteria:** One normalized number maps to at most one sign-in account across all three account tables; account phone changes and deletes keep the registry consistent.

### Phase 2 — Backend auth and account API contract

- Update backend/src/routes/auth.ts and backend/src/routes/barangay.ts so login schemas accept only mobile number and password. Query account tables by normalized phone and remove email/username fallback branches.
- Preserve account-kind/role authorization and route behavior. Web auto discovery should try the known account tables by phone and return the correct account kind; the global phone constraint prevents ambiguity.
- Change master-admin setup, administrator-created responder/staff accounts, barangay team-member creation, resident registration, and barangay-admin registration to require a valid phone and password (or a post-SMS password setup step).
- Replace generated temporary passwords with a password entered at signup or created after successful SMS verification. Never send credentials in a message.
- Make all registration OTP routes SMS-only. Bind the pending registration to the normalized phone, role/context, and password hash; retain expiry, resend cooldown, and attempt limits.
- Make forgot-password routes accept a mobile number and deliver SMS OTP only. Apply the same generic response for unknown numbers to avoid account enumeration. Change-password routes may require the current password and SMS verification, with SMS as the sole delivery method.
- Remove email and username from request/response schemas, profile-update logic, account-list response shapes, auth context types, JWT claims, and the auth middleware identity type. Keep only user ID, role, account kind, and any required unit/barangay identifiers.
- Update backend/src/routes/debug.ts and any admin verification routes so debug login, account lookup, and verification actions use phone or account ID rather than email/username.

**Exit criteria:** Backend auth and account endpoints have one phone/password contract; no route can authenticate or create an account using an email address or username.

### Phase 3 — Web and mobile user flows

- Update web-dashboard/src/pages/LoginPage.tsx and web-dashboard/src/context/AuthContext.tsx to show Mobile number and Password and submit the normalized phone to automatic account discovery.
- Update web-dashboard/src/pages/ResidentRegistrationPage.tsx and BarangayRegistrationPage.tsx to collect mobile number and password, verify the number by SMS, and create accounts without email or username fields.
- Update web-dashboard/src/pages/UsersPage.tsx, BarangayTeamPage.tsx, BarangayAdministrationPage.tsx, and related account forms so admins create accounts with full name, mobile number, password/setup flow, and role-specific details.
- Update web-dashboard/src/components/UserSettingsModal.tsx to show/edit phone and remove email/username profile fields and email OTP selectors. Require SMS verification when changing the sign-in number.
- Update resident_app signup, login, profile, and recovery flows in lib/screens/profile_screen.dart and related screens/services to use phone/password and SMS-only codes.
- Update mobile_app login, barangay registration/team, and MDRRMO profile/recovery flows in lib/screens/login_screen.dart, lib/mdrrmo/screens/login_screen.dart, auth services/providers, and team screens to remove email and username controls.
- Update TypeScript and Dart account models plus API wrappers so email/username are absent rather than optional identity fallbacks. Keep display names and role/workspace routing intact.

**Exit criteria:** All supported clients present mobile number and password for account access, collect a mobile number/password for new accounts, and show SMS-only verification/recovery.

### Phase 4 — Remove remaining email and username product features

- Replace email-based officer-to-responder matching in backend/src/routes/respondUnits.ts, users.ts, tasks.ts, auth.ts, and database/schema.sql functions with normalized phone matching and explicit account IDs where available.
- Remove email from officer and barangay dispatcher verification forms, API schemas, database reads/writes, serializers, and profile displays. Preserve dispatcher approval and account activation workflow using phone.
- Remove reporter_email collection and response fields from resident/web report forms, incident APIs, report models, dashboard/mobile report views, generated reports/PDFs, and database report tables. Keep reporter_phone as the contact field.
- Remove the Email MDRRMO action from resident_app/lib/screens/hotlines_screen.dart and email contact data from hotline APIs. Keep phone and other supported contact actions.
- Remove email/username copy from legal/privacy text and account help text where it describes collected account data. Keep privacy text accurate about mobile number, password hash, and SMS verification.
- Remove backend/src/services/emailService.ts, SendGrid settings from backend config and backend/.env.example, and unused email dependencies from package manifests/lockfiles after confirming no remaining imports.
- Remove username-specific backend service logic and its active triggers, indexes, registry table, and account columns. Keep historical migration files immutable.

**Exit criteria:** No runtime route, form, account model, notification service, database column, or product UI uses email or username for accounts or contact handling.

### Phase 5 — Safe migration, coordinated release, and retirement

- Before deployment, export/backup affected data and run phone preflight against the live database. Resolve missing/invalid numbers and duplicates with owners/admins; verify numbers through SMS before assigning them as login identities.
- Deploy the phone registry and expanded phone-capable API first. Release updated web and mobile clients and complete phone verification for existing accounts.
- Once supported clients are updated and account coverage is complete, switch the backend to phone-only authentication and SMS-only recovery. Remove legacy email/username request aliases and endpoints in the same release window.
- Apply a forward cleanup migration after all deployed code stops reading the fields: remove email and username from users, barangay_users, resident_user, officers, barangay_dispatcher_verifications, and incident/report tables; remove account_usernames and username registry functions/triggers/indexes; remove email indexes and any email-derived constraints.
- Scrub or drop historical email values as requested. Remove malformed email strings from reporter_phone while preserving valid mobile numbers. Do not silently convert an email into a phone number.
- Update database/schema.sql so fresh installations match the final state and document the required migration order for existing installations.
- Monitor SMS delivery, duplicate-phone conflicts, failed logins, and password recovery after rollout. Provide an administrator-assisted process for account owners who cannot receive SMS.

**Exit criteria:** The production schema and deployed clients are phone/password-only, with no email or username authentication compatibility path remaining.

## Acceptance criteria

1. Resident, barangay, MDRRMO, and dashboard staff login uses a valid mobile number and password only.
2. Every new sign-in-capable account requires a verified, globally unique mobile number and a password or an SMS-verified password setup.
3. Signup, password reset, and password change verification codes are sent only by SMS; no email address or email OTP is requested or sent.
4. Profile and admin account-management screens contain no username or email fields.
5. No username registry, username account column, or email account column is active in the final database schema.
6. Responder/team matching works by phone or explicit account ID after email matching is removed.
7. Incident reporting and review use reporter mobile number only; email collection, display, and mailto actions are removed.
8. Existing users can access their accounts after migration without losing passwords or being silently assigned another person’s number.
9. Repeated/case/format variants of one Philippine mobile number normalize to one unique identity, including concurrent account creation attempts.
10. No supported backend endpoint, web client, or mobile client accepts email or username as an authentication fallback.
