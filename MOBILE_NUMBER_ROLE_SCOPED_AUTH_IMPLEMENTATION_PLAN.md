# Role-Scoped Mobile Authentication Implementation Plan

## Status

Application changes are implemented in the working tree and backend/web builds pass. Production database migrations have not been applied. Do not retry `20261017_mobile_number_registry.sql`; apply the new forward migration after the updated preflight instead.

Implemented: exact `09XXXXXXXXX` validation, one-phone-per-account-table registry migration, cross-role password matching and guarded writes, login ambiguity responses, and account-kind-targeted SMS recovery. Remaining work is operational: inspect the preflight results, resolve missing/invalid phones and same-table duplicates, apply the forward migrations, then deploy the updated clients and backend.

## Objective and decisions

Keep phone/password authentication, SMS-only verification, and the exact local `09XXXXXXXXX` number format. Allow one person to use the same mobile number for separate MDRRMO, barangay, and resident accounts while keeping each account type unambiguous.

The account tables map to account types as follows:

| Account type | Table | Phone rule |
| --- | --- | --- |
| MDRRMO | `users` | A number can belong to at most one row in this table. |
| Barangay | `barangay_users` | A number can belong to at most one row in this table. |
| Resident | `resident_user` | A number can belong to at most one row in this table. |

The same `09XXXXXXXXX` value may appear once in each of these three tables. Passwords must be different between accounts that share a number. Password reuse for accounts with different numbers is allowed. Email and username remain removed from account authentication and recovery.

## Required login behavior

- Never identify an account by phone alone. A phone may identify up to three role-specific account candidates.
- For automatic account discovery, load the candidate rows for the supplied phone from `users`, `barangay_users`, and `resident_user`, then compare the submitted password against each candidate's password hash.
- If exactly one candidate password matches, apply that account's status/activation checks and return a token for its role. A pending or inactive match must not cause the API to stop before checking the other account types.
- If no candidate password matches, return the ordinary invalid-phone-or-password response.
- If the password matches more than one candidate, issue no token. Return a stable ambiguity error and direct the user to reset/change the password for one selected account type using SMS verification.
- Role-specific clients may keep role-specific login routes, but those routes must also detect a password that matches another account sharing the number and direct the user to resolve the reuse. Do not silently authenticate one of multiple matches.
- Apply rate limits to password attempts. Never log the submitted password, OTP, or password-equivalence data.

## Password-reuse enforcement

Passwords are bcrypt-hashed with salts, so equal passwords do not produce equal stored hashes. Enforce the rule in backend services by comparing the proposed plaintext password with every other account hash that has the same phone in a different account table. Exclude only the account being updated.

Run this check on every path that creates or changes an account password or changes the account's phone:

- Resident, barangay, and MDRRMO account creation, including SMS registration completion and administrator-created accounts.
- Forgot-password reset and authenticated password change.
- Account phone change, using the current password against other accounts already registered at the destination phone.
- Any account approval/activation path that creates the final sign-in-capable row from pending registration data.

Check once when registration begins for fast feedback and again immediately before the account write. Serialize the check-and-write operation with a token-safe, expiring Redis lock keyed by the exact phone number; renew or abort if the lock cannot be held, and release only the lock token owned by the request. The per-table database uniqueness constraint remains the final safeguard against concurrent same-role account creation. All backend service-role account writes must go through these guarded services.

For existing accounts that share a phone, identical passwords cannot be detected by SQL preflight alone. At login, compare against all candidate hashes and block if more than one matches. The account-specific SMS recovery flow then lets the owner change one password; the new password must pass the same reuse check.

## Database and migration plan

