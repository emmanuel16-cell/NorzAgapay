import 'dart:convert';

class IncidentReport {
  static DateTime? _channelDate(
    Map<String, dynamic> json,
    String channel,
    String event,
    String legacyField,
  ) {
    final own = json['${channel}_$event'];
    if (own != null) return DateTime.tryParse(own.toString());
    final other = channel == 'barangay' ? 'mdrrmo' : 'barangay';
    if (json['${other}_$event'] != null) return null;
    final legacy = json[legacyField];
    return legacy == null ? null : DateTime.tryParse(legacy.toString());
  }

  final String id;
  final String type;
  final String title;
  final String? specifics;
  final String? description;
  final double latitude;
  final double longitude;
  final String? proofUrl;
  final String proofType;
  final int lifecycleRevision;
  final List<String> proofUrls;
  final List<String> proofTypes;
  final List<Map<String, dynamic>> responderMedia;
  final String status;
  final String? incidentType;
  final String? severity;
  final String? address;
  final String? reporterName;
  final String? reporterPhone;
  final String? reporterEmail;
  final String? barangayId;
  final String barangayResponseStatus; // 'pending' | 'responding' | 'resolved'
  final String? barangayResponseNotes;
  final String? barangayRespondedBy;
  final String? barangayResponderName;
  final List<String> assignedTeamLeaderIds;
  final String? mdrrmoCoordinationNotes;
  final String mdrrmoResponseStatus; // 'pending' | 'responding' | 'resolved'
  final String? mdrrmoResponderName;
  final DateTime? mdrrmoRespondedAt;
  final String? resolvedNotes;
  final DateTime? createdAt;
  final DateTime? incidentOccurredAt;
  final String incidentTimePrecision;
  final DateTime? dispatcherReviewedAt;
  final DateTime? dispatchedAt;
  final DateTime? acceptedAt;
  final double? travelDistanceM;
  final double? travelDistanceAccuracyM;
  final DateTime? travelDistanceFixAt;
  final DateTime? arrivedAt;
  final DateTime? arrivalRecordedAt;
  final String? arrivalMethod;
  final double? arrivalLatitude;
  final double? arrivalLongitude;
  final double? arrivalAccuracyM;
  final double? arrivalDistanceM;
  final DateTime? resolvedAt;
  final String resolutionPdfStatus;

  IncidentReport({
    required this.id,
    required this.type,
    required this.title,
    this.specifics,
    this.description,
    required this.latitude,
    required this.longitude,
    this.proofUrl,
    required this.proofType,
    this.lifecycleRevision = 0,
    List<String>? proofUrls,
    List<String>? proofTypes,
    List<Map<String, dynamic>>? responderMedia,
    required this.status,
    this.incidentType,
    this.severity,
    this.address,
    this.reporterName,
    this.reporterPhone,
    this.reporterEmail,
    this.barangayId,
    this.barangayResponseStatus = 'pending',
    this.barangayResponseNotes,
    this.barangayRespondedBy,
    this.barangayResponderName,
    this.assignedTeamLeaderIds = const [],
    this.mdrrmoCoordinationNotes,
    this.mdrrmoResponseStatus = 'pending',
    this.mdrrmoResponderName,
    this.mdrrmoRespondedAt,
    this.resolvedNotes,
    this.createdAt,
    this.incidentOccurredAt,
    this.incidentTimePrecision = 'unknown',
    this.dispatcherReviewedAt,
    this.dispatchedAt,
    this.acceptedAt,
    this.travelDistanceM,
    this.travelDistanceAccuracyM,
    this.travelDistanceFixAt,
    this.arrivedAt,
    this.arrivalRecordedAt,
    this.arrivalMethod,
    this.arrivalLatitude,
    this.arrivalLongitude,
    this.arrivalAccuracyM,
    this.arrivalDistanceM,
    this.resolvedAt,
    this.resolutionPdfStatus = 'missing',
  })  : proofUrls = proofUrls ?? (proofUrl != null ? [proofUrl] : []),
        proofTypes = proofTypes ?? [proofType],
        responderMedia = responderMedia ?? const [];

  bool get isEmergency => type == 'emergency';
  bool get isResponding =>
      barangayResponseStatus == 'responding' || status == 'responding';
  // The shared report status can reflect the other agency's closeout. Keep
  // Barangay report lists bound to the Barangay response cycle.
  bool get isResolved =>
      barangayResponseStatus == 'resolved' || status == 'resolved';
  bool get isPending => !isResponding && !isResolved;
  bool get isMdrrmoResponding => mdrrmoResponseStatus == 'responding';
  bool get isArrived => arrivedAt != null;

