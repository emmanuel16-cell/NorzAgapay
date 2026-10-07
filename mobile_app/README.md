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
