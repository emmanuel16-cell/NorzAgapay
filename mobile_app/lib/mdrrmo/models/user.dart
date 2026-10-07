
enum UserRole {
  master_admin,
  admin,
  logistics,
  responder,
}

enum UnitType {
  police,
  fire,
  medical,
  rescue_officer,
  swift_water_rescue_officer,
  mountain_rescue_officer,
  emergency_medical_responder_emr,
  ambulance_officer_ems_personnel,
  fire_response_officer,
  evacuation_officer,
  safety_security_officer,
  traffic_road_clearing_officer,
  communications_officer,
  logistics_response_officer,
  damage_assessment_officer,
}

class User {
  final String id;
  final String fullName;
  final String email;
  final String? phone;
  final UserRole role;
  final UnitType? unitType;
  final String? unitTypeString;
  final String status;
  final bool verified;
  final double? latitude;
  final double? longitude;
  final bool isTeamLeader;
  final String? unitName;
  final String? rank;

  User({
    required this.id,
    required this.fullName,
    required this.email,
    this.phone,
    required this.role,
    this.unitType,
    this.unitTypeString,
    required this.status,
    required this.verified,
    this.latitude,
    this.longitude,
    this.isTeamLeader = false,
    this.unitName,
    this.rank,
  });

  bool get isPendingVerification => status == 'pending_verification';
  bool get canManageTeam => isTeamLeader || role == UserRole.master_admin || role == UserRole.admin;

  List<String> get specializations {
    if (unitTypeString != null && unitTypeString!.trim().isNotEmpty) {
      return unitTypeString!.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
    }
    if (unitType != null) {
      return [unitType!.name.replaceAll('_', ' ')];
    }
    return [];
  }

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'],
      fullName: json['full_name'] ?? '',
      email: json['email'] ?? '',
      phone: json['phone'],
      role: UserRole.values.firstWhere(
        (e) => e.name == json['role'],
        orElse: () => UserRole.responder,
      ),
      unitType: json['unit_type'] != null 
          ? _parseUnitType(json['unit_type'].toString()) 
          : null,
      unitTypeString: json['unit_type']?.toString(),
      status: json['status'] ?? 'active',
      verified: json['verified'] ?? false,
      latitude: json['latitude']?.toDouble(),
      longitude: json['longitude']?.toDouble(),
      isTeamLeader: json['is_team_leader'] == true || json['rank'] == 'Team Leader',
      unitName: json['unit_name'],
      rank: json['rank'],
    );
  }

  static UnitType? _parseUnitType(String value) {
    final mapping = {
      'police': UnitType.police,
      'fire': UnitType.fire,
      'medical': UnitType.medical,
      'Rescue Officer': UnitType.rescue_officer,
      'Swift Water Rescue Officer': UnitType.swift_water_rescue_officer,
      'Mountain Rescue Officer': UnitType.mountain_rescue_officer,
      'Emergency Medical Responder (EMR)': UnitType.emergency_medical_responder_emr,
      'Ambulance Officer / EMS Personnel': UnitType.ambulance_officer_ems_personnel,
      'Fire Response Officer': UnitType.fire_response_officer,
      'Evacuation Officer': UnitType.evacuation_officer,
      'Safety & Security Officer': UnitType.safety_security_officer,
      'Traffic & Road Clearing Officer': UnitType.traffic_road_clearing_officer,
      'Communications Officer': UnitType.communications_officer,
      'Logistics Response Officer': UnitType.logistics_response_officer,
      'Damage Assessment Officer': UnitType.damage_assessment_officer,
    };
    if (mapping.containsKey(value)) {
      return mapping[value];
    }
    final first = value.split(',').first.trim();
    return mapping[first];
  }

  Map<String, dynamic> toJson() {
    final reverseMapping = {
      UnitType.police: 'police',
      UnitType.fire: 'fire',
      UnitType.medical: 'medical',
      UnitType.rescue_officer: 'Rescue Officer',
      UnitType.swift_water_rescue_officer: 'Swift Water Rescue Officer',
      UnitType.mountain_rescue_officer: 'Mountain Rescue Officer',
      UnitType.emergency_medical_responder_emr: 'Emergency Medical Responder (EMR)',
      UnitType.ambulance_officer_ems_personnel: 'Ambulance Officer / EMS Personnel',
      UnitType.fire_response_officer: 'Fire Response Officer',
      UnitType.evacuation_officer: 'Evacuation Officer',
      UnitType.safety_security_officer: 'Safety & Security Officer',
      UnitType.traffic_road_clearing_officer: 'Traffic & Road Clearing Officer',
      UnitType.communications_officer: 'Communications Officer',
      UnitType.logistics_response_officer: 'Logistics Response Officer',
      UnitType.damage_assessment_officer: 'Damage Assessment Officer',
    };

    return {
      'id': id,
      'full_name': fullName,
      'email': email,
      'phone': phone,
      'role': role.name,
      'unit_type': unitTypeString ?? (unitType != null ? reverseMapping[unitType] : null),
      'status': status,
      'verified': verified,
      'latitude': latitude,
      'longitude': longitude,
    };
  }
}
