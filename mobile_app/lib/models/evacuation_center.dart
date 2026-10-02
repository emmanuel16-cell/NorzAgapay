class EvacuationCenter {
  final String id;
  final String name;
  final String? address;
  final double latitude;
  final double longitude;
  final String barangayId;
  final String? barangayName;
  final bool isActive;

  EvacuationCenter({
    required this.id,
    required this.name,
    this.address,
    required this.latitude,
    required this.longitude,
    required this.barangayId,
    this.barangayName,
    this.isActive = true,
  });

  factory EvacuationCenter.fromJson(Map<String, dynamic> json) {
    return EvacuationCenter(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      address: json['address'],
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0.0,
      barangayId: json['barangay_id'] ?? '',
      barangayName: json['barangays']?['name'],
      isActive: json['is_active'] ?? true,
    );
  }
}
