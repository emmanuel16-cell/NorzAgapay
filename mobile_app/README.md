# NorzAgapay Mobile

Unified Flutter app for MDRRMO and barangay operations.

## Account workspaces

- MDRRMO Master Admin and Admin: verification, municipal incident oversight, accounts, advisories, analytics, and evacuation-station entry.
- MDRRMO Dispatcher: incident review/dispatch, responder location, and weather.
- MDRRMO Logistics: requests, response units, responder location, weather, and station entry.
- MDRRMO Responders: assigned response tasks, status updates, GPS, navigation, and field documentation.
- Barangay Admin, Dispatcher, Responder, and Staff: barangay-scoped operations, gated by the barangay coordination activation.

The mobile layout keeps the same authorized actions in a simplified, role-focused interface. The web dashboard remains the full operations workspace.

## Run locally

```sh
flutter pub get
flutter run
```

Set the API base URL for the barangay client in `lib/services/api_service.dart`, `lib/services/auth_service.dart`, and `lib/services/socket_service.dart`. MDRRMO API settings are in `lib/mdrrmo/core/constants.dart`.