1. Add a read-only preflight that reports missing/invalid phone values, duplicate phone values within each individual account table, and cross-role phone reuse in separate result sets. Cross-role reuse is informational and must not be reported as a uniqueness conflict. Keep the exact `09XXXXXXXXX` validation rule.
2. Add a forward migration that works whether the old global `account_mobile_numbers` registry is absent or already exists. Preserve all account rows and phone values; do not edit historical migrations or delete accounts to make the migration pass.
3. Change the registry key from globally unique `phone_normalized` to a composite key `(account_table, phone_normalized)`. Retain `UNIQUE (account_table, account_id)` so each account has one registry entry. Keep the allowed table-name check and service-role-only permissions.
4. Rebuild the registry from `users`, `barangay_users`, and `resident_user`. The composite key permits one matching number per role table and rejects a second account of the same role with that number. Keep insert/update/delete synchronization triggers and exact-format validation.
5. Update any account lookup or registration precheck that queries `account_mobile_numbers` to include `account_table`. Cross-role matches are allowed; same-table matches are rejected. Phone changes must exclude the current account from the same-table conflict check.
6. Add account-kind-targeted SMS password recovery so a phone shared across roles can reset the intended account. Scope OTP state and rate-limit keys by account type as well as phone, and re-check password uniqueness when the OTP is verified.
7. Update the fresh-install `database/schema.sql` to the composite-key model and document the forward migration order. Keep historical migration files immutable.

## Backend and client changes

- Compare the submitted password against all account hashes for that phone before issuing a token. Keep the dashboard's sequential account-kind login attempts: mismatched account types return 401, and a unique password match selects the correct kind. Reject multiple matches with a stable ambiguity code.
- Keep explicit role-specific login routes where the mobile apps already know their account type.
- Remove global-registry checks from signup, recovery, account creation, and phone-change paths. Replace them with account-table-scoped phone checks and the cross-role password-reuse check where applicable.
- Return a machine-readable ambiguity code for multiple password matches. The dashboard recovery form asks which account type to repair, then sends SMS OTP for that account; mobile apps retain their role-specific recovery flows.
- Keep account creation/recovery forms phone-only with password, and continue accepting only exact `09XXXXXXXXX` input. No email or username fallback is reintroduced.

## Rollout phases

### Phase 1 — Inventory and preflight

- Enumerate every account insert, password update, phone update, account lookup, and registry lookup in backend routes/services.
- Run the revised read-only preflight in each environment. Resolve missing/invalid numbers and same-table duplicates using verified owner numbers. Record cross-role phone reuse as expected data.
- Do not attempt to infer whether existing passwords are equal from their bcrypt hashes. The login ambiguity handling and targeted password reset will resolve that case safely.

### Phase 2 — Database transition

- Implement the composite registry migration so it handles both a missing registry and the old global registry.
- Verify same-role uniqueness, cross-role reuse, trigger synchronization, rollback behavior, and service-role-only access in the target database before release.
- Apply the migration only after the revised preflight reports no missing/invalid numbers or same-table duplicates.

### Phase 3 — Backend account resolution and password rule

- Implement account-wide password matching and the guarded password/phone write service.
- Cover registration start and completion, admin account creation, password reset/change, phone changes, and role-specific login.
- Add lock timeout/failure handling that fails closed before any protected write.

### Phase 4 — Dashboard and mobile flows

- Switch dashboard automatic login to the resolver and consume its returned account type.
- Add account-type selection to password recovery when a phone has multiple role accounts.
- Update all clients to show the reuse/ambiguity recovery guidance without exposing account details before SMS ownership is verified.

### Phase 5 — Deploy and monitor

- Back up production data, deploy the migration and backend before clients that depend on role-scoped duplicates, then release web and mobile clients.
- Monitor same-table phone conflicts, password-match ambiguity responses, lock failures, SMS delivery, and account recovery completion.
- Retain an administrator-assisted recovery process for owners who cannot receive SMS.

## Acceptance criteria

1. The exact `09XXXXXXXXX` format is required for all sign-in accounts.
2. One phone can be registered at most once in `users`, once in `barangay_users`, and once in `resident_user`; cross-table reuse succeeds.
3. A second account with that phone in the same table is rejected by the database even under concurrent requests.
4. Accounts sharing a phone cannot be created or updated to use the same password through any backend path.
5. Automatic phone/password login selects exactly one matching account across all three tables and returns the correct account type.
6. Zero password matches return a generic login failure; multiple matches issue no token and route the user to account-specific SMS recovery.
7. A matched pending/inactive account does not prevent a different active account with the same phone and a different password from authenticating.
8. Phone/password recovery targets the selected account type, and the replacement password is checked against sibling role accounts.
9. Cross-role phone reuse is informational in preflight; only missing/invalid values and same-table duplicates block the migration.
10. No email or username authentication, account-selection, or recovery path is reintroduced.
