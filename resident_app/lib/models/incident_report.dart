import 'dart:convert';

class IncidentReport {
  final String? id;
  final String type;
  final String title;
  final String? specifics;
  final String? description;
  final double latitude;
  final double longitude;
  final String? proofUrl;
  final String proofType;
  final DateTime? createdAt;
  final DateTime? clientSubmittedAt;
  final DateTime? incidentOccurredAt;
  final String incidentTimePrecision;
  final DateTime? dispatcherReviewedAt;
  final DateTime? dispatchedAt;
  final DateTime? acceptedAt;
  final double? travelDistanceM;
  final double? travelDistanceAccuracyM;
  final DateTime? arrivedAt;
  final String? arrivalMethod;
  final double? arrivalDistanceM;
  final DateTime? resolvedAt;
  final String? status;
  final String? address;
  final String? reporterId;
  final String? reporterName;
  final String? reporterPhone;
  final String? reporterPhotoUrl;
  final String? reporterType;
  final String? barangayId;
  final String? barangayName;
  final String? barangayResponderName;
  final String? sendTo;
  final bool isEscalated;
  final String? barangayResponseStatus;
  final String? barangayResponseNotes;
  final String? mdrrmoResponseStatus;
  final String? mdrrmoResponderName;
  final String? mdrrmoCoordinationNotes;
  final bool isCentralAssignment;
  final String? assignmentStatus;
  final String? responseBarangayName;
  final DateTime? barangayAssignedAt;
  final DateTime? barangayDispatchedAt;
  final DateTime? barangayAcceptedAt;
  final DateTime? barangayArrivedAt;
  final DateTime? barangayResolvedAt;
  final DateTime? barangayEscalatedAt;
  final List<Map<String, dynamic>> barangayAssignments;
  final String? resolvedNotes;
  final String? reviewOutcome;
  final String? reviewReason;
  final String evidenceStatus;
  final int lifecycleRevision;
  final double? expectedResponseSeconds;
  final double? expectedArrivalSeconds;
  final double? expectedResolutionSeconds;
  final int expectedResponseSampleCount;
  final int expectedArrivalSampleCount;
  final int expectedResolutionSampleCount;
  final String? arrivalEstimateMethod;
  final List<Map<String, dynamic>> responderMedia;

  /// All proof URLs for this report. Falls back to [proofUrl] if the API
  /// doesn't yet return a list.
  final List<String> proofUrls;

  /// Proof type for each item in [proofUrls].
  final List<String> proofTypes;

  IncidentReport({
    this.id,
    required this.type,
    required this.title,
    this.specifics,
    this.description,
    required this.latitude,
    required this.longitude,
    this.proofUrl,
    required this.proofType,
    this.createdAt,
    this.clientSubmittedAt,
    this.incidentOccurredAt,
    this.incidentTimePrecision = 'unknown',
    this.dispatcherReviewedAt,
    this.dispatchedAt,
    this.acceptedAt,
    this.travelDistanceM,
    this.travelDistanceAccuracyM,
    this.arrivedAt,
    this.arrivalMethod,
    this.arrivalDistanceM,
    this.resolvedAt,
    this.status,
    this.address,
    this.reporterId,
    this.reporterName,
    this.reporterPhone,
    this.reporterPhotoUrl,
    this.reporterType,
    this.barangayId,
    this.barangayName,
    this.barangayResponderName,
    this.sendTo,
    this.isEscalated = false,
    this.barangayResponseStatus,
    this.barangayResponseNotes,
    this.mdrrmoResponseStatus,
    this.mdrrmoResponderName,
    this.mdrrmoCoordinationNotes,
    this.isCentralAssignment = false,
    this.assignmentStatus,
    this.responseBarangayName,
    this.barangayAssignedAt,
    this.barangayDispatchedAt,
    this.barangayAcceptedAt,
    this.barangayArrivedAt,
    this.barangayResolvedAt,
    this.barangayEscalatedAt,
    List<Map<String, dynamic>>? barangayAssignments,
    this.resolvedNotes,
    this.reviewOutcome,
    this.reviewReason,
    this.evidenceStatus = 'ready',
    this.lifecycleRevision = 0,
    this.expectedResponseSeconds,
    this.expectedArrivalSeconds,
    this.expectedResolutionSeconds,
    this.expectedResponseSampleCount = 0,
    this.expectedArrivalSampleCount = 0,
    this.expectedResolutionSampleCount = 0,
    this.arrivalEstimateMethod,
    List<Map<String, dynamic>>? responderMedia,
    List<String>? proofUrls,
    List<String>? proofTypes,
  }) : proofUrls = proofUrls ?? (proofUrl != null ? [proofUrl] : []),
       proofTypes = proofTypes ?? [proofType],
       responderMedia = responderMedia ?? const [],
       barangayAssignments = barangayAssignments ?? const [];

