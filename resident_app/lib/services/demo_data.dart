import '../models/incident_report.dart';

DateTime _minutesAgo(int minutes) =>
    DateTime.now().subtract(Duration(minutes: minutes));

/// Synthetic incidents shared in spirit with the web and dispatcher previews.
List<IncidentReport> get residentDemoReports {
  final pendingReceived = _minutesAgo(12);
  final activeReceived = _minutesAgo(16);
  final activeDispatched = _minutesAgo(7);
  final activeAccepted = _minutesAgo(4);
  final resolvedReceived = _minutesAgo(205);
  final resolvedDispatched = _minutesAgo(190);
  final resolvedAccepted = _minutesAgo(184);
  final resolvedArrived = _minutesAgo(160);
  final resolvedAt = _minutesAgo(118);

  return [
    IncidentReport.fromJson({
      'id': 'demo-report-flood-pending',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Rising floodwater near Bigte Bridge',
      'specifics': 'Water is rising beside the bridge after heavy rain.',
      'description':
          'A family with children is asking for help moving to higher ground.',
      'status': 'pending',
      'send_to': 'mdrrmo',
      'latitude': 14.9161,
      'longitude': 121.0389,
      'address': 'Bigte Bridge approach, Barangay Bigte',
      'barangay_name': 'Bigte',
      'reporter_type': 'resident',
      'reporter_name': 'Maria Santos',
      'reporter_phone': '0917 555 0101',
      'created_at': pendingReceived.toIso8601String(),
      'client_submitted_at': pendingReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(39).toIso8601String(),
      'incident_time_precision': 'approximate',
      'mdrrmo_response_status': 'pending',
      'evidence_status': 'ready',
    }),
    IncidentReport.fromJson({
      'id': 'demo-report-fire-responding',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Residential fire near Poblacion market',
      'specifics': 'Smoke is visible from a two-storey home.',
      'description':
          'The fire is spreading toward the adjoining house. One older adult needs assistance.',
      'status': 'responding',
      'send_to': 'mdrrmo',
      'latitude': 14.9102,
      'longitude': 121.0485,
      'address': 'Mabini Street, Barangay Poblacion',
      'barangay_name': 'Poblacion',
      'reporter_type': 'resident',
      'reporter_name': 'Joel Reyes',
      'reporter_phone': '0917 555 0102',
      'created_at': activeReceived.toIso8601String(),
      'client_submitted_at': activeReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(24).toIso8601String(),
      'incident_time_precision': 'exact',
      'dispatched_at': activeDispatched.toIso8601String(),
      'accepted_at': activeAccepted.toIso8601String(),
      'barangay_response_status': 'responding',
      'barangay_responder_name': 'Carlo Mendoza',
      'barangay_response_notes':
          'Street secured and nearby residents moved to safety.',
      'mdrrmo_response_status': 'responding',
      'mdrrmo_responder_name': 'Carlo Mendoza',
      'mdrrmo_coordination_notes':
          'Escalated because the fire is spreading to an adjoining home.',
      'mdrrmo_response_notes':
          'Fire crew is en route; requesting an additional water tanker.',
      'evidence_status': 'ready',
    }),
    IncidentReport.fromJson({
      'id': 'demo-report-landslide-resolved',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Small landslide cleared in San Mateo',
      'specifics': 'Soil and rock briefly covered one lane after heavy rain.',
      'description':
          'Debris was removed, the road inspected, and the lane reopened.',
      'status': 'resolved',
      'send_to': 'mdrrmo',
      'latitude': 14.9242,
      'longitude': 121.0567,
      'address': 'Hillside Road, Barangay San Mateo',
      'barangay_name': 'San Mateo',
      'reporter_type': 'resident',
      'reporter_name': 'Liza Cruz',
      'reporter_phone': '0917 555 0104',
      'created_at': resolvedReceived.toIso8601String(),
      'client_submitted_at': resolvedReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(218).toIso8601String(),
      'incident_time_precision': 'approximate',
      'dispatched_at': resolvedDispatched.toIso8601String(),
      'accepted_at': resolvedAccepted.toIso8601String(),
      'arrived_at': resolvedArrived.toIso8601String(),
      'resolved_at': resolvedAt.toIso8601String(),
      'barangay_response_status': 'resolved',
      'barangay_responder_name': 'Bea Flores',
      'mdrrmo_response_status': 'resolved',
      'mdrrmo_responder_name': 'Bea Flores',
      'resolved_notes':
          'Debris cleared and the road reopened after inspection.',
      'evidence_status': 'ready',
    }),
  ];
}
