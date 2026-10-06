import '../models/mdrrmo_report.dart';
import '../../models/incident_report.dart' as barangay;

DateTime _minutesAgo(int minutes) =>
    DateTime.now().subtract(Duration(minutes: minutes));

List<MdrrmoReport> buildDemoMdrrmoReports({String? responderId}) {
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
    MdrrmoReport.fromJson({
      'id': 'demo-report-flood-pending',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Rising floodwater near Bigte Bridge',
      'specifics': 'Water is rising beside the bridge after heavy rain.',
      'description':
          'A family with children is asking for help moving to higher ground.',
      'status': 'pending',
      'mdrrmo_response_status': 'pending',
      'severity': 'high',
      'incident_type': 'flash_flood',
      'latitude': 14.9161,
      'longitude': 121.0389,
      'address': 'Bigte Bridge approach, Barangay Bigte',
      'barangay_name': 'Bigte',
      'reporter_name': 'Maria Santos',
      'reporter_phone': '0917 555 0101',
      'created_at': pendingReceived.toIso8601String(),
      'client_submitted_at': pendingReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(39).toIso8601String(),
      'incident_time_precision': 'approximate',
      'is_escalated': false,
      'proof_urls': [],
      'proof_types': [],
      'mdrrmo_assignments': [],
    }),
    MdrrmoReport.fromJson({
      'id': 'demo-report-fire-responding',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Residential fire near Poblacion market',
      'specifics': 'Smoke is visible from a two-storey home.',
      'description':
          'The fire is spreading toward the adjoining house. One older adult needs assistance.',
      'status': 'responding',
      'mdrrmo_response_status': 'responding',
      'severity': 'high',
      'incident_type': 'fire',
      'latitude': 14.9102,
      'longitude': 121.0485,
      'address': 'Mabini Street, Barangay Poblacion',
      'barangay_name': 'Poblacion',
      'reporter_name': 'Joel Reyes',
      'reporter_phone': '0917 555 0102',
      'created_at': activeReceived.toIso8601String(),
      'client_submitted_at': activeReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(24).toIso8601String(),
      'incident_time_precision': 'exact',
      'dispatched_at': activeDispatched.toIso8601String(),
      'accepted_at': activeAccepted.toIso8601String(),
      'mdrrmo_responder_name': 'Carlo Mendoza',
      'mdrrmo_dispatch_notes':
          'Approach from Mabini Street; keep the west lane open for the tanker.',
      'mdrrmo_response_notes':
          'Fire crew is en route; barangay team established a safety perimeter. Requesting one additional water tanker.',
      'is_escalated': true,
      'mdrrmo_assignments': [
        {
          'responder_id': responderId ?? 'demo-responder-fire-01',
          'status': 'responding',
          'assigned_at': activeDispatched.toIso8601String(),
          'accepted_at': activeAccepted.toIso8601String(),
          'responder': {'full_name': 'Carlo Mendoza', 'phone': '0917 555 0103'},
        },
      ],
      'proof_urls': [],
      'proof_types': [],
    }),
    MdrrmoReport.fromJson({
      'id': 'demo-report-landslide-resolved',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Small landslide cleared in San Mateo',
      'specifics': 'Soil and rock briefly covered one lane after heavy rain.',
      'description':
          'Debris was removed, the road inspected, and the lane reopened.',
      'status': 'resolved',
      'mdrrmo_response_status': 'resolved',
      'severity': 'moderate',
      'incident_type': 'landslide',
      'latitude': 14.9242,
      'longitude': 121.0567,
      'address': 'Hillside Road, Barangay San Mateo',
      'barangay_name': 'San Mateo',
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
      'mdrrmo_responder_name': 'Bea Flores',
      'mdrrmo_dispatch_notes':
          'Take the hillside route and bring road-clearing tools.',
      'resolved_notes':
          'Debris cleared, the road inspected, and the lane reopened.',
      'is_escalated': true,
      'mdrrmo_assignments': [
        {
          'responder_id': 'demo-responder-rescue-02',
          'status': 'resolved',
          'assigned_at': resolvedDispatched.toIso8601String(),
          'accepted_at': resolvedAccepted.toIso8601String(),
          'arrived_at': resolvedArrived.toIso8601String(),
          'resolved_at': resolvedAt.toIso8601String(),
          'responder': {'full_name': 'Bea Flores', 'phone': '0917 555 0105'},
        },
      ],
      'proof_urls': [],
      'proof_types': [],
    }),
  ];
}