  /// Normalized display status from the applicable response channels.
  String get displayStatus {
    final outcome = (reviewOutcome ?? '').toLowerCase().trim();
    if (outcome == 'inconclusive' || outcome == 'false_report') return outcome;
    final s = (status ?? '').toLowerCase().trim();
    final m = (mdrrmoResponseStatus ?? '').toLowerCase().trim();
    final b = (barangayResponseStatus ?? '').toLowerCase().trim();

    if (isCentralAssignment && assignmentStatus == 'active') {
      if (b == 'resolved' || b == 'closed') return 'resolved';
      if (b == 'responding') return 'responding';
      return 'pending';
    }
    if (isCentralAssignment && assignmentStatus == 'completed') return 'resolved';
    if (isCentralAssignment && ['escalated', 'reassigned', 'recalled'].contains(assignmentStatus)) {
      if (m == 'responding') return 'responding';
      if (m == 'resolved' || m == 'closed') return 'resolved';
      return 'pending';
    }

    if (isEscalated) {
      if (m == 'responding' || b == 'responding') return 'responding';
      if ((m == 'resolved' || m == 'closed') && (b == 'resolved' || b == 'closed')) {
        return 'resolved';
      }
      return 'pending';
    }
    final channelStatus = sendTo == 'mdrrmo'
        ? m
        : b.isNotEmpty
            ? b
            : m;
    if (channelStatus == 'responding') return 'responding';
    if (channelStatus == 'resolved' || channelStatus == 'closed') return 'resolved';
    if (channelStatus.isNotEmpty) return 'pending';
    if (s == 'responding') return 'responding';
    if (s == 'resolved' || s == 'closed') return 'resolved';
    return 'pending';
  }

  bool get isMdrrmoHandled {
    if (isCentralAssignment && ['active', 'completed'].contains(assignmentStatus)) return false;
    return sendTo == 'mdrrmo' ||
        isEscalated ||
        status == 'escalated' ||
        mdrrmoResponseStatus == 'responding' ||
        mdrrmoResponseStatus == 'resolved';
  }

  String get handlingUnitName => isCentralAssignment && ['active', 'completed'].contains(assignmentStatus)
      ? (responseBarangayName?.trim().isNotEmpty == true ? 'Barangay $responseBarangayName' : 'the assigned barangay')
      : isMdrrmoHandled
      ? 'MDRRMO'
      : (barangayName?.trim().isNotEmpty == true
            ? 'Barangay ${barangayName!}'
            : 'your barangay');

