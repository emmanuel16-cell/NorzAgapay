class BarangayUser {
  final String id;
  final String fullName;
  final String email;
  final String? phone;
  final String role; // 'admin' | 'dispatcher' | 'responder' | 'staff'
  final String barangayId;
  final bool coordinationVerified;
  final String? barangayName;
  final String? municipality;
  final bool isActive;
  final String? addedBy;

  // Barangay Account Request fields
  final String verificationStatus; // 'pending_document' | 'under_review' | 'verified' | 'rejected' | 'needs_correction'
  final String? verificationRefNo;
  final String? positionDesignation;
  final String? punongBarangayName;
  final String? punongBarangayPosition;
  final String? documentUrl;
  final String? submittedAt;
  final String? rejectionReason;
  final List<dynamic>? verificationHistory;
  final bool coordinationPromptPending;

  BarangayUser({
    required this.id,
    required this.fullName,
    required this.email,
    this.phone,
    required this.role,
    required this.barangayId,
    this.coordinationVerified = false,
    this.barangayName,
    this.municipality,
    this.isActive = false,
    this.addedBy,
    this.verificationStatus = 'pending_document',
    this.verificationRefNo,
    this.positionDesignation,
    this.punongBarangayName,
    this.punongBarangayPosition,
    this.documentUrl,
    this.submittedAt,
    this.rejectionReason,
    this.verificationHistory,
    this.coordinationPromptPending = false,
  });

  bool get isBarangayAdmin => role == 'admin';
  bool get isDispatcher => role == 'dispatcher';
  bool get isResponder => role == 'responder';
  bool get isStaff => role == 'staff';
  bool get canManageTeam => isBarangayAdmin;
  bool get canManageEvacuationCenters => isBarangayAdmin || isStaff;
  bool get canManageContent => isBarangayAdmin || isStaff;
  bool get canViewReports => (isDispatcher && isActive && coordinationVerified) || isResponder;
  bool get canRespondToEmergency => canViewReports;

  // Dispatcher operational access depends on active membership and the shared
  // barangay coordination approval, not an individual verification status.
  bool get isVerified {
    if (!isDispatcher) return isActive;
    return isActive && coordinationVerified;
  }

  bool get isUnderReview => verificationStatus == 'under_review';
  bool get isRejected => verificationStatus == 'rejected';
  bool get isNeedsCorrection => verificationStatus == 'needs_correction';
  bool get isPendingDocument =>
      verificationStatus == 'pending_document' ||
      verificationStatus == 'pending_verification' ||
      (!isVerified && !isUnderReview && !isRejected && !isNeedsCorrection);

  factory BarangayUser.fromJson(Map<String, dynamic> json) {
    // Nested verification data if present
    final ver = json['verification'] as Map<String, dynamic>?;
    var role = json['role'] ?? 'staff';
    // Normalize roles cached by older app versions to the four current roles.
    if (role == 'captain') role = 'dispatcher';
    if (role == 'team_leader') role = 'responder';
    if (role == 'volunteer') role = 'staff';
    final isDisp = role == 'dispatcher';

    // Status resolution
    String resolvedStatus;
    if (ver?['status'] != null) {
      resolvedStatus = ver!['status'] as String;
    } else if (json['verification_status'] != null) {
      resolvedStatus = json['verification_status'] as String;
    } else if (isDisp) {
      resolvedStatus = json['is_active'] == true ? 'verified' : 'pending_document';
    } else {
      resolvedStatus = 'verified';
    }

    final bool resolvedIsActive = json['is_active'] == true;

    return BarangayUser(
      id: json['id'] ?? '',
      fullName: json['full_name'] ?? '',
      email: json['email'] ?? '',
      phone: json['phone'],
      role: role,
      barangayId: json['barangay_id'] ?? '',
      coordinationVerified: json['coordination_verified'] == true,
      barangayName: json['barangay_name'],
      municipality: json['municipality'],
      isActive: isDisp ? resolvedIsActive : (json['is_active'] ?? true),
      addedBy: json['added_by'],
      verificationStatus: resolvedStatus,
      verificationRefNo: ver?['reference_no'] ?? json['verification_ref_no'],
      // The account profile is authoritative for the administrator's own
      // designation. Older verification records may not contain this field.
      positionDesignation: json['position_designation'] ?? ver?['position_designation'],
      punongBarangayName: ver?['punong_barangay_name'] ?? json['punong_barangay_name'],
      punongBarangayPosition: ver?['punong_barangay_position'] ?? json['punong_barangay_position'],
      documentUrl: ver?['document_url'] ?? json['document_url'],
      submittedAt: ver?['submitted_at'] ?? json['submitted_at'],
      rejectionReason: ver?['rejection_reason'] ?? json['rejection_reason'],
      verificationHistory: ver?['verification_history'] ?? json['verification_history'],
      coordinationPromptPending: json['coordination_prompt_pending'] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'full_name': fullName,
      'email': email,
      'phone': phone,
      'role': role,
      'barangay_id': barangayId,
      'coordination_verified': coordinationVerified,
      'barangay_name': barangayName,
      'municipality': municipality,
      'is_active': isActive,
      'added_by': addedBy,
      'verification_status': verificationStatus,
      'verification_ref_no': verificationRefNo,
      'position_designation': positionDesignation,
      'punong_barangay_name': punongBarangayName,
      'punong_barangay_position': punongBarangayPosition,
      'document_url': documentUrl,
      'submitted_at': submittedAt,
      'rejection_reason': rejectionReason,
      'verification_history': verificationHistory,
      'coordination_prompt_pending': coordinationPromptPending,
    };
  }

  BarangayUser copyWith({
    String? fullName,
    String? phone,
    bool clearPhone = false,
    String? verificationStatus,
    String? verificationRefNo,
    String? punongBarangayName,
    String? punongBarangayPosition,
    String? documentUrl,
    String? submittedAt,
    String? rejectionReason,
    bool? isActive,
    List<dynamic>? verificationHistory,
    bool? coordinationPromptPending,
    bool? coordinationVerified,
    String? positionDesignation,
    bool clearDocumentUrl = false,
    bool clearSubmittedAt = false,
    bool clearRejectionReason = false,
  }) {
    return BarangayUser(
      id: id,
      fullName: fullName ?? this.fullName,
      email: email,
      phone: clearPhone ? null : (phone ?? this.phone),
      role: role,
      barangayId: barangayId,
      coordinationVerified: coordinationVerified ?? this.coordinationVerified,
      barangayName: barangayName,
      municipality: municipality,
      isActive: isActive ?? this.isActive,
      addedBy: addedBy,
      verificationStatus: verificationStatus ?? this.verificationStatus,
      verificationRefNo: verificationRefNo ?? this.verificationRefNo,
      positionDesignation: positionDesignation ?? this.positionDesignation,
      punongBarangayName: punongBarangayName ?? this.punongBarangayName,
      punongBarangayPosition: punongBarangayPosition ?? this.punongBarangayPosition,
      documentUrl: clearDocumentUrl ? null : (documentUrl ?? this.documentUrl),
      submittedAt: clearSubmittedAt ? null : (submittedAt ?? this.submittedAt),
      rejectionReason: clearRejectionReason ? null : (rejectionReason ?? this.rejectionReason),
      verificationHistory: verificationHistory ?? this.verificationHistory,
      coordinationPromptPending: coordinationPromptPending ?? this.coordinationPromptPending,
    );
  }
}
