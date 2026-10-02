enum TaskStatus {
  pending,
  accepted,
  in_progress,
  completed,
  cancelled,
}

enum TaskType {
  specialist,
  general_labor,
}

class Task {
  final String id;
  final String incidentId;
  final String title;
  final String? description;
  final TaskType type;
  final String? requiredSkill;
  final String? assignedTo;
  final TaskStatus status;
  final String? proofPhotoUrl;
  final DateTime createdAt;
  final DateTime? completedAt;
  
  // Incident details (embedded or fetched)
  final String? incidentTitle;
  final String? incidentType;
  final String? incidentSeverity;
  final double? latitude;
  final double? longitude;
  final String? address;
  final List<String> joinedResponderIds;
  final String? barangayName;
  final String? barangayResponseStatus;

  Task({
    required this.id,
    required this.incidentId,
    required this.title,
    this.description,
    required this.type,
    this.requiredSkill,
    this.assignedTo,
    required this.status,
    this.proofPhotoUrl,
    required this.createdAt,
    this.completedAt,
    this.incidentTitle,
    this.incidentType,
    this.incidentSeverity,
    this.latitude,
    this.longitude,
    this.address,
    this.joinedResponderIds = const [],
    this.barangayName,
    this.barangayResponseStatus,
  });

  factory Task.fromJson(Map<String, dynamic> json) {
    final incident = json['incident'];
    final respondersJson = (json['responders'] ?? json['volunteers']) as List? ?? [];
    final joinedIds = respondersJson
        .map((v) => (v['responder_id'] ?? v['volunteer_id']) as String)
        .toList();

    return Task(
      id: json['id'],
      incidentId: json['incident_id'] ?? '',
      title: json['title'] ?? '',
      description: json['description'],
      type: TaskType.values.firstWhere(
        (e) => e.name == json['task_type'],
        orElse: () => TaskType.general_labor,
      ),
      requiredSkill: json['required_skill'],
      assignedTo: json['assigned_to'],
      status: TaskStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => TaskStatus.pending,
      ),
      proofPhotoUrl: json['proof_photo_url'],
      createdAt: json['created_at'] != null ? DateTime.parse(json['created_at']) : DateTime.now(),
      completedAt: json['completed_at'] != null ? DateTime.parse(json['completed_at']) : null,
      incidentTitle: incident?['title'],
      incidentType: incident?['type'],
      incidentSeverity: incident?['severity'],
      latitude: (json['latitude'] ?? incident?['latitude'])?.toDouble(),
      longitude: (json['longitude'] ?? incident?['longitude'])?.toDouble(),
      address: json['address'] ?? incident?['address'],
      joinedResponderIds: joinedIds,
      barangayName: json['barangay_name'] ?? incident?['barangay_name'],
      barangayResponseStatus: json['barangay_response_status'] ?? incident?['barangay_response_status'],
    );
  }
}