List<barangay.IncidentReport> buildDemoBarangayReports({String? responderId}) {
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
    barangay.IncidentReport.fromJson({
      'id': 'demo-report-flood-pending',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Rising floodwater near Bigte Bridge',
      'specifics': 'Water is rising beside the bridge after heavy rain.',
      'description':
          'A family with children is asking for help moving to higher ground.',
      'status': 'pending',
      'severity': 'high',
      'incident_type': 'flash_flood',
      'latitude': 14.9161,
      'longitude': 121.0389,
      'address': 'Bigte Bridge approach, Barangay Bigte',
      'barangay_name': 'Bigte',
      'reporter_name': 'Maria Santos',
      'reporter_phone': '0917 555 0101',
      'created_at': pendingReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(39).toIso8601String(),
      'incident_time_precision': 'approximate',
      'barangay_response_status': 'pending',
      'mdrrmo_response_status': 'pending',
      'proof_urls': [],
      'proof_types': [],
    }),
    barangay.IncidentReport.fromJson({
      'id': 'demo-report-fire-responding',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Residential fire near Poblacion market',
      'specifics': 'Smoke is visible from a two-storey home.',
      'description':
          'The fire is spreading toward the adjoining house. One older adult needs assistance.',
      'status': 'responding',
      'severity': 'high',
      'incident_type': 'fire',
      'latitude': 14.9102,
      'longitude': 121.0485,
      'address': 'Mabini Street, Barangay Poblacion',
      'barangay_name': 'Poblacion',
      'reporter_name': 'Joel Reyes',
      'reporter_phone': '0917 555 0102',
      'created_at': activeReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(24).toIso8601String(),
      'incident_time_precision': 'exact',
      'dispatched_at': activeDispatched.toIso8601String(),
      'accepted_at': activeAccepted.toIso8601String(),
      'barangay_response_status': 'responding',
      'barangay_response_notes':
          'Street secured; nearby residents moved to safety.',
      'barangay_responded_by': responderId ?? 'demo-responder-fire-01',
      'barangay_responder_name': 'Carlo Mendoza',
      'assigned_team_leader_ids': [responderId ?? 'demo-responder-fire-01'],
      'mdrrmo_response_status': 'responding',
      'mdrrmo_coordination_notes':
          'Escalated because the fire is spreading to an adjoining home.',
      'mdrrmo_responder_name': 'Carlo Mendoza',
      'mdrrmo_response_notes':
          'Fire crew is en route; requesting one additional water tanker.',
      'proof_urls': [],
      'proof_types': [],
    }),
    barangay.IncidentReport.fromJson({
      'id': 'demo-report-landslide-resolved',
      'is_demo_data': true,
      'type': 'emergency',
      'title': 'Small landslide cleared in San Mateo',
      'specifics': 'Soil and rock briefly covered one lane after heavy rain.',
      'description':
          'Debris was removed, the road inspected, and the lane reopened.',
      'status': 'resolved',
      'severity': 'moderate',
      'incident_type': 'landslide',
      'latitude': 14.9242,
      'longitude': 121.0567,
      'address': 'Hillside Road, Barangay San Mateo',
      'barangay_name': 'San Mateo',
      'reporter_name': 'Liza Cruz',
      'reporter_phone': '0917 555 0104',
      'created_at': resolvedReceived.toIso8601String(),
      'incident_occurred_at': _minutesAgo(218).toIso8601String(),
      'incident_time_precision': 'approximate',
      'dispatched_at': resolvedDispatched.toIso8601String(),
      'accepted_at': resolvedAccepted.toIso8601String(),
      'arrived_at': resolvedArrived.toIso8601String(),
      'resolved_at': resolvedAt.toIso8601String(),
      'barangay_response_status': 'resolved',
      'barangay_responder_name': 'Bea Flores',
      'barangay_responded_by': 'demo-responder-rescue-02',
      'mdrrmo_response_status': 'resolved',
      'mdrrmo_responder_name': 'Bea Flores',
      'resolved_notes':
          'Debris cleared and the road reopened after inspection.',
      'proof_urls': [],
      'proof_types': [],
    }),
  ];
}
