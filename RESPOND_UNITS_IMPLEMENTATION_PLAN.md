# Respond Units implementation plan

## Goal

Make unit setup reliable for logistics Staff and master admins, while ensuring dispatchers can only dispatch a unit after Staff completes its roster and activates it for the day.

## Findings

- Unit creation currently requires an active responder account to be assigned as Team Leader immediately. That blocks Staff from creating a unit when no eligible responder account exists yet.
- The unit page opens its form only if the Team Leader account lookup succeeds, even though unit creation itself should not depend on that optional lookup.
- The roster list displays “No units found” after a failed load, hiding the difference between an empty roster and an API error.
- The dashboard shows dispatchers an activation action, but the database activation function permits only logistics Staff and master admins. The UI/API and database permissions disagree.
- The roster API counts any Team Leader membership as ready even when the linked responder account is inactive, while the database refuses activation in that case.

## Implementation steps

1. Align permissions so logistics Staff and master admins can manage and activate units; dispatchers can inspect units and dispatch only units already prepared by Staff.
2. Make Team Leader assignment optional during unit creation. Allow Staff to assign the leader later through the existing edit workflow.
3. Keep roster readiness and dispatch safeguards aligned: an active responder Team Leader, at least one Driver Responder, at least one First Aider Responder, and activation for the current Manila date are all required before dispatch. Show inactive Team Leader accounts clearly.
4. Keep the create/edit form usable if loading candidate Team Leader accounts fails, and show a clear message that the leader can be assigned later.
5. Render API load failures as retryable errors instead of an empty roster state.
6. Build the dashboard and backend to catch integration and type errors.

## Completion checks

- Logistics Staff and master admins can create an unassigned unit, then add roster members and assign a Team Leader later.
- Units without the required roster or today’s activation remain unavailable to dispatchers.
- Dispatchers do not see an activation control that would fail authorization.
- The page does not mark a unit dispatch-ready when its Team Leader account has been deactivated.
- A failed unit-list request has a visible retry state; a successful empty response still shows the create guidance.
