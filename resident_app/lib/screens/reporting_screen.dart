import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:intl/intl.dart';
import '../services/offline_service.dart';
import '../services/norzagaray_boundary.dart';
import '../services/resident_gps_service.dart';
import '../services/evidence_upload_service.dart';
import '../core/constants.dart';
import '../core/phone_number_utils.dart';
import '../widgets/resident_gradient_app_bar.dart';
import 'my_reports_screen.dart';
import 'emergency_camera_screen.dart';
import '../widgets/video_proof_player.dart';

class _ProofItem {
  final File file;
  final String type;
  final int? durationSeconds;

  const _ProofItem({
    required this.file,
    required this.type,
    this.durationSeconds,
  });
}

String _createClientRequestId() {
  final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class ReportingScreen extends StatefulWidget {
  final String reportType;
  final Map<String, dynamic>? initialDraft;

  const ReportingScreen({
    super.key,
    required this.reportType,
    this.initialDraft,
  });

  @override
  State<ReportingScreen> createState() => _ReportingScreenState();
}

class _ReportingScreenState extends State<ReportingScreen> {
  late final String _reportType;
  String? _selectedCategory;
  String? _selectedSpecific;
  final List<_ProofItem> _proofs = [];
  int _selectedProofIndex = 0;
  bool _isUploading = false;
  bool _isConfirmingExit = false;
  bool _allowPop = false;
  String? _draftId;
  String _clientRequestId = _createClientRequestId();
  DateTime? _clientSubmittedAt;
  String _incidentTimeChoice = 'just_now';
  DateTime? _incidentOccurredAt = DateTime.now();
  String _incidentTimePrecision = 'exact';
  bool _keepCurrentLocationForSubmit = false;
  final TextEditingController _descController = TextEditingController();

  LatLng? _currentLocation;
  bool _locationCheckComplete = false;
  bool _isInsideNorzagaray = false;
  bool _isRefreshingLocation = false;

  // Barangay selection & routing
  List<Map<String, dynamic>> _barangays = [];
  String? _selectedBarangayId;
  String? _selectedBarangayName;
  String _sendTo = 'barangay'; // 'barangay' or 'mdrrmo'

  final Map<String, List<String>> _communityCategories = {
    'Community Safety Concerns': [
      'Minor Flooding',
      'Drainage Blockage',
      'Small Fire Incident',
      'Fallen Tree Report',
      'Road Damage Report',
      'Damaged House Report',
      'Cracked Road Report',
      'Unsafe Electrical Wiring',
      'River Water Level Report',
    ],
    'Environmental Concerns': [
      'Illegal Dumping',
      'River Pollution Report',
      'Smoke Pollution',
      'Animal Carcass Disposal',
      'Flood-Prone Area Report',
    ],
    'Weather & Monitoring Reports': [
      'Heavy Rain Monitoring',
      'Strong Wind Monitoring',
      'Rising Water Level Monitoring',
      'Landslide-Prone Area Report',
      'Earthquake Damage Observation',
    ],
  };

  @override
  void initState() {
    super.initState();
    _reportType = widget.reportType;
    _restoreDraft(widget.initialDraft);
    if (_currentLocation == null) _getLocation();
    _loadBarangays();
    _loadSavedBarangay();
  }

  void _restoreDraft(Map<String, dynamic>? draft) {
    if (draft == null) return;
    _clientRequestId =
        draft['client_request_id']?.toString() ?? _clientRequestId;
    _draftId = draft['draft_id']?.toString();
    final submittedAt = draft['client_submitted_at']?.toString();
    _clientSubmittedAt = submittedAt == null
        ? null
        : DateTime.tryParse(submittedAt)?.toUtc();
    final savedTimeChoice = draft['incident_time_choice']?.toString();
    if (const {'just_now', 'earlier', 'unknown'}.contains(savedTimeChoice)) {
      _incidentTimeChoice = savedTimeChoice!;
    }
    final occurredAt = DateTime.tryParse(
      draft['incident_occurred_at']?.toString() ?? '',
    );
    _incidentOccurredAt = occurredAt;
    final savedPrecision = draft['incident_time_precision']?.toString();
    _incidentTimePrecision = const {'exact', 'approximate'}.contains(
      savedPrecision,
    )
        ? savedPrecision!
        : 'exact';
    if (_incidentTimeChoice == 'unknown') {
      _incidentOccurredAt = null;
      _incidentTimePrecision = 'unknown';
    } else if (_incidentOccurredAt == null && savedTimeChoice == null) {
      // Drafts created before incident-time support keep the selected default.
      _incidentTimeChoice = 'just_now';
      _incidentOccurredAt = DateTime.now();
      _incidentTimePrecision = 'exact';
    } else if (_incidentOccurredAt == null) {
      _incidentTimeChoice = 'unknown';
      _incidentTimePrecision = 'unknown';
    }
    _selectedCategory = draft['category']?.toString();
    _selectedSpecific = draft['specifics']?.toString();
    _descController.text = draft['description']?.toString() ?? '';
    _sendTo = draft['send_to']?.toString() ?? 'barangay';
    _selectedBarangayId = draft['barangay_id']?.toString();
    _selectedBarangayName = draft['barangay_name']?.toString();
    final latitude = double.tryParse(draft['latitude']?.toString() ?? '');
    final longitude = double.tryParse(draft['longitude']?.toString() ?? '');
    if (latitude != null &&
        longitude != null &&
        latitude.isFinite &&
        longitude.isFinite &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180) {
      final savedLocation = LatLng(latitude, longitude);
      _currentLocation = savedLocation;
      _keepCurrentLocationForSubmit = true;
      _isInsideNorzagaray = NorzagarayBoundary.containsPoint(savedLocation);
      _locationCheckComplete = true;
    }
    final paths =
        (draft['proof_paths'] as List?)?.map((e) => e.toString()).toList() ??
        [];
    final types =
        (draft['proof_types'] as List?)?.map((e) => e.toString()).toList() ??
        [];
    final durations = (draft['proof_durations'] as List?)?.toList() ?? [];
    for (var i = 0; i < paths.length; i++) {
      final file = File(paths[i]);
      if (file.existsSync()) {
        _proofs.add(
          _ProofItem(
            file: file,
            type: i < types.length ? types[i] : 'image',
            durationSeconds: i < durations.length ? durations[i] as int? : null,
          ),
        );
      }
    }
    if (_proofs.isNotEmpty) _selectedProofIndex = _proofs.length - 1;
  }

  bool get _hasDraftableContent =>
      _descController.text.trim().isNotEmpty ||
      _selectedCategory != null ||
      _selectedSpecific != null ||
      _proofs.isNotEmpty;

  Map<String, dynamic> _draftData() => {
    'client_request_id': _clientRequestId,
    'type': _reportType,
    'category': _selectedCategory,
    'title': _reportType == 'emergency'
        ? 'Emergency Incident'
        : _selectedCategory,
    'specifics': _selectedSpecific,
    'description': _descController.text,
    'latitude': _currentLocation?.latitude,
    'longitude': _currentLocation?.longitude,
    'client_submitted_at': _clientSubmittedAt?.toUtc().toIso8601String(),
    'incident_time_choice': _incidentTimeChoice,
    'incident_occurred_at': _incidentOccurredAt?.toUtc().toIso8601String(),
    'incident_time_precision': _incidentTimePrecision,
    'proof_paths': _proofs.map((proof) => proof.file.path).toList(),
    'proof_types': _proofs.map((proof) => proof.type).toList(),
    'proof_durations': _proofs.map((proof) => proof.durationSeconds).toList(),
    'send_to': _sendTo,
    'barangay_id': _selectedBarangayId,
    'barangay_name': _selectedBarangayName,
    'contact_number': OfflineService.getProfile()?['contact_number'],
  };

  Future<void> _confirmExit() async {
    if (_isConfirmingExit || _allowPop) return;
    _isConfirmingExit = true;
    if (!_hasDraftableContent) {
      if (_draftId != null) await OfflineService.deleteDraft(_draftId!);
      _popAfterConfirmation();
      return;
    }
    final choice = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Save report as draft?'),
        content: const Text(
          'You have entered report details or added proof. Save this report as a draft before leaving?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, 'continue'),
            child: const Text('Keep Editing'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, 'discard'),
            child: const Text('Discard'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(dialogContext, 'save'),
            child: const Text('Save Draft'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    _isConfirmingExit = false;
    if (choice == 'save') {
      _draftId = await OfflineService.saveDraft(_draftData(), id: _draftId);
      _popAfterConfirmation();
    } else if (choice == 'discard') {
      if (_draftId != null) await OfflineService.deleteDraft(_draftId!);
      _popAfterConfirmation();
    }
  }

  void _popAfterConfirmation() {
    _allowPop = true;
    if (mounted) setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop();
    });
  }

  void _loadSavedBarangay() {
    final profile = OfflineService.getProfile();
    // The saved profile is authoritative; stale draft routing must not override it.
    _selectedBarangayId = profile?['barangay_id']?.toString();
    _selectedBarangayName = profile?['barangay_name']?.toString();
    _syncSavedBarangaySelection();
  }

  void _syncSavedBarangaySelection() {
    if (_barangays.isEmpty) {
      _selectedBarangayId = null;
      _selectedBarangayName = null;
      return;
    }
    final profile = OfflineService.getProfile();
    final savedId = profile?['barangay_id']?.toString();
    final savedName = (profile?['barangay_name'] ?? _selectedBarangayName)
        ?.toString()
        .trim();
    final match = _barangays.firstWhere(
      (b) =>
          (savedId != null && b['id']?.toString() == savedId) ||
          (savedName != null &&
              b['name']?.toString().trim().toLowerCase() ==
                  savedName.toLowerCase()),
      orElse: () => <String, dynamic>{},
    );
    if (match.isEmpty) {
      _selectedBarangayId = null;
      _selectedBarangayName = null;
      if (mounted) setState(() {});
      return;
    }
    _selectedBarangayId = match['id']?.toString();
    _selectedBarangayName = match['name']?.toString();
    if (savedId != _selectedBarangayId && _selectedBarangayId != null) {
      OfflineService.saveProfile({
        ...?profile,
        'barangay_id': _selectedBarangayId,
        'barangay_name': _selectedBarangayName,
      });
    }
    if (mounted) setState(() {});
  }

  Future<void> _getLocation({
    bool requestPermission = true,
    bool showResult = false,
  }) async {
    if (_isRefreshingLocation) return;
    if (mounted) setState(() => _isRefreshingLocation = true);
    final location = await ResidentGpsService.scan(
      requestPermission: requestPermission,
    );
    if (!mounted) return;
    final isInside =
        !NorzagarayBoundary.isEnabled ||
        (location != null && NorzagarayBoundary.containsPoint(location));
    setState(() {
      _currentLocation = location;
      _isInsideNorzagaray = isInside;
      _locationCheckComplete = true;
      _isRefreshingLocation = false;
      _keepCurrentLocationForSubmit = showResult && location != null;
    });
    if (showResult && !isInside) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            location == null
                ? 'Location unavailable. Enable GPS and refresh to check report access.'
                : 'You can report incidents only while you are in Norzagaray.',
          ),
        ),
      );
    }
  }

  Future<void> _loadBarangays() async {
    // Try cache first
    final cached = OfflineService.getCachedBarangays()
        .where((barangay) => barangay['is_verified'] == true)
        .toList();
    if (cached.isNotEmpty) {
      if (mounted) setState(() => _barangays = cached);
      _syncSavedBarangaySelection();
    }

    // Fetch fresh list
    try {
      final response = await http
          .get(
            Uri.parse(
              '${AppConstants.apiBaseUrl}/barangay/list?verified_only=true',
            ),
            headers: {'ngrok-skip-browser-warning': 'true'},
          )
          .timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        final barangays = data
            .map((e) => Map<String, dynamic>.from(e))
            .where((barangay) => barangay['is_verified'] == true)
            .toList();
        await OfflineService.saveBarangays(barangays);
        if (mounted) setState(() => _barangays = barangays);
        _syncSavedBarangaySelection();
      }
    } catch (e) {
      debugPrint('Load barangays error: $e');
    }
  }

  Future<void> _openEmergencyCamera() async {
    final proofs = await Navigator.push<List<EmergencyProof>>(
      context,
      MaterialPageRoute(builder: (_) => const EmergencyCameraScreen()),
    );
    if (proofs != null && proofs.isNotEmpty && mounted) {
      setState(() {
        _proofs.addAll(
          proofs.map(
            (proof) => _ProofItem(
              file: proof.file,
              type: proof.type,
              durationSeconds: proof.durationSeconds,
            ),
          ),
        );
        _selectedProofIndex = _proofs.length - 1;
      });
    }
  }

  void _showMediaSourceSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Add Visual Proof',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                  color: Color(0xFF1E293B),
                ),
              ),
              const SizedBox(height: 10),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF0284C7),
                  child: Icon(Icons.camera_alt, color: Colors.white, size: 20),
                ),
                title: const Text(
                  'Take Photo / Video (Emergency Camera)',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: const Text(
                  'Live capture with timestamp & emergency controls',
                  style: TextStyle(fontSize: 12),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _openEmergencyCamera();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _addProof() {
    _showMediaSourceSheet();
  }

  Future<void> _confirmRemoveProof() async {
    if (_proofs.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(
              Icons.warning_amber_rounded,
              color: Color(0xFFE53935),
              size: 24,
            ),
            SizedBox(width: 8),
            Text(
              'Remove Proof',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
          ],
        ),
        content: const Text(
          'Are you sure you want to remove this proof from your report?',
          style: TextStyle(fontSize: 14, color: Color(0xFF475569)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text(
              'Cancel',
              style: TextStyle(
                color: Color(0xFF64748B),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Text(
              'Remove',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      setState(() {
        _proofs.removeAt(_selectedProofIndex);
        if (_selectedProofIndex >= _proofs.length) {
          _selectedProofIndex = _proofs.isNotEmpty ? _proofs.length - 1 : 0;
        }
      });
    }
  }

  String _formatDuration(int totalSeconds) {
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '${minutes.toString()}:${seconds.toString().padLeft(2, '0')}';
  }

  Future<void> _chooseIncidentTime(String choice) async {
    if (choice == 'unknown') {
      setState(() {
        _incidentTimeChoice = 'unknown';
        _incidentOccurredAt = null;
        _incidentTimePrecision = 'unknown';
      });
      return;
    }
    if (choice == 'just_now') {
      setState(() {
        _incidentTimeChoice = 'just_now';
        _incidentOccurredAt = DateTime.now();
        _incidentTimePrecision = 'exact';
      });
      return;
    }
    setState(() {
      _incidentTimeChoice = 'earlier';
      _incidentOccurredAt ??= DateTime.now();
      if (_incidentTimePrecision == 'unknown') {
        _incidentTimePrecision = 'exact';
      }
    });
    await _pickIncidentOccurredAt();
  }

  Future<void> _pickIncidentOccurredAt() async {
    final now = DateTime.now();
    final initial = (_incidentOccurredAt ?? now).toLocal();
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now) ? now : initial,
      firstDate: DateTime(1900),
      lastDate: now,
      helpText: 'When did the incident happen?',
    );
    if (pickedDate == null || !mounted) return;
    final pickedTime = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
      helpText: 'Choose the incident time',
    );
    if (pickedTime == null || !mounted) return;
    final selected = DateTime(
      pickedDate.year,
      pickedDate.month,
      pickedDate.day,
      pickedTime.hour,
      pickedTime.minute,
    );
    if (selected.isAfter(DateTime.now())) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Incident time cannot be in the future.')),
      );
      return;
    }
    setState(() => _incidentOccurredAt = selected);
  }

  Widget _buildIncidentTimeInput() {
    final occurredAt = _incidentOccurredAt;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'When did the incident happen?',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1E293B),
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'This is separate from when your report reaches dispatch.',
          style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              label: const Text('Just now'),
              selected: _incidentTimeChoice == 'just_now',
              onSelected: (_) => _chooseIncidentTime('just_now'),
            ),
            ChoiceChip(
              label: const Text('Earlier'),
              selected: _incidentTimeChoice == 'earlier',
              onSelected: (_) => _chooseIncidentTime('earlier'),
            ),
            ChoiceChip(
              label: const Text('Not sure'),
              selected: _incidentTimeChoice == 'unknown',
              onSelected: (_) => _chooseIncidentTime('unknown'),
            ),
          ],
        ),
        if (_incidentTimeChoice == 'just_now') ...[
          const SizedBox(height: 2),
          Text(
            occurredAt == null
                ? 'Current device time will be recorded.'
                : 'Current device time: ${DateFormat('MMM d, yyyy · h:mm a').format(occurredAt.toLocal())}',
            style: const TextStyle(fontSize: 12, color: Color(0xFF475569)),
          ),
        ] else if (_incidentTimeChoice == 'earlier') ...[
          const SizedBox(height: 2),
          OutlinedButton.icon(
            onPressed: _pickIncidentOccurredAt,
            icon: const Icon(Icons.edit_calendar_outlined, size: 18),
            label: Text(
              occurredAt == null
                  ? 'Choose date and time'
                  : DateFormat('MMM d, yyyy · h:mm a').format(occurredAt.toLocal()),
            ),
          ),
          Wrap(
            spacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Exact'),
                selected: _incidentTimePrecision == 'exact',
                onSelected: (_) => setState(() => _incidentTimePrecision = 'exact'),
              ),
              ChoiceChip(
                label: const Text('Approximate'),
                selected: _incidentTimePrecision == 'approximate',
                onSelected: (_) => setState(() => _incidentTimePrecision = 'approximate'),
              ),
            ],
          ),
        ] else ...[
          const SizedBox(height: 2),
          const Text(
            'The incident time will be recorded as unknown.',
            style: TextStyle(fontSize: 12, color: Color(0xFF475569)),
          ),
        ],
      ],
    );
  }

  Future<void> _submitReport() async {
    if (_isRefreshingLocation) return;
    if (!_keepCurrentLocationForSubmit || _currentLocation == null) {
      await _getLocation(requestPermission: false);
    }
    if (!mounted) return;
    if (!_isInsideNorzagaray || _currentLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'You can report incidents only from inside the active municipality boundary.',
          ),
        ),
      );
      return;
    }
    if (_reportType == 'community' && _selectedCategory == null) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Please select a Category')));
      return;
    }
    if ((_reportType == 'community' || _sendTo == 'barangay') &&
        _selectedBarangayId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Set your barangay in Settings before submitting this report.',
          ),
        ),
      );
      return;
    }
    if (_proofs.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Proof of Incident is mandatory')),
      );
      return;
    }
    setState(() => _isUploading = true);

    try {
      final profile = OfflineService.getProfile();
      if (profile == null) {
        throw Exception(
          'Phone number missing. Please set your phone number first.',
        );
      }

      final token = profile['token']?.toString();
      final reporterName = (profile['full_name'] ?? '').toString().trim();
      final nameParts = reporterName
          .split(RegExp(r'\s+'))
          .where((part) => part.isNotEmpty)
          .toList();
      final email = (profile['email'] ?? '').toString().trim();
      final rawPhone = (profile['contact_number'] ?? '').toString().trim();
      _clientSubmittedAt ??= DateTime.now().toUtc();
      final fields = <String, dynamic>{
        'client_request_id': _clientRequestId,
        'client_submitted_at': _clientSubmittedAt!.toIso8601String(),
        'incident_occurred_at': _incidentOccurredAt?.toUtc().toIso8601String(),
        'incident_time_precision': _incidentTimePrecision,
        'type': _reportType,
        'title': _reportType == 'emergency'
            ? 'Emergency Incident'
            : _selectedCategory!,
        'specifics': _selectedSpecific ?? '',
        'description': _descController.text,
        'latitude': _currentLocation!.latitude.toString(),
        'longitude': _currentLocation!.longitude.toString(),
        'proof_type': _proofs.first.type,
        'proof_types': jsonEncode(_proofs.map((p) => p.type).toList()),
        'reporter_type': 'resident',
        'reporter_name': reporterName,
        'reporter_email': email,
        'first_name': nameParts.isNotEmpty ? nameParts.first : '',
        'last_name': nameParts.length > 1 ? nameParts.skip(1).join(' ') : '',
        'contact_number': rawPhone.contains('@')
            ? ''
            : PhoneNumberUtils.digitsOnly(rawPhone),
        'send_to': _sendTo,
      };

      // Barangay routing
      if (_selectedBarangayId != null) {
        fields['barangay_id'] = _selectedBarangayId!;
      }

      // Commit the incident before transferring large evidence files.
      final response = await http
          .post(
            Uri.parse('${AppConstants.apiBaseUrl}/incident-reports'),
            headers: {
              'ngrok-skip-browser-warning': 'true',
              'Content-Type': 'application/json',
              if (token != null && token.isNotEmpty)
                'Authorization': 'Bearer $token',
            },
            body: jsonEncode(fields),
          )
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 201 || response.statusCode == 200) {
        if (_draftId != null) await OfflineService.deleteDraft(_draftId!);
        final result = Map<String, dynamic>.from(
          jsonDecode(response.body) as Map,
        );
        final reportData = result['report'] is Map
            ? Map<String, dynamic>.from(result['report'] as Map)
            : <String, dynamic>{};
        final reportId = reportData['id']?.toString();
        if (reportId != null && reportId.isNotEmpty) {
          unawaited(
            EvidenceUploadService.queueAndUpload(
              reportId: reportId,
              filePaths: _proofs.map((proof) => proof.file.path).toList(),
              proofTypes: _proofs.map((proof) => proof.type).toList(),
              contactNumber: fields['contact_number'].toString(),
            ),
          );
        }
        if (mounted) {
          final recipient = _sendTo == 'barangay'
              ? (_selectedBarangayName == null
                    ? 'your barangay'
                    : 'Barangay $_selectedBarangayName')
              : 'MDRRMO';
          showDialog(
            context: context,
            barrierDismissible: false,
            builder: (context) => AlertDialog(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              title: const Row(
                children: [
                  Icon(Icons.check_circle, color: Color(0xFF27AE60)),
                  SizedBox(width: 8),
                  Text('Report Submitted!'),
                ],
              ),
              content: Text(
                'Your report is being reviewed by $recipient.',
                style: const TextStyle(fontSize: 18, height: 1.4),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    Navigator.pushReplacement(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const MyReportsScreen(),
                      ),
                    );
                  },
                  child: const Text('View My Reports'),
                ),
              ],
            ),
          );
        }
      } else {
        final errorData = jsonDecode(response.body);
        throw Exception(
          errorData['error'] ??
              errorData['message'] ??
              'Failed to submit report',
        );
      }
    } catch (e) {
      debugPrint('Submission error: $e');
      final isNetworkFailure =
          e is SocketException ||
          e is TimeoutException ||
          e is http.ClientException;
      if (mounted && isNetworkFailure) {
        _draftId = await OfflineService.saveDraft(_draftData(), id: _draftId);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No internet connection. Report saved to Drafts.'),
            backgroundColor: Colors.orange,
          ),
        );
        _popAfterConfirmation();
      } else if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Could not submit report: $e')));
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = _communityCategories;
    final headerColor = _reportType == 'emergency'
        ? const Color(0xFFE53935)
        : const Color(0xFFF39C12);

    return PopScope<void>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmExit();
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: ResidentGradientAppBar(
          colors: _reportType == 'emergency'
              ? ResidentHeaderGradients.emergency
              : ResidentHeaderGradients.community,
          title: Text(
            _reportType == 'emergency'
                ? 'Emergency Incident'
                : 'Community Incident',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
          ),
          actions: [
            IconButton(
              tooltip: 'Refresh location',
              onPressed: _isRefreshingLocation
                  ? null
                  : () => _getLocation(showResult: true),
              icon: _isRefreshingLocation
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.my_location_rounded),
            ),
          ],
        ),
        body: !_locationCheckComplete
            ? const Center(child: CircularProgressIndicator())
            : !_isInsideNorzagaray
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.location_off_rounded,
                        color: Color(0xFF64748B),
                        size: 54,
                      ),
                      const SizedBox(height: 14),
                      const Text(
                        'Reporting is available inside Norzagaray',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1E293B),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _currentLocation == null
                            ? 'Turn on GPS and refresh your location to continue.'
                            : 'Your current location is outside the Municipality of Norzagaray.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          height: 1.4,
                        ),
                      ),
                      const SizedBox(height: 18),
                      OutlinedButton.icon(
                        onPressed: _isRefreshingLocation
                            ? null
                            : () => _getLocation(showResult: true),
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Check location again'),
                      ),
                    ],
                  ),
                ),
              )
            : SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Barangay Selection ─────────────────────────────────
                    const Text(
                      'Send Report To',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1E293B),
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (_reportType == 'emergency') ...[
                      Row(
                        children: [
                          // Barangay Button (matching user screenshot)
                          Expanded(
                            child: SizedBox(
                              height: 48,
                              child: ElevatedButton(
                                onPressed: _selectedBarangayId == null
                                    ? null
                                    : () =>
                                          setState(() => _sendTo = 'barangay'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: _sendTo == 'barangay'
                                      ? const Color(0xFF1B4F72)
                                      : Colors.white,
                                  foregroundColor: _sendTo == 'barangay'
                                      ? Colors.white
                                      : const Color(0xFF1B4F72),
                                  elevation: _sendTo == 'barangay' ? 2 : 0,
                                  side: BorderSide(
                                    color: const Color(0xFF1B4F72),
                                    width: _sendTo == 'barangay' ? 0 : 1.5,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                  ),
                                ),
                                child: Text(
                                  _selectedBarangayName != null
                                      ? 'Barangay $_selectedBarangayName'
                                      : 'Set Barangay in Settings',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          // MDRRMO Button (matching user screenshot)
                          Expanded(
                            child: SizedBox(
                              height: 48,
                              child: ElevatedButton(
                                onPressed: () =>
                                    setState(() => _sendTo = 'mdrrmo'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: _sendTo == 'mdrrmo'
                                      ? const Color(0xFFE53935)
                                      : Colors.white,
                                  foregroundColor: _sendTo == 'mdrrmo'
                                      ? Colors.white
                                      : const Color(0xFFE53935),
                                  elevation: _sendTo == 'mdrrmo' ? 2 : 0,
                                  side: BorderSide(
                                    color: const Color(0xFFE53935),
                                    width: _sendTo == 'mdrrmo' ? 0 : 1.5,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                ),
                                child: const Text(
                                  'MDRRMO',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            const Icon(
                              Icons.info_outline,
                              size: 15,
                              color: Color(0xFF1E88E5),
                            ),
                            const SizedBox(width: 5),
                            Expanded(
                              child: Text(
                                _sendTo == 'barangay'
                                    ? (_selectedBarangayName != null
                                          ? 'Report will be sent to $_selectedBarangayName (Only your barangay will see this)'
                                          : 'Report will be sent to your Barangay')
                                    : 'Report will be sent to MDRRMO (Only MDRRMO will see this)',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF1E88E5),
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ] else ...[
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 14,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          border: Border.all(color: Colors.grey.shade300),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.location_city,
                              color: Color(0xFF1B4F72),
                              size: 20,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _selectedBarangayName == null
                                    ? 'Barangay not set in Settings'
                                    : 'Barangay $_selectedBarangayName',
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Color(0xFF1E293B),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const Text(
                              'Change in Settings',
                              style: TextStyle(
                                fontSize: 11,
                                color: Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.info_outline,
                              size: 14,
                              color: Color(0xFF1E88E5),
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                _selectedBarangayName == null
                                    ? 'Set your barangay in Settings to route this report.'
                                    : 'Report will be sent to $_selectedBarangayName and MDRRMO',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF1E88E5),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 18),

                    if (_reportType == 'community') ...[
                      DropdownButtonFormField<String>(
                        value: _selectedCategory,
                        decoration: InputDecoration(
                          labelText: 'Category',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: BorderSide(color: Colors.grey.shade300),
                          ),
                        ),
                        items: categories.keys
                            .map(
                              (c) => DropdownMenuItem<String>(
                                value: c,
                                child: Text(c),
                              ),
                            )
                            .toList(),
                        onChanged: (v) => setState(() {
                          _selectedCategory = v;
                          _selectedSpecific = null;
                        }),
                      ),

                      if (_selectedCategory != null) ...[
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          value: _selectedSpecific,
                          decoration: InputDecoration(
                            labelText: 'Specifics (Optional)',
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide(
                                color: Colors.grey.shade300,
                              ),
                            ),
                          ),
                          items: categories[_selectedCategory]!
                              .map(
                                (s) => DropdownMenuItem<String>(
                                  value: s,
                                  child: Text(s),
                                ),
                              )
                              .toList(),
                          onChanged: (v) =>
                              setState(() => _selectedSpecific = v),
                        ),
                      ],
                      const SizedBox(height: 14),
                    ],

                    _buildIncidentTimeInput(),
                    const SizedBox(height: 18),

                    // ── Proof of Incident ──────────────────────────────────
                    const Text(
                      'Proof of Incident *',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1E293B),
                      ),
                    ),
                    const SizedBox(height: 8),

                    if (_proofs.isEmpty)
                      // Image 1: Initial empty state
                      InkWell(
                        onTap: _showMediaSourceSheet,
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(vertical: 20),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            border: Border.all(color: Colors.grey.shade300),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.camera_alt,
                                size: 28,
                                color: Color(0xFF1E293B),
                              ),
                              SizedBox(height: 6),
                              Text(
                                'Take photo / video',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF475569),
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    else
                      // Image 2: Multi-proof layout with preview, remove button, and thumbnail strip
                      Container(
                        width: double.infinity,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          border: Border.all(color: Colors.grey.shade300),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Upper preview area
                            Container(
                              height: 200,
                              width: double.infinity,
                              color: Colors.black,
                              child: Stack(
                                children: [
                                  // Focused proof preview
                                  Positioned.fill(
                                    child: Center(
                                      child:
                                          _proofs[_selectedProofIndex].type ==
                                              'video'
                                          ? VideoProofPlayer(
                                              url: '',
                                              file: _proofs[_selectedProofIndex]
                                                  .file,
                                              proofType: 'video',
                                              height: 200,
                                            )
                                          : Image.file(
                                              _proofs[_selectedProofIndex].file,
                                              fit: BoxFit.contain,
                                              width: double.infinity,
                                              height: double.infinity,
                                            ),
                                    ),
                                  ),

                                  // Top-right "Remove" button badge (Image 2 style)
                                  Positioned(
                                    top: 10,
                                    right: 10,
                                    child: Material(
                                      color: Colors.transparent,
                                      child: InkWell(
                                        onTap: _confirmRemoveProof,
                                        borderRadius: BorderRadius.circular(6),
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 10,
                                            vertical: 5,
                                          ),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFEF4444),
                                            borderRadius: BorderRadius.circular(
                                              6,
                                            ),
                                          ),
                                          child: const Text(
                                            'Remove',
                                            style: TextStyle(
                                              color: Colors.white,
                                              fontSize: 12,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            // Divider between preview and thumbnails
                            Container(height: 1, color: Colors.grey.shade300),

                            // Lower section: thumbnails strip and add button [+]
                            Padding(
                              padding: const EdgeInsets.all(12),
                              child: SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: Row(
                                  children: [
                                    // Proof thumbnails
                                    ...List.generate(_proofs.length, (index) {
                                      final isSelected =
                                          index == _selectedProofIndex;
                                      final proof = _proofs[index];
                                      return GestureDetector(
                                        onTap: () {
                                          setState(
                                            () => _selectedProofIndex = index,
                                          );
                                        },
                                        child: Container(
                                          width: 56,
                                          height: 56,
                                          margin: const EdgeInsets.only(
                                            right: 10,
                                          ),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFF1E293B),
                                            borderRadius: BorderRadius.circular(
                                              8,
                                            ),
                                            border: isSelected
                                                ? Border.all(
                                                    color: const Color(
                                                      0xFF0284C7,
                                                    ),
                                                    width: 2.5,
                                                  )
                                                : Border.all(
                                                    color: Colors.grey.shade300,
                                                    width: 1.5,
                                                  ),
                                          ),
                                          child: ClipRRect(
                                            borderRadius: BorderRadius.circular(
                                              isSelected ? 5.5 : 6.5,
                                            ),
                                            child: proof.type == 'video'
                                                ? const Center(
                                                    child: Icon(
                                                      Icons.videocam,
                                                      color: Colors.white,
                                                      size: 24,
                                                    ),
                                                  )
                                                : Image.file(
                                                    proof.file,
                                                    fit: BoxFit.cover,
                                                    width: double.infinity,
                                                    height: double.infinity,
                                                    errorBuilder: (_, _, _) =>
                                                        const Center(
                                                          child: Icon(
                                                            Icons.image,
                                                            color:
                                                                Colors.white70,
                                                            size: 24,
                                                          ),
                                                        ),
                                                  ),
                                          ),
                                        ),
                                      );
                                    }),

                                    // Add button [+]
                                    GestureDetector(
                                      onTap: _addProof,
                                      child: Container(
                                        width: 56,
                                        height: 56,
                                        decoration: BoxDecoration(
                                          color: Colors.white,
                                          borderRadius: BorderRadius.circular(
                                            8,
                                          ),
                                          border: Border.all(
                                            color: const Color(0xFF64748B),
                                            width: 1.2,
                                          ),
                                        ),
                                        child: const Center(
                                          child: Icon(
                                            Icons.add,
                                            size: 28,
                                            color: Color(0xFF1E293B),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                    const SizedBox(height: 18),

                    // ── Description ────────────────────────────────────────
                    TextField(
                      controller: _descController,
                      maxLines: 4,
                      decoration: InputDecoration(
                        hintText: 'Description',
                        labelText: _reportType == 'emergency'
                            ? 'Description'
                            : 'Description (Optional)',
                        alignLabelWithHint: true,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide(color: headerColor),
                        ),
                      ),
                    ),

                    const SizedBox(height: 18),

                    // ── Your Location Box (Matching Image 1 & 2) ───────────
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEBF3FF),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.location_on,
                            color: Color(0xFF1E88E5),
                            size: 24,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Your Location',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                    color: Color(0xFF1E293B),
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _currentLocation != null
                                      ? '${_currentLocation!.latitude!.toStringAsFixed(6)}, ${_currentLocation!.longitude!.toStringAsFixed(6)}'
                                      : 'Fetching location...',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: Color(0xFF64748B),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 28),

                    // ── Submit Report Button ───────────────────────────────
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _isUploading ? null : _submitReport,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: headerColor,
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: _isUploading
                            ? const CircularProgressIndicator(
                                color: Colors.white,
                              )
                            : const Text(
                                'Submit Report',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }

  @override
  void dispose() {
    _descController.dispose();
    super.dispose();
  }
}
