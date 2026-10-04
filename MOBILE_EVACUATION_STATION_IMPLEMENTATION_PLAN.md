# Mobile Evacuation Station Implementation Plan

**Status:** Implemented in the workspace. Automated tests were not run.

## Goal

Update the barangay evacuation station experience in `mobile_app` so users can browse all active evacuation stations assigned to their barangay from a visible list beside the map. Selecting a station from the list or tapping its map pin should show the same station information.

## Current code findings

- `mobile_app/lib/screens/evac_centers_screen.dart` currently displays a collapsed station dropdown over the map. Selecting a dropdown item or tapping its pin opens the details sheet.
- The screen calls the general `/api/evacuation-centers` list route, which can return stations from multiple barangays unless a barangay filter is supplied.
- `mobile_app/lib/models/barangay_user.dart` currently grants station management to admin, responder, and staff roles.
- The backend create, edit, and remove routes currently allow responders to mutate stations.
- The resident and MDRRMO clients, analytics, and web dashboard also use the general evacuation endpoints and must retain their current behavior.

## Target behavior

### Station list and map

- Replace the collapsed dropdown with a visible, scrollable list of all active stations associated with the signed-in barangay. Use a compact, expandable panel so the map remains usable.
- Show all stations for that barangay in the list and keep a pin for each station on the map. Selecting one station must not hide the others.
- Tapping a list row highlights that row and pin, moves the map to the station, and opens its details.
- Tapping a map pin highlights the corresponding list row and opens the same details.
- Keep the existing station name, barangay, address, distance, and estimated travel-time information where available.
- Keep loading, retry, and empty states. Only station managers should see an add action in the empty state.

### Role permissions

| Barangay role | Station access |
|---|---|
| Admin | View, add, edit, remove own-barangay stations |
| Staff | View, add, edit, remove own-barangay stations |
| Responder | View own-barangay stations and details only |
| Dispatcher | View own-barangay stations and details only |

Hide add, edit, and remove controls from responders and dispatchers. Enforce these restrictions on the server as well as in the UI.

### Barangay data isolation

- The barangay list and map should include only active records whose `barangay_id` matches the barangay ID in the authenticated session token.
- Derive the barangay scope on the server; do not rely on a client-supplied `barangay_id` as authorization.
- New stations should continue to receive `barangay_id` and `created_by` from the authenticated account. Update and soft-delete operations must constrain both station ID and authenticated barangay ID.
- Audit legacy records with null or incorrect barangay ownership before rollout. No schema migration is expected unless that audit finds a data or schema gap.

## Implementation steps

1. Add a barangay-authenticated list endpoint, for example `GET /api/evacuation-centers/barangay`, that returns active stations for the authenticated barangay.
2. Add a dedicated `ApiService` method for this endpoint and use it from `EvacCentersScreen`. Keep the existing general list and nearest-station endpoints available to resident, MDRRMO, analytics, and dashboard clients.
3. Replace the dropdown with a scrollable station-list panel. Keep one selected station state shared by list-row and map-pin interactions, and show identical details for either selection path.
4. Replace the current management capability check with admin/staff permissions. Apply it to the Add Station action, details-sheet edit/remove controls, and empty state.
5. Restrict backend create, update, and remove routes to admin/staff. Keep updates and soft deletes scoped to the authenticated user's barangay; reject unauthorized role changes with `403` and cross-barangay station IDs without mutating data.
6. Refresh the barangay station collection after add, edit, or remove so the visible list and map pins stay in sync. Soft-deleted stations should disappear from both.
7. Verify the resident nearest-station experience and MDRRMO/dashboard cross-barangay station browsing remain unchanged.

## Acceptance checks

- The list and map show all active stations belonging to the signed-in user's barangay and no stations belonging to another barangay.
- Supplying another barangay ID from the client cannot widen the authenticated list response.
- Selecting a list row or map pin opens the same station details and highlights the same station in both views.
- Admin and staff can add, edit, and remove stations in their barangay.
- Responders and dispatchers can browse and view details but have no mutation controls; direct API mutation attempts are rejected.
- A user cannot edit or remove a station owned by another barangay.
- Loading, error/retry, and role-specific empty states behave correctly.
- Resident nearest-station results and MDRRMO/dashboard cross-barangay views continue to work as before.

## Verification plan

- Add backend authorization and ownership tests for list, create, edit, and remove routes across all four barangay roles.
- Add mobile widget tests for station-list rendering, list and marker selection, role-specific controls, and loading/error/empty states.
- Run the relevant backend and Flutter test suites, then manually verify the station list and map interactions on a mobile-sized screen.
