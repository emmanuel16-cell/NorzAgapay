# NorzAgapay Mobile

Unified Flutter app for MDRRMO and barangay operations.

## Account workspaces

- MDRRMO Dispatcher: incident review and dispatch, responder locations, and weather.
- MDRRMO Responder: assigned response tasks, status updates, GPS location, and field documentation.
- Barangay Admin, Dispatcher, Responder, and Staff: barangay-scoped operations, gated by the barangay coordination activation.

MDRRMO mobile access is limited to dispatcher and responder accounts. MDRRMO administration and logistics remain in the web dashboard. Dispatcher and responder workflows are role-specific and use the same light, navy-and-teal visual style as the barangay app.

## Run locally

```sh
flutter pub get
flutter run
```

Set the API base URL for the barangay client in `lib/services/api_service.dart`, `lib/services/auth_service.dart`, and `lib/services/socket_service.dart`. MDRRMO API settings are in `lib/mdrrmo/core/constants.dart`.
