# Responder Tracker UI Layout and Implementation Plan

## Goal

Update the existing Responder Tracker screen to show each assignment as a responder/report card with a five-step, left-to-right response timeline. Preserve the current dark dashboard styling, summary cards, response filter, live updates, and map shortcut.

## Proposed screen layout

Keep the page header and summary row shown in the reference. Each response card should use this order:

1. **Responder header:** responder avatar/name (or responder names for a team dispatch) on the left; current status badge on the right.
2. **Report summary:** report title, then three compact fields for **Type**, **Category**, and **Priority**. Show address as a secondary line when available. Give priority a clear colored badge (critical/high/moderate/low).
3. **Response timeline:** five evenly spaced milestones connected by short dashed lines:

   `● Accepted ┄┄ ● En route ┄┄ ● Arrived ┄┄ ● Resolved ┄┄ ● Returned`

   Under each milestone, show its local time (for example, `5:00 AM`) and elapsed time (for example, `5 min`). Completed milestones use the existing success treatment; the current milestone is highlighted; upcoming milestones stay muted and show `—` until recorded. Put the duration on the milestone/segment it describes, and recalculate the active duration while the task is live. On narrow screens, stack the same five milestones vertically so labels and times remain readable.

4. **Card footer:** dispatched time, GPS freshness, and the existing “View in map” action.

Example timing labels:

- Accepted: `5:00 AM` · `5 min from dispatch`
- En route: `Since 5:00 AM` · `6 min to arrival`
- Arrived: `5:06 AM` · `8 min on scene`
- Resolved: `5:14 AM` · `5 min to return`
- Returned: `5:19 AM` · `18 min total`

Do not show estimated or inferred timestamps as completed milestones. For a milestone without a recorded event, show a dash and keep it pending.

## Data mapping and gaps

The tracker is in `web-dashboard/src/pages/ResponderTrackerPage.tsx`; its task list currently returns `incident:incidents(*)`, assigned responder details, and task timestamps. The report table uses `incident_reports.type` for the report type (`emergency`/`community`), `title` for its category, `severity` for priority, and `incident_type` for the dispatcher’s incident classification. Fetch the linked report through `dispatch_incident_id` and use:

- Type: `incident_reports.type`
- Category: `incident_reports.title`
- Priority: `incident_reports.severity`, falling back to the linked incident’s severity
- Dispatch time: `incident_reports.dispatched_at`, falling back to `tasks.created_at`
- Accepted: `tasks.accepted_at`
- En route: the interval beginning at `accepted_at` and ending at `arrived_at` (acceptance currently begins the responder’s travel state)
- Arrived: `tasks.arrived_at`
- Resolved: linked `incident_reports.resolved_at`
- Returned: a new, explicit `tasks.returned_at`

The existing mobile workflow has `pending → accepted → in_progress → completed`; `completed` currently resolves the report at the scene and frees the responder. `tasks.returning_at` already exists, but the responder mobile model/actions do not expose a return state, and there is no separate returned timestamp. Keep resolution and return distinct: completing the on-scene work should capture the existing response proof photo, set the report’s `resolved_at`, transition the task to `returning`, and set `returning_at`; a new “Mark returned” action should transition to `completed`, set `returned_at` (and `completed_at` for task completion), and release the responder. Add `returning` to the persisted task status enum if it is not already present. Do not backfill `returned_at` from historical `completed_at`, because existing completions mean the response was resolved at the scene. This lets the tracker display the requested order without treating scene resolution as arrival back at base.

The existing card is one card per task/dispatch, and task-level timestamps are shared across its responders. Continue to show all assigned responder names on that card. If the desired behavior is a separate timeline per responder in a multi-responder dispatch, first move the lifecycle timestamps/status to the responder-assignment record; the current shared task timestamps cannot support separate truthful timelines.

## Implementation sequence

1. **Extend the task response** in `backend/src/routes/tasks.ts` to include the linked report fields needed by the card. Confirm how many reports can link to one dispatch and choose a deterministic report if there can be more than one.
2. **Update the responder lifecycle** across `backend/src/routes/tasks.ts`, the upload confirmation route, the task-status migration, and the mobile task model/detail flow. Capture and attach response proof while resolving on scene; record `returning_at`; then record `returned_at` and `completed_at` only when the responder marks returned. Keep cancellation handling separate.
3. **Refactor the tracker view model** in `ResponderTrackerPage.tsx`: define the five stages in the requested order, map each to its timestamp, compute elapsed time only from valid timestamp pairs, format local time consistently, and update current/complete/pending state logic. Keep socket refresh and GPS freshness behavior.
4. **Render the card and horizontal timeline** in `ResponderTrackerPage.tsx`, keeping the existing header/footer actions and empty/loading states. Add explicit Type, Category, and Priority fields.
5. **Add responsive styles** in `web-dashboard/src/index.css`: five-column desktop milestones with centered dots and dashed connectors, status colors that match the existing theme, priority badge variants, and a vertical mobile layout. Keep accessible text labels and non-color status cues.

## Acceptance criteria

- Each assigned responder card shows responder name, report type, category, and priority.
- The five stages appear left to right in the requested order on desktop, with dashed connectors and a readable mobile equivalent.
- Each recorded stage shows its event time and meaningful elapsed duration; missing events remain visibly pending.
- Resolution and return are separate events, and the returned time is not copied from the on-scene resolution time.
- Legacy completed tasks with no `returned_at` do not appear as though they returned to base.
- Live task changes update the status/timeline without losing current filters, GPS indicators, or map navigation.
