import 'dart:convert';

class MdrrmoReport {
  final String id;
  final String type;
  final String title;
  final String? specifics;
  final String? description;
  final double latitude;
  final double longitude;
  final String? address;
  final String? reporterId;
  final String? reporterName;
  final String? reporterPhone;
  final DateTime? createdAt;
  final String status;
  final String responseStatus;
  final String? incidentType;
  final String? severity;
  final String? dispatchNotes;
  final String? resolutionNotes;
  final String? barangayName;
  final String? responderName;
  final DateTime? dispatchedAt;
  final DateTime? acceptedAt;
  final DateTime? arrivedAt;
  final DateTime? resolvedAt;
  final List<String> proofUrls;
  final List<String> proofTypes;
  final List<String> assignedResponderIds;
  final List<Map<String, dynamic>> assignments;
  final List<Map<String, dynamic>> responderMedia;

  const MdrrmoReport({
    required this.id,
    required this.type,
    required this.title,
    required this.latitude,
    required this.longitude,
    required this.status,
    required this.responseStatus,
    this.specifics,
    this.description,
    this.address,
    this.reporterId,
    this.reporterName,
    this.reporterPhone,
    this.createdAt,
    this.incidentType,
    this.severity,
    this.dispatchNotes,
    this.resolutionNotes,
    this.barangayName,
    this.responderName,
    this.dispatchedAt,
    this.acceptedAt,
    this.arrivedAt,
    this.resolvedAt,
    this.proofUrls = const [],
    this.proofTypes = const [],
    this.assignedResponderIds = const [],
    this.assignments = const [],
    this.responderMedia = const [],
  });

  bool get isResolved =>
      responseStatus == 'resolved' ||
      status == 'resolved' ||
      status == 'closed';
  bool get isResponding => responseStatus == 'responding';
  bool get isPending => !isResolved && !isResponding;

  static List<String> _stringList(dynamic value) {
    if (value is List)
      return value
          .map((item) => item.toString())
          .where((item) => item.isNotEmpty)
          .toList();
    if (value is String && value.trim().isNotEmpty) {
      try {
        final decoded = value.startsWith('[') ? jsonDecode(value) : null;
        if (decoded is List)
          return decoded
              .map((item) => item.toString())
              .where((item) => item.isNotEmpty)
              .toList();
      } catch (_) {}
      return value.contains('|||')
          ? value
                .split('|||')
                .map((item) => item.trim())
                .where((item) => item.isNotEmpty)
                .toList()
          : [value];
    }
    return const [];
  }

  static DateTime? _date(dynamic value) =>
      value == null ? null : DateTime.tryParse(value.toString());

  factory MdrrmoReport.fromJson(Map<String, dynamic> json) {
    final proofUrls = _stringList(json['proof_urls']).isNotEmpty
        ? _stringList(json['proof_urls'])
        : _stringList(json['proof_url']);
    final assignments = (json['mdrrmo_assignments'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    final mediaRaw = json['responder_media'];
    final media = mediaRaw is List
        ? mediaRaw
              .whereType<Map>()
              .map((item) => Map<String, dynamic>.from(item))
              .toList()
        : <Map<String, dynamic>>[];
    return MdrrmoReport(
      id: (json['id'] ?? '').toString(),
      type: (json['type'] ?? 'emergency').toString(),
      title: (json['title'] ?? 'Incident report').toString(),
      specifics: json['specifics']?.toString(),
      description: json['description']?.toString(),
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      address: json['address']?.toString(),
      reporterId: json['reporter_id']?.toString(),
      reporterName: json['reporter_name']?.toString(),
      reporterPhone: json['reporter_phone']?.toString(),
      createdAt: _date(json['created_at']),
      status: (json['status'] ?? 'pending').toString(),
      responseStatus: (json['mdrrmo_response_status'] ?? 'pending').toString(),
      incidentType: json['incident_type']?.toString(),
      severity: json['severity']?.toString(),
      dispatchNotes: json['mdrrmo_dispatch_notes']?.toString(),
      resolutionNotes: json['resolved_notes']?.toString(),
      barangayName:
          (json['barangay_name'] ??
                  (json['barangays'] is Map ? json['barangays']['name'] : null))
              ?.toString(),
      responderName: json['mdrrmo_responder_name']?.toString(),
      dispatchedAt: _date(json['dispatched_at']),
      acceptedAt: _date(json['accepted_at']),
      arrivedAt: _date(json['arrived_at']),
      resolvedAt: _date(json['resolved_at']),
      proofUrls: proofUrls,
      proofTypes: _stringList(json['proof_types']),
      assignedResponderIds:
          (json['assigned_responder_ids'] as List? ??
                  assignments.map((item) => item['responder_id']).toList())
              .map((item) => item.toString())
              .toList(),
      assignments: assignments,
      responderMedia: media,
    );
  }
}
