export type IncidentTimelineItem = { label: string; at?: string | null; detail?: string | null };

type AssignmentEvent = {
  event_type?: string | null;
  from_barangay_name?: string | null;
  to_barangay_name?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

type BarangayAssignment = {
  barangay_name?: string | null;
  assignment_status?: string | null;
  assigned_at?: string | null;
  dispatched_at?: string | null;
  accepted_at?: string | null;
  arrived_at?: string | null;
  resolved_at?: string | null;
  resolved_notes?: string | null;
  escalated_at?: string | null;
  updated_at?: string | null;
};

type IncidentTimelineSource = {
  created_at?: string | null;
  review_outcome?: string | null;
  review_reason?: string | null;
  reviewed_at?: string | null;
  resubmission_count?: number | null;
  resubmitted_at?: string | null;
  send_to?: string | null;
  status?: string | null;
  response_status?: string | null;
  mdrrmo_response_status?: string | null;
  mdrrmo_dispatched_at?: string | null;
  mdrrmo_accepted_at?: string | null;
  mdrrmo_arrived_at?: string | null;
  mdrrmo_resolved_at?: string | null;
  dispatched_at?: string | null;
  accepted_at?: string | null;
  arrived_at?: string | null;
  resolved_at?: string | null;
  barangay_assigned_at?: string | null;
  barangay_dispatched_at?: string | null;
  barangay_accepted_at?: string | null;
  barangay_arrived_at?: string | null;
  barangay_resolved_at?: string | null;
  barangay_escalated_at?: string | null;
  barangay_resolved_notes?: string | null;
  is_escalated?: boolean;
  response_barangay_name?: string | null;
  barangay_name?: string | null;
  barangay_assignment_events?: AssignmentEvent[] | null;
  barangay_assignments?: BarangayAssignment[] | null;
};

function timestamp(value?: string | null) {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function orderedEvents(events: IncidentTimelineItem[]) {
  const [received, ...rest] = events;
  const sorted = rest
    .map((event, index) => ({ event, index, time: timestamp(event.at) }))
    .sort((a, b) => {
      if (Number.isFinite(a.time) && Number.isFinite(b.time)) return a.time - b.time || a.index - b.index;
      if (Number.isFinite(a.time)) return -1;
      if (Number.isFinite(b.time)) return 1;
      return a.index - b.index;
    })
    .map(({ event }) => event);
  return received ? [received, ...sorted] : sorted;
}

export function buildIncidentTimeline(report: IncidentTimelineSource): IncidentTimelineItem[] {
  const events: IncidentTimelineItem[] = [{
    label: 'Report received by MDRRMO',
    at: report.created_at,
    detail: 'MDRRMO received the report for review.',
  }];

  if (report.review_outcome) {
    const inconclusive = String(report.review_outcome).toLowerCase() === 'inconclusive';
    events.push({
      label: inconclusive ? 'Report marked inconclusive' : 'Report marked False Reporter',
      at: report.reviewed_at,
      detail: report.review_reason || (inconclusive ? 'MDRRMO could not confirm the report.' : 'MDRRMO marked the report as false.'),
    });
  }
  if (Number(report.resubmission_count || 0) > 0) events.push({
    label: 'Report resubmitted for review',
    at: report.resubmitted_at,
    detail: 'The reporter corrected and resubmitted this report.',
  });

  const assignmentEvents = report.barangay_assignment_events || [];
  const assignments = report.barangay_assignments || [];
  const hasBarangayHistory = assignmentEvents.length > 0 || assignments.length > 0 || report.send_to === 'barangay' ||
    Boolean(report.response_barangay_name || report.barangay_assigned_at || report.barangay_dispatched_at || report.barangay_accepted_at || report.barangay_arrived_at || report.barangay_resolved_at || report.barangay_escalated_at);
  const handoffEvents = assignmentEvents.filter((event) => ['recalled', 'escalated'].includes(String(event.event_type || '').toLowerCase()));
  const handoffTimes = [
    ...handoffEvents.map((event) => event.created_at),
    ...assignments.filter((item) => ['recalled', 'escalated'].includes(String(item.assignment_status || '').toLowerCase()))
      .flatMap((item) => [item.escalated_at, item.updated_at]),
    report.barangay_escalated_at,
  ].filter((value): value is string => Boolean(value));
  const latestHandoffAt = handoffTimes
    .filter((value) => Number.isFinite(timestamp(value)))
    .sort((a, b) => timestamp(b) - timestamp(a))[0] || handoffTimes[0];
  const returnedToMdrrmo = handoffTimes.length > 0 || Boolean(report.is_escalated && report.send_to === 'mdrrmo');
  const mdrrmoDispatchedAt = report.mdrrmo_dispatched_at || (report.send_to !== 'barangay' ? report.dispatched_at : null);
  const mdrrmoDispatchTime = timestamp(mdrrmoDispatchedAt);
  const handoffTime = timestamp(latestHandoffAt);
  const mdrrmoResponseFollowsRouting = !hasBarangayHistory || Boolean(
    returnedToMdrrmo && mdrrmoDispatchedAt && (
      (Number.isFinite(handoffTime) && Number.isFinite(mdrrmoDispatchTime) && mdrrmoDispatchTime >= handoffTime) ||
      (!Number.isFinite(handoffTime) && report.send_to === 'mdrrmo')
    ),
  );

  if (assignmentEvents.length > 0) {
    for (const event of assignmentEvents) {
      const type = String(event.event_type || '').toLowerCase();
      const from = event.from_barangay_name?.trim();
      const to = event.to_barangay_name?.trim();
      const destination = to ? ` · ${to}` : '';
      const label = type === 'assigned' ? (to ? `Assigned to barangay · ${to}` : 'Assigned to a barangay response team')
        : type === 'reassigned' ? `Reassigned${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}`
          : type === 'recalled' ? `Returned to MDRRMO${from ? ` from ${from}` : ''}`
            : type === 'dispatched' ? `Barangay responders dispatched${destination}`
              : type === 'responding' ? `Barangay responders accepted${destination}`
                : type === 'arrived' ? `Barangay responders arrived${destination}`
                  : type === 'resolved' ? `Response resolved${to ? ` · Barangay ${to}` : ' · Barangay'}`
                    : type === 'escalated' ? `Barangay escalated to MDRRMO${from ? ` · ${from}` : ''}`
                      : null;
      const detail = event.notes || (type === 'dispatched'
        ? 'The barangay response team was dispatched to the incident.'
        : type === 'responding'
          ? 'A barangay responder accepted the incident.'
          : type === 'arrived'
            ? 'The barangay response team confirmed arrival at the incident location.'
            : type === 'resolved'
              ? 'The barangay response was resolved.'
              : null);
      if (label) events.push({ label, at: event.created_at, detail });
    }
  } else if (assignments.length > 0) {
    for (const assignment of assignments) {
      const destination = assignment.barangay_name ? ` · ${assignment.barangay_name}` : '';
      const status = String(assignment.assignment_status || '').toLowerCase();
      if (assignment.assigned_at) events.push({ label: `Assigned to a barangay${destination}`, at: assignment.assigned_at });
      if (status === 'recalled') events.push({ label: `Returned to MDRRMO${assignment.barangay_name ? ` from ${assignment.barangay_name}` : ''}`, at: assignment.updated_at });
      if (status === 'reassigned') events.push({ label: `Barangay assignment reassigned${destination}`, at: assignment.updated_at });
      if (assignment.dispatched_at || assignment.accepted_at) events.push({
        label: `Barangay responders dispatched${destination}`,
        at: assignment.dispatched_at || assignment.accepted_at,
        detail: 'The barangay response team was dispatched to the incident.',
      });
      if (assignment.arrived_at) events.push({ label: `Barangay responders arrived${destination}`, at: assignment.arrived_at });
      if (assignment.escalated_at) events.push({ label: `Barangay escalated to MDRRMO${destination}`, at: assignment.escalated_at });
      if (assignment.resolved_at) events.push({
        label: `Response resolved${assignment.barangay_name ? ` · Barangay ${assignment.barangay_name}` : ' · Barangay'}`,
        at: assignment.resolved_at,
        detail: assignment.resolved_notes || 'The barangay response was resolved.',
      });
    }
  } else {
    const destination = report.response_barangay_name || report.barangay_name;
    const destinationLabel = destination ? ` · ${destination}` : '';
    if (report.barangay_assigned_at) events.push({ label: `Assigned to a barangay${destinationLabel}`, at: report.barangay_assigned_at });
    const barangayDispatchedAt = report.barangay_dispatched_at || (report.send_to === 'barangay' ? report.dispatched_at : null);
    if (barangayDispatchedAt) events.push({
      label: `Barangay responders dispatched${destinationLabel}`,
      at: barangayDispatchedAt,
      detail: 'The barangay response team was dispatched to the incident.',
    });
    if (report.barangay_accepted_at) events.push({ label: `Barangay responders accepted${destinationLabel}`, at: report.barangay_accepted_at });
    if (report.barangay_arrived_at) events.push({ label: `Barangay responders arrived${destinationLabel}`, at: report.barangay_arrived_at });
    if (report.barangay_escalated_at) events.push({ label: `Barangay escalated to MDRRMO${destinationLabel}`, at: report.barangay_escalated_at });
    if (report.barangay_resolved_at) events.push({
      label: `Response resolved${destination ? ` · Barangay ${destination}` : ' · Barangay'}`,
      at: report.barangay_resolved_at,
      detail: report.barangay_resolved_notes || 'The barangay response was resolved.',
    });
  }

  if (mdrrmoResponseFollowsRouting) {
    const acceptedAt = report.mdrrmo_accepted_at || (report.send_to !== 'barangay' ? report.accepted_at : null);
    const arrivedAt = report.mdrrmo_arrived_at || (report.send_to !== 'barangay' ? report.arrived_at : null);
    const resolvedAt = report.mdrrmo_resolved_at || (report.send_to !== 'barangay' ? report.resolved_at : null);
    if (mdrrmoDispatchedAt || acceptedAt) events.push({
      label: 'MDRRMO responders dispatched',
      at: mdrrmoDispatchedAt || acceptedAt,
      detail: 'MDRRMO responders were dispatched to the incident.',
    });
    if (arrivedAt) events.push({ label: 'MDRRMO responders arrived', at: arrivedAt, detail: 'MDRRMO responders confirmed arrival at the incident location.' });
    if (resolvedAt && [report.mdrrmo_response_status, report.response_status, report.status].some((value) => String(value || '').toLowerCase() === 'resolved')) {
      events.push({ label: 'Response resolved · MDRRMO', at: resolvedAt, detail: 'The MDRRMO response was resolved.' });
    }
  }

  return orderedEvents(events);
}
