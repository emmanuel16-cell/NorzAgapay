# NorzAgapay Mobile

Unified Flutter app for MDRRMO and barangay operations.

## Account workspaces

- MDRRMO Responder: assigned response tasks, status updates, GPS location, and field documentation.
- Barangay Admin, Dispatcher, Responder, and Staff: barangay-scoped operations, gated by the barangay coordination activation.

MDRRMO incident review, dispatch, administration, and logistics are handled in the web dashboard. The mobile app provides the MDRRMO responder workflow and the separate barangay-scoped workflows.

## Run locally

```sh
flutter pub get
flutter run
```

Set the API base URL for the barangay client in `lib/services/api_service.dart`, `lib/services/auth_service.dart`, and `lib/services/socket_service.dart`. MDRRMO API settings are in `lib/mdrrmo/core/constants.dart`.

## Dispatcher incident notifications

The barangay dispatcher app uses Socket.IO and API refreshes for foreground
delivery, and Firebase Cloud Messaging (FCM) for notifications while the app is
in the background or closed. FCM remains inactive until Firebase is configured.

1. Register the Android app ID `ph.gov.mdrrmo.norzagapay_mobile` in the Firebase
   project and enable Cloud Messaging.
2. Build the Android app with these Firebase public app values:

   ```sh
   flutter run --dart-define=FIREBASE_API_KEY=<api-key> --dart-define=FIREBASE_MESSAGING_SENDER_ID=<sender-id> --dart-define=FIREBASE_PROJECT_ID=<project-id> --dart-define=FIREBASE_ANDROID_APP_ID=<android-app-id>
   ```

   Android 13+ asks the dispatcher for notification permission at first use.
3. Set `FIREBASE_PROJECT_ID` and the Firebase Admin service account JSON in the
   backend host's protected environment (`FIREBASE_SERVICE_ACCOUNT_JSON`). Keep
   the service account private; it must not be included in the mobile app or
   committed to the repository.
4. Run `database/migrations/dispatcher_push_notifications_migration.sql` in
   the Supabase SQL editor, then redeploy the backend and rebuild/install the
   mobile app with the Firebase values.

The backend only targets active dispatcher devices in the report's barangay.
The lock-screen message does not include reporter contact details or the report
description. Tapping it opens that report in the authenticated mobile app.

## MDRRMO responder dispatch notifications

The responder workspace shows one red in-app alert for a newly assigned report.
Android push notifications also arrive when the app is backgrounded or closed.
Socket and FCM alerts are deduplicated by report, and tapping the push opens the
assigned report. Push delivery requires the backend Firebase Admin credentials
and the responder token migration below.

1. In Supabase SQL Editor, run
   `database/migrations/mdrrmo_responder_push_notifications_migration.sql`
   after `mdrrmo_report_assignment_canonical_fk_migration.sql`.
2. Confirm the backend host has `FIREBASE_PROJECT_ID=norzagapay` and its protected
   `FIREBASE_SERVICE_ACCOUNT_JSON` secret, then redeploy the backend.
3. Build and install the Android app with the Firebase app values for
   `ph.gov.mdrrmo.norzagapay_mobile` (the same four `--dart-define` values shown
   in the dispatcher setup above).
4. Sign in to the responder account and allow notifications when Android asks.
5. Dispatch a report to that responder. Verify the Pending list and red alert
   while the app is open, then repeat with the app in the background and closed.