  String? get activeResponderName => isCentralAssignment && assignmentStatus == 'active'
      ? (barangayResponderName?.trim().isNotEmpty == true ? barangayResponderName : null)
      : isMdrrmoHandled
      ? (mdrrmoResponderName?.trim().isNotEmpty == true
            ? mdrrmoResponderName
            : null)
      : (barangayResponderName?.trim().isNotEmpty == true
            ? barangayResponderName
            : null);

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
      'created_at': createdAt?.toIso8601String(),
      'client_submitted_at': clientSubmittedAt?.toIso8601String(),
      'incident_occurred_at': incidentOccurredAt?.toIso8601String(),
      'incident_time_precision': incidentTimePrecision,
      'dispatcher_reviewed_at': dispatcherReviewedAt?.toIso8601String(),
      'dispatched_at': dispatchedAt?.toIso8601String(),
      'accepted_at': acceptedAt?.toIso8601String(),
      'travel_distance_m': travelDistanceM,
      'travel_distance_accuracy_m': travelDistanceAccuracyM,
      'arrived_at': arrivedAt?.toIso8601String(),
      'arrival_method': arrivalMethod,
      'arrival_distance_m': arrivalDistanceM,
      'resolved_at': resolvedAt?.toIso8601String(),
      'status': status,
      'lifecycle_revision': lifecycleRevision,
      'evidence_status': evidenceStatus,
      'address': address,
      'reporter_id': reporterId,
      'reporter_name': reporterName,
      'reporter_phone': reporterPhone,
      'reporter_photo_url': reporterPhotoUrl,
      'reporter_type': reporterType,
      'barangay_id': barangayId,
      'barangay_name': barangayName,
      'barangay_responder_name': barangayResponderName,
      'send_to': sendTo,
      'is_escalated': isEscalated,
      'barangay_response_status': barangayResponseStatus,
      'barangay_response_notes': barangayResponseNotes,
      'mdrrmo_response_status': mdrrmoResponseStatus,
      'mdrrmo_responder_name': mdrrmoResponderName,
      'mdrrmo_coordination_notes': mdrrmoCoordinationNotes,
      'is_central_assignment': isCentralAssignment,
      'assignment_status': assignmentStatus,
      'response_barangay_name': responseBarangayName,
      'barangay_assigned_at': barangayAssignedAt?.toIso8601String(),
      'barangay_dispatched_at': barangayDispatchedAt?.toIso8601String(),
      'barangay_accepted_at': barangayAcceptedAt?.toIso8601String(),
      'barangay_arrived_at': barangayArrivedAt?.toIso8601String(),
      'barangay_resolved_at': barangayResolvedAt?.toIso8601String(),
      'barangay_escalated_at': barangayEscalatedAt?.toIso8601String(),
      'barangay_assignments': barangayAssignments,
      'resolved_notes': resolvedNotes,
      'review_outcome': reviewOutcome,
      'review_reason': reviewReason,
      'expected_timings': {
        'response_seconds': expectedResponseSeconds,
        'arrival_seconds': expectedArrivalSeconds,
        'resolution_seconds': expectedResolutionSeconds,
        'sample_counts': {
          'response': expectedResponseSampleCount,
          'arrival': expectedArrivalSampleCount,
          'resolution': expectedResolutionSampleCount,
        },
        'arrival_method': arrivalEstimateMethod,
      },
      'responder_media': responderMedia,
    };
  }

  factory IncidentReport.fromJson(Map<String, dynamic> json) {
    // Support both a legacy single proof_url and a future proof_urls list
    List<String> proofUrls = [];
    List<String> proofTypes = [];

    if (json['proof_urls'] is List && (json['proof_urls'] as List).isNotEmpty) {
      proofUrls = (json['proof_urls'] as List)
          .map((e) => e.toString())
          .toList();
      proofTypes = json['proof_types'] is List
          ? (json['proof_types'] as List).map((e) => e.toString()).toList()
          : List.filled(proofUrls.length, json['proof_type'] ?? 'image');
    } else if (json['proof_url'] != null) {
      final rawProof = json['proof_url'].toString().trim();
      if (rawProof.startsWith('[') && rawProof.endsWith(']')) {
        try {
          final decoded = jsonDecode(rawProof);
          if (decoded is List) {
            proofUrls = decoded.map((e) => e.toString()).toList();
          }
        } catch (_) {}
      } else if (rawProof.contains('|||')) {
        proofUrls = rawProof
            .split('|||')
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
      }
      if (proofUrls.isEmpty && rawProof.isNotEmpty) {
        proofUrls = [rawProof];
      }
      proofTypes = json['proof_types'] is List
          ? (json['proof_types'] as List).map((e) => e.toString()).toList()
          : List.filled(proofUrls.length, json['proof_type'] ?? 'image');
    }

    final primaryProofUrl = proofUrls.isNotEmpty
        ? proofUrls.first
        : json['proof_url'];
    final primaryProofType = proofTypes.isNotEmpty
        ? proofTypes.first
        : (json['proof_type'] ?? 'image');
    final expectedTimings = json['expected_timings'] is Map
        ? Map<String, dynamic>.from(json['expected_timings'] as Map)
        : <String, dynamic>{};
    final expectedSamples = expectedTimings['sample_counts'] is Map
        ? Map<String, dynamic>.from(expectedTimings['sample_counts'] as Map)
        : <String, dynamic>{};

    return IncidentReport(
      id: json['id'],
      type: json['type'],
      title: json['title'],
      specifics: json['specifics'],
      description: json['description'],
      latitude: json['latitude']?.toDouble() ?? 0.0,
      longitude: json['longitude']?.toDouble() ?? 0.0,
      proofUrl: primaryProofUrl,
      proofType: primaryProofType,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'])
          : null,
      clientSubmittedAt: json['client_submitted_at'] != null
          ? DateTime.tryParse(json['client_submitted_at'])
          : null,
      incidentOccurredAt: json['incident_occurred_at'] != null
          ? DateTime.tryParse(json['incident_occurred_at'].toString())
          : null,
      incidentTimePrecision: const {'exact', 'approximate'}.contains(
        json['incident_time_precision']?.toString(),
      )
          ? json['incident_time_precision'].toString()
          : 'unknown',
      dispatcherReviewedAt: json['dispatcher_reviewed_at'] != null
          ? DateTime.tryParse(json['dispatcher_reviewed_at'])
          : null,
      dispatchedAt: json['dispatched_at'] != null
          ? DateTime.tryParse(json['dispatched_at'])
          : null,
      acceptedAt: json['accepted_at'] != null
          ? DateTime.tryParse(json['accepted_at'])
          : null,
      travelDistanceM: (json['travel_distance_m'] as num?)?.toDouble(),
      travelDistanceAccuracyM: (json['travel_distance_accuracy_m'] as num?)
          ?.toDouble(),
      arrivedAt: json['arrived_at'] != null
          ? DateTime.tryParse(json['arrived_at'])
          : null,
      arrivalMethod: json['arrival_method']?.toString(),
      arrivalDistanceM: (json['arrival_distance_m'] as num?)?.toDouble(),
      resolvedAt: json['resolved_at'] != null
          ? DateTime.tryParse(json['resolved_at'])
          : null,
      status: json['status'],
      address: json['address'],
      reporterId: json['reporter_id'],
      reporterName: json['reporter_name'],
      reporterPhone: json['reporter_phone'],
      reporterPhotoUrl: json['reporter_photo_url'],
      reporterType: json['reporter_type'],
      barangayId: json['barangay_id'],
      barangayName: json['barangay_name']?.toString(),
      barangayResponderName: json['barangay_responder_name']?.toString(),
      sendTo: json['send_to']?.toString(),
      isEscalated: json['is_escalated'] == true ||
          json['beyond_barangay_capability'] == true ||
          json['status']?.toString().toLowerCase() == 'escalated',
      barangayResponseStatus: json['barangay_response_status'],
      barangayResponseNotes: json['barangay_response_notes'],
      mdrrmoResponseStatus: json['mdrrmo_response_status'],
      mdrrmoResponderName: json['mdrrmo_responder_name'],
      mdrrmoCoordinationNotes: json['mdrrmo_coordination_notes'],
      isCentralAssignment: json['is_central_assignment'] == true,
      assignmentStatus: json['assignment_status']?.toString(),
      responseBarangayName: json['response_barangay_name']?.toString(),
      barangayAssignedAt: json['barangay_assigned_at'] == null ? null : DateTime.tryParse(json['barangay_assigned_at'].toString()),
      barangayDispatchedAt: json['barangay_dispatched_at'] == null ? null : DateTime.tryParse(json['barangay_dispatched_at'].toString()),
      barangayAcceptedAt: json['barangay_accepted_at'] == null ? null : DateTime.tryParse(json['barangay_accepted_at'].toString()),
      barangayArrivedAt: json['barangay_arrived_at'] == null ? null : DateTime.tryParse(json['barangay_arrived_at'].toString()),
      barangayResolvedAt: json['barangay_resolved_at'] == null ? null : DateTime.tryParse(json['barangay_resolved_at'].toString()),
      barangayEscalatedAt: json['barangay_escalated_at'] == null ? null : DateTime.tryParse(json['barangay_escalated_at'].toString()),
      barangayAssignments: json['barangay_assignments'] is List
          ? (json['barangay_assignments'] as List).whereType<Map>().map((entry) => Map<String, dynamic>.from(entry)).toList()
          : const [],
      resolvedNotes: json['resolved_notes'],
      reviewOutcome: json['review_outcome']?.toString(),
      reviewReason: json['review_reason']?.toString(),
      evidenceStatus: json['evidence_status']?.toString() ?? 'ready',
      lifecycleRevision: (json['lifecycle_revision'] as num?)?.toInt() ?? 0,
      expectedResponseSeconds: (expectedTimings['response_seconds'] as num?)
          ?.toDouble(),
      expectedArrivalSeconds: (expectedTimings['arrival_seconds'] as num?)
          ?.toDouble(),
      expectedResolutionSeconds: (expectedTimings['resolution_seconds'] as num?)
          ?.toDouble(),
      expectedResponseSampleCount:
          (expectedSamples['response'] as num?)?.toInt() ?? 0,
      expectedArrivalSampleCount:
          (expectedSamples['arrival'] as num?)?.toInt() ?? 0,
      expectedResolutionSampleCount:
          (expectedSamples['resolution'] as num?)?.toInt() ?? 0,
      arrivalEstimateMethod: expectedTimings['arrival_method']?.toString(),
      responderMedia: json['responder_media'] is List
          ? (json['responder_media'] as List)
                .whereType<Map>()
                .map((m) => Map<String, dynamic>.from(m))
                .toList()
          : const [],
      proofUrls: proofUrls,
      proofTypes: proofTypes,
    );
  }

  /// Returns a copy with updated fields.
  IncidentReport copyWith({
    String? description,
    List<String>? proofUrls,
    List<String>? proofTypes,
  }) {
    return IncidentReport(
      id: id,
      type: type,
      title: title,
      specifics: specifics,
      description: description ?? this.description,
      latitude: latitude,
      longitude: longitude,
      proofUrl: proofUrls != null && proofUrls.isNotEmpty
          ? proofUrls.first
          : proofUrl,
      proofType: proofTypes != null && proofTypes.isNotEmpty
          ? proofTypes.first
          : proofType,
      createdAt: createdAt,
      clientSubmittedAt: clientSubmittedAt,
      incidentOccurredAt: incidentOccurredAt,
      incidentTimePrecision: incidentTimePrecision,
      dispatcherReviewedAt: dispatcherReviewedAt,
      dispatchedAt: dispatchedAt,
      acceptedAt: acceptedAt,
      travelDistanceM: travelDistanceM,
      travelDistanceAccuracyM: travelDistanceAccuracyM,
      arrivedAt: arrivedAt,
      arrivalMethod: arrivalMethod,
      arrivalDistanceM: arrivalDistanceM,
      resolvedAt: resolvedAt,
      status: status,
      address: address,
      reporterId: reporterId,
      reporterName: reporterName,
      reporterPhone: reporterPhone,
      reporterPhotoUrl: reporterPhotoUrl,
      reporterType: reporterType,
      barangayId: barangayId,
      barangayName: barangayName,
      barangayResponderName: barangayResponderName,
      sendTo: sendTo,
      isEscalated: isEscalated,
      barangayResponseStatus: barangayResponseStatus,
      barangayResponseNotes: barangayResponseNotes,
      mdrrmoResponseStatus: mdrrmoResponseStatus,
      mdrrmoResponderName: mdrrmoResponderName,
      mdrrmoCoordinationNotes: mdrrmoCoordinationNotes,
      isCentralAssignment: isCentralAssignment,
      assignmentStatus: assignmentStatus,
      responseBarangayName: responseBarangayName,
      barangayAssignedAt: barangayAssignedAt,
      barangayDispatchedAt: barangayDispatchedAt,
      barangayAcceptedAt: barangayAcceptedAt,
      barangayArrivedAt: barangayArrivedAt,
      barangayResolvedAt: barangayResolvedAt,
      barangayEscalatedAt: barangayEscalatedAt,
      barangayAssignments: barangayAssignments,
      resolvedNotes: resolvedNotes,
      reviewOutcome: reviewOutcome,
      reviewReason: reviewReason,
      evidenceStatus: evidenceStatus,
      lifecycleRevision: lifecycleRevision,
      expectedResponseSeconds: expectedResponseSeconds,
      expectedArrivalSeconds: expectedArrivalSeconds,
      expectedResolutionSeconds: expectedResolutionSeconds,
      expectedResponseSampleCount: expectedResponseSampleCount,
      expectedArrivalSampleCount: expectedArrivalSampleCount,
      expectedResolutionSampleCount: expectedResolutionSampleCount,
      arrivalEstimateMethod: arrivalEstimateMethod,
      responderMedia: responderMedia,
      proofUrls: proofUrls ?? this.proofUrls,
      proofTypes: proofTypes ?? this.proofTypes,
    );
  }
}
