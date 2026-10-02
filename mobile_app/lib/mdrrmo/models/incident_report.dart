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
  final String? status;
  final String? address;
  final String? reporterId;
  final String? reporterName;
  final String? reporterPhone;
  final String? reporterPhotoUrl;
  final String? reporterType;

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
    this.status,
    this.address,
    this.reporterId,
    this.reporterName,
    this.reporterPhone,
    this.reporterPhotoUrl,
    this.reporterType,
  });

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
      'status': status,
      'address': address,
      'reporter_id': reporterId,
      'reporter_name': reporterName,
      'reporter_phone': reporterPhone,
      'reporter_photo_url': reporterPhotoUrl,
      'reporter_type': reporterType,
    };
  }

  factory IncidentReport.fromJson(Map<String, dynamic> json) {
    return IncidentReport(
      id: json['id'],
      type: json['type'],
      title: json['title'],
      specifics: json['specifics'],
      description: json['description'],
      latitude: json['latitude']?.toDouble() ?? 0.0,
      longitude: json['longitude']?.toDouble() ?? 0.0,
      proofUrl: json['proof_url'],
      proofType: json['proof_type'] ?? 'image',
      createdAt: json['created_at'] != null ? DateTime.parse(json['created_at']) : null,
      status: json['status'],
      address: json['address'],
      reporterId: json['reporter_id'],
      reporterName: json['reporter_name'],
      reporterPhone: json['reporter_phone'],
      reporterPhotoUrl: json['reporter_photo_url'],
      reporterType: json['reporter_type'],
    );
  }
}