  String? get cleanBarangayNotes {
    if (barangayResponseNotes == null) return null;
    var clean = barangayResponseNotes!.replaceFirst(RegExp(r'^\[ASSIGNED:[^\]]+\]\s*'), '').trim();
    clean = clean.replaceFirst(RegExp(r'\[RESPONDER_MEDIA:[^\]]+\]'), '').trim();
    return clean.isEmpty ? null : clean;
  }

  bool isAssignedToUser(String userId, {String? userFullName}) {
    if (barangayRespondedBy == userId) return true;
    if (assignedTeamLeaderIds.contains(userId)) return true;
    if (userFullName != null &&
        barangayResponderName != null &&
        barangayResponderName!.toLowerCase().contains(userFullName.toLowerCase())) {
      return true;
    }
    return false;
  }

  factory IncidentReport.fromJson(Map<String, dynamic> json) {
    final rawNotes = json['barangay_response_notes'] as String?;
    List<String> assignedIds = [];
    if (json['assigned_team_leader_ids'] is List) {
      assignedIds = (json['assigned_team_leader_ids'] as List)
          .map((e) => e.toString())
          .toList();
    } else if (rawNotes != null && rawNotes.startsWith('[ASSIGNED:')) {
      final endIdx = rawNotes.indexOf(']');
      if (endIdx != -1) {
        final idsStr = rawNotes.substring('[ASSIGNED:'.length, endIdx);
        assignedIds = idsStr.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
      }
    }
    if (json['barangay_responded_by'] != null && !assignedIds.contains(json['barangay_responded_by'].toString())) {
      assignedIds.add(json['barangay_responded_by'].toString());
    }

    List<String> proofUrls = [];
    List<String> proofTypes = [];
    if (json['proof_urls'] is List && (json['proof_urls'] as List).isNotEmpty) {
      proofUrls = (json['proof_urls'] as List).map((e) => e.toString()).toList();
      proofTypes = json['proof_types'] is List
          ? (json['proof_types'] as List).map((e) => e.toString()).toList()
          : List.filled(proofUrls.length, json['proof_type'] ?? 'image');
    } else if (json['proof_url'] != null) {
      final rawProof = json['proof_url'].toString().trim();
      if (rawProof.startsWith('[') && rawProof.endsWith(']')) {
        try {
          final decoded = jsonDecode(rawProof);
          if (decoded is List) proofUrls = decoded.map((e) => e.toString()).toList();
        } catch (_) {}
      } else if (rawProof.contains('|||')) {
        proofUrls = rawProof.split('|||').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
      }
      if (proofUrls.isEmpty && rawProof.isNotEmpty) {
        proofUrls = [rawProof];
      }
      proofTypes = json['proof_types'] is List
          ? (json['proof_types'] as List).map((e) => e.toString()).toList()
          : List.filled(proofUrls.length, json['proof_type'] ?? 'image');
    }

    List<Map<String, dynamic>> responderMedia = [];
    if (json['responder_media'] is List) {
      responderMedia = (json['responder_media'] as List)
          .whereType<Map>()
          .map((m) => Map<String, dynamic>.from(m))
          .toList();
    } else if (rawNotes != null && rawNotes.contains('[RESPONDER_MEDIA:')) {
      final match = RegExp(r'\[RESPONDER_MEDIA:([\s\S]*?)\]').firstMatch(rawNotes);
      if (match != null && match.group(1) != null) {
        try {
          final decoded = jsonDecode(match.group(1)!);
          if (decoded is List) {
            responderMedia = decoded
                .whereType<Map>()
                .map((m) => Map<String, dynamic>.from(m))
                .toList();
          }
        } catch (_) {}
      }
    }

    final primaryProofUrl = proofUrls.isNotEmpty ? proofUrls.first : json['proof_url'];
    final primaryProofType = proofTypes.isNotEmpty ? proofTypes.first : (json['proof_type'] ?? 'image');

    return IncidentReport(
      id: json['id'] ?? '',
      type: json['type'] ?? 'emergency',
      title: json['title'] ?? '',
      specifics: json['specifics'],
      description: json['description'],
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0.0,
      proofUrl: primaryProofUrl,
      proofType: primaryProofType,
      lifecycleRevision: (json['lifecycle_revision'] as num?)?.toInt() ?? 0,
      proofUrls: proofUrls,
      proofTypes: proofTypes,
      responderMedia: responderMedia,
      status: json['status'] ?? 'pending',
      incidentType: json['incident_type'],
      severity: json['severity'],
      address: json['address'],
      reporterName: json['reporter_name'],
      reporterPhone: json['reporter_phone'],
      reporterEmail: json['reporter_email'],
      barangayId: json['barangay_id'],
      barangayResponseStatus: json['barangay_response_status'] ??
          json['response_status'] ??
          json['status'] ??
          'pending',
      barangayResponseNotes:
          json['barangay_response_notes'] ?? json['response_notes'],
      barangayRespondedBy:
          json['barangay_responded_by'] ?? json['responded_by'],
      barangayResponderName: json['barangay_responder_name'],
      assignedTeamLeaderIds: assignedIds,
      mdrrmoCoordinationNotes: json['mdrrmo_coordination_notes'],
      mdrrmoResponseStatus: json['mdrrmo_response_status'] ?? 'pending',
      mdrrmoResponderName: json['mdrrmo_responder_name'],
      mdrrmoRespondedAt: json['mdrrmo_responded_at'] != null ? DateTime.tryParse(json['mdrrmo_responded_at']) : null,
      resolvedNotes: json['barangay_resolved_notes'] ?? json['resolved_notes'],
      createdAt: json['created_at'] != null ? DateTime.tryParse(json['created_at']) : null,
      incidentOccurredAt: json['incident_occurred_at'] != null ? DateTime.tryParse(json['incident_occurred_at'].toString()) : null,
      incidentTimePrecision: const {'exact', 'approximate'}.contains(json['incident_time_precision']?.toString())
          ? json['incident_time_precision'].toString()
          : 'unknown',
      dispatcherReviewedAt: _channelDate(json, 'barangay', 'dispatcher_reviewed_at', 'dispatcher_reviewed_at'),
      dispatchedAt: _channelDate(json, 'barangay', 'dispatched_at', 'dispatched_at'),
      acceptedAt: _channelDate(json, 'barangay', 'accepted_at', 'accepted_at'),
      travelDistanceM: (json['travel_distance_m'] as num?)?.toDouble(),
      travelDistanceAccuracyM: (json['travel_distance_accuracy_m'] as num?)?.toDouble(),
      travelDistanceFixAt: json['travel_distance_fix_at'] != null ? DateTime.tryParse(json['travel_distance_fix_at']) : null,
      arrivedAt: _channelDate(json, 'barangay', 'arrived_at', 'arrived_at'),
      arrivalRecordedAt: json['arrival_recorded_at'] != null ? DateTime.tryParse(json['arrival_recorded_at']) : null,
      arrivalMethod: json['arrival_method'],
      arrivalLatitude: (json['arrival_latitude'] as num?)?.toDouble(),
      arrivalLongitude: (json['arrival_longitude'] as num?)?.toDouble(),
      arrivalAccuracyM: (json['arrival_accuracy_m'] as num?)?.toDouble(),
      arrivalDistanceM: (json['arrival_distance_m'] as num?)?.toDouble(),
      resolvedAt: _channelDate(json, 'barangay', 'resolved_at', 'resolved_at'),
      resolutionPdfStatus: json['resolution_pdf_status']?.toString() ?? 'missing',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type,
      'title': title,
      'specifics': specifics,
      'description': description,
      'latitude': latitude,
      'longitude': longitude,
      'proof_url': proofUrl,
      'proof_type': proofType,
      'status': status,
      'incident_type': incidentType,
      'severity': severity,
      'address': address,
      'reporter_name': reporterName,
      'reporter_phone': reporterPhone,
      'reporter_email': reporterEmail,
      'barangay_id': barangayId,
      'barangay_response_status': barangayResponseStatus,
      'barangay_response_notes': barangayResponseNotes,
      'barangay_responded_by': barangayRespondedBy,
      'barangay_responder_name': barangayResponderName,
      'assigned_team_leader_ids': assignedTeamLeaderIds,
      'mdrrmo_coordination_notes': mdrrmoCoordinationNotes,
      'mdrrmo_response_status': mdrrmoResponseStatus,
      'mdrrmo_responder_name': mdrrmoResponderName,
      'mdrrmo_responded_at': mdrrmoRespondedAt?.toIso8601String(),
      'resolved_notes': resolvedNotes,
      'created_at': createdAt?.toIso8601String(),
      'incident_occurred_at': incidentOccurredAt?.toIso8601String(),
      'incident_time_precision': incidentTimePrecision,
      'dispatcher_reviewed_at': dispatcherReviewedAt?.toIso8601String(),
      'dispatched_at': dispatchedAt?.toIso8601String(),
      'accepted_at': acceptedAt?.toIso8601String(),
      'travel_distance_m': travelDistanceM,
      'travel_distance_accuracy_m': travelDistanceAccuracyM,
      'travel_distance_fix_at': travelDistanceFixAt?.toIso8601String(),
      'arrived_at': arrivedAt?.toIso8601String(),
      'arrival_recorded_at': arrivalRecordedAt?.toIso8601String(),
      'arrival_method': arrivalMethod,
      'arrival_latitude': arrivalLatitude,
      'arrival_longitude': arrivalLongitude,
      'arrival_accuracy_m': arrivalAccuracyM,
      'arrival_distance_m': arrivalDistanceM,
      'resolved_at': resolvedAt?.toIso8601String(),
      'resolution_pdf_status': resolutionPdfStatus,
    };
  }
}
