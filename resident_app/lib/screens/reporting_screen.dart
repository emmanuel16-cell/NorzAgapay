import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'dart:math';
import '../services/offline_service.dart';
import '../services/norzagaray_boundary.dart';
import '../services/resident_gps_service.dart';
import '../services/evidence_upload_service.dart';
import '../core/constants.dart';
import '../core/incident_time_format.dart';
import '../core/phone_number_utils.dart';
import '../widgets/resident_gradient_app_bar.dart';
import '../widgets/municipality_boundary_map_layer.dart';
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
  bool get _hasSignedInProfile {
    final token = OfflineService.getProfile()?['token']?.toString();
    return token != null && token.isNotEmpty;
  }
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
  int _earlierHours = 0;
  int _earlierMinutes = 30;
  bool _keepCurrentLocationForSubmit = false;
  final TextEditingController _descController = TextEditingController();
  final TextEditingController _guestPhoneController = TextEditingController();

  LatLng? _currentLocation;
  String? _locationSource;
  bool _locationCheckComplete = false;
  bool _isInsideNorzagaray = false;
  bool _isRefreshingLocation = false;

  // Barangay selection & routing
  List<Map<String, dynamic>> _barangays = [];
  String? _selectedBarangayId;
  String? _selectedBarangayName;
  String? _recipientBarangayId;
  String _sendTo = 'mdrrmo'; // 'barangay' or 'mdrrmo'

  Map<String, dynamic>? get _closestBarangay {
    final incidentLocation = _currentLocation;
    if (incidentLocation == null) return null;

    Map<String, dynamic>? nearest;
    var nearestDistance = double.infinity;
    for (final barangay in _barangays) {
      final officialLatitude = _validCoordinate(barangay['location_latitude'], -90, 90);
      final officialLongitude = _validCoordinate(barangay['location_longitude'], -180, 180);
      final useOfficialLocation = officialLatitude != null && officialLongitude != null;
      final latitude = useOfficialLocation
          ? officialLatitude
          : _validCoordinate(barangay['latitude'], -90, 90);
      final longitude = useOfficialLocation
          ? officialLongitude
          : _validCoordinate(barangay['longitude'], -180, 180);
      if (latitude == null || longitude == null) continue;

      final distance = _distanceMeters(
        incidentLocation.latitude!,
        incidentLocation.longitude!,
        latitude,
        longitude,
      );
      if (distance < nearestDistance) {
        nearest = barangay;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  String? get _closestBarangayName => _closestBarangay?['name']?.toString();
  String get _locationSourceLabel =>
      _locationSource == 'map' ? 'Chosen on map' : 'Current location';

  List<Map<String, dynamic>> get _routingBarangays {
    final closestId = _closestBarangay?['id']?.toString();
    final ordered = List<Map<String, dynamic>>.from(_barangays);
    ordered.sort((first, second) {
      final firstId = first['id']?.toString();
      final secondId = second['id']?.toString();
      if (firstId == closestId) return -1;
      if (secondId == closestId) return 1;
      return (first['name']?.toString() ?? '').compareTo(second['name']?.toString() ?? '');
    });
    return ordered;
  }

  String _barangayOptionLabel(Map<String, dynamic> barangay) {
    final name = barangay['name']?.toString() ?? 'Barangay';
    final isClosest = barangay['id']?.toString() ==
        _closestBarangay?['id']?.toString();
    return isClosest ? '$name · Recommended' : name;
  }

  String? get _recipientDestinationId {
    if (_recipientBarangayId != null &&
        _barangays.any((barangay) => barangay['id']?.toString() == _recipientBarangayId)) {
      return _recipientBarangayId;
    }
    return _closestBarangay?['id']?.toString();
  }

  String? get _recipientDestinationName {
    for (final barangay in _barangays) {
      if (barangay['id']?.toString() == _recipientDestinationId) {
        return barangay['name']?.toString();
      }
    }
    return null;
  }

  double? _validCoordinate(dynamic value, double minimum, double maximum) {
    final coordinate = double.tryParse(value?.toString() ?? '');
    if (coordinate == null || !coordinate.isFinite || coordinate < minimum || coordinate > maximum) {
      return null;
    }
    return coordinate;
  }

  double _distanceMeters(double latitude1, double longitude1, double latitude2, double longitude2) {
    const radians = pi / 180;
    final latitudeDelta = (latitude2 - latitude1) * radians;
    final longitudeDelta = (longitude2 - longitude1) * radians;
    final a = pow(sin(latitudeDelta / 2), 2) +
        cos(latitude1 * radians) * cos(latitude2 * radians) *
        pow(sin(longitudeDelta / 2), 2);
    return 6371000 * 2 * atan2(sqrt(a), sqrt(max(0, 1 - a)));
  }

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
    _incidentTimePrecision =
        const {'exact', 'approximate'}.contains(savedPrecision)
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
    if (_incidentTimeChoice == 'earlier' && _incidentOccurredAt != null) {
      final elapsedMinutes = DateTime.now()
          .difference(_incidentOccurredAt!.toLocal())
          .inMinutes;
      if (elapsedMinutes > 0) {
        _earlierHours = elapsedMinutes ~/ 60;
        _earlierMinutes = elapsedMinutes % 60;
      }
    }
    _selectedCategory = draft['category']?.toString();
    _selectedSpecific = draft['specifics']?.toString();
    _descController.text = draft['description']?.toString() ?? '';
    _guestPhoneController.text = draft['guest_phone']?.toString() ?? '';
    final savedRecipient = draft['send_to']?.toString();
    _sendTo = const {'barangay', 'mdrrmo'}.contains(savedRecipient)
        ? savedRecipient!
        : 'mdrrmo';
    _selectedBarangayId = draft['barangay_id']?.toString();
    _selectedBarangayName = draft['barangay_name']?.toString();
    _recipientBarangayId = draft['recipient_barangay_id']?.toString();
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
      _locationSource = draft['location_source']?.toString() == 'map'
          ? 'map'
          : 'current';
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
    'location_source': _locationSource,
    'client_submitted_at': _clientSubmittedAt?.toUtc().toIso8601String(),
    'incident_time_choice': _incidentTimeChoice,
    'incident_occurred_at': _incidentOccurredAt?.toUtc().toIso8601String(),
    'incident_time_precision': _incidentTimePrecision,
    'proof_paths': _proofs.map((proof) => proof.file.path).toList(),
    'proof_types': _proofs.map((proof) => proof.type).toList(),
    'proof_durations': _proofs.map((proof) => proof.durationSeconds).toList(),
    'send_to': _sendTo,
    'recipient_barangay_id': _recipientBarangayId,
    'guest_phone': _guestPhoneController.text,
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
      _locationSource = location == null ? null : 'current';
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

  Future<void> _chooseIncidentLocationOnMap() async {
    LatLng? draftLocation = _currentLocation;
    final selectedLocation = await showDialog<LatLng>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) {
          final isInsideMunicipality = draftLocation != null &&
              (!NorzagarayBoundary.isEnabled ||
                  NorzagarayBoundary.containsPoint(draftLocation!));
          return AlertDialog(
            title: const Text('Choose incident location'),
            content: SizedBox(
              width: double.maxFinite,
              height: min(MediaQuery.sizeOf(context).height * 0.52, 430),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Tap the map inside Norzagaray to place the incident pin.'),
                  const SizedBox(height: 10),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: FlutterMap(
                        options: MapOptions(
                          initialCenter: draftLocation ?? NorzagarayBoundary.townCenter,
                          initialZoom: 13,
                          cameraConstraint: NorzagarayBoundary.isEnabled
                              ? CameraConstraint.containCenter(
                                  bounds: NorzagarayBoundary.cameraBounds,
                                )
                              : CameraConstraint.unconstrained(),
                          onTap: (_, point) =>
                              setDialogState(() => draftLocation = point),
                        ),
                        children: [
                          TileLayer(
                            urlTemplate:
                                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                            userAgentPackageName: 'com.norzagapay.resident',
                          ),
                          const MunicipalityBoundaryMapLayer(
                            outsideColor: Colors.white,
                          ),
                          if (draftLocation != null)
                            MarkerLayer(
                              markers: [
                                Marker(
                                  point: draftLocation!,
                                  width: 42,
                                  height: 50,
                                  child: const Icon(
                                    Icons.location_pin,
                                    color: Color(0xFFEF4444),
                                    size: 44,
                                  ),
                                ),
                              ],
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    draftLocation == null
                        ? 'No location selected'
                        : '${draftLocation!.latitude.toStringAsFixed(6)}, ${draftLocation!.longitude.toStringAsFixed(6)}',
                    style: const TextStyle(fontSize: 12),
                  ),
                  if (!isInsideMunicipality)
                    const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: Text(
                        'Choose a point inside Norzagaray to continue.',
                        style: TextStyle(color: Color(0xFFB91C1C), fontSize: 12),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: isInsideMunicipality
                    ? () => Navigator.pop(dialogContext, draftLocation)
                    : null,
                child: const Text('Use this location'),
              ),
            ],
          );
        },
      ),
    );
    if (selectedLocation == null || !mounted) return;
    final isInside = !NorzagarayBoundary.isEnabled ||
        NorzagarayBoundary.containsPoint(selectedLocation);
    setState(() {
      _currentLocation = selectedLocation;
      _locationSource = 'map';
      _isInsideNorzagaray = isInside;
      _locationCheckComplete = true;
      _keepCurrentLocationForSubmit = isInside;
    });
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

  int get _maxEarlierMinutes {
    final now = DateTime.now();
    final minutesSinceMidnight = now.hour * 60 + now.minute;
    final existingElapsed = _incidentOccurredAt == null
        ? 0
        : now.difference(_incidentOccurredAt!.toLocal()).inMinutes;
    return max(minutesSinceMidnight, existingElapsed);
  }

  void _updateEarlierTime({int? hours, int? minutes}) {
    final maxMinutes = _maxEarlierMinutes;
    final nextHours = (hours ?? _earlierHours)
        .clamp(0, maxMinutes ~/ 60)
        .toInt();
    final maximumMinute = min(59, maxMinutes - nextHours * 60);
    var nextMinutes = (minutes ?? _earlierMinutes)
        .clamp(0, maximumMinute)
        .toInt();
    if (nextHours == 0 && nextMinutes == 0 && maxMinutes > 0) {
      nextMinutes = 1;
    }
    setState(() {
      _earlierHours = nextHours;
      _earlierMinutes = nextMinutes;
      _incidentOccurredAt = DateTime.now().subtract(
        Duration(hours: nextHours, minutes: nextMinutes),
      );
      if (_incidentTimePrecision == 'unknown') {
        _incidentTimePrecision = 'approximate';
      }
    });
  }

  void _chooseIncidentTime(String choice) {
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
    if (_incidentTimeChoice == 'earlier') return;
    final availableMinutes = _maxEarlierMinutes;
    final initialMinutes = min(30, availableMinutes);
    setState(() {
      _incidentTimeChoice = 'earlier';
      _earlierHours = initialMinutes ~/ 60;
      _earlierMinutes = initialMinutes % 60;
      if (initialMinutes == 0 && availableMinutes > 0) {
        _earlierMinutes = 1;
      }
      _incidentOccurredAt = DateTime.now().subtract(
        Duration(hours: _earlierHours, minutes: _earlierMinutes),
      );
      _incidentTimePrecision = 'approximate';
    });
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
        if (_incidentTimeChoice == 'earlier') ...[
          const SizedBox(height: 2),
          if (occurredAt != null)
            Text(
              formatIncidentAge(occurredAt, DateTime.now()),
              style: const TextStyle(fontSize: 12, color: Color(0xFF475569)),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<int>(
                  value: _earlierHours,
                  decoration: const InputDecoration(labelText: 'Hours ago'),
                  items: List.generate(
                    (_maxEarlierMinutes ~/ 60) + 1,
                    (hour) => DropdownMenuItem(
                      value: hour,
                      child: Text('$hour ${hour == 1 ? 'hour' : 'hours'}'),
                    ),
                  ),
                  onChanged: (value) {
                    if (value != null) _updateEarlierTime(hours: value);
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<int>(
                  value: _earlierMinutes,
                  decoration: const InputDecoration(labelText: 'Minutes ago'),
                  items: List.generate(
                    min(59, _maxEarlierMinutes - _earlierHours * 60) + 1,
                    (minute) => DropdownMenuItem(
                      value: minute,
                      child: Text(
                        '$minute ${minute == 1 ? 'minute' : 'minutes'}',
                      ),
                    ),
                  ),
                  onChanged: (value) {
                    if (value != null) _updateEarlierTime(minutes: value);
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Exact'),
                selected: _incidentTimePrecision == 'exact',
                onSelected: (_) =>
                    setState(() => _incidentTimePrecision = 'exact'),
              ),
              ChoiceChip(
                label: const Text('Approximate'),
                selected: _incidentTimePrecision == 'approximate',
                onSelected: (_) =>
                    setState(() => _incidentTimePrecision = 'approximate'),
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
    final profile = OfflineService.getProfile();
    final token = profile?['token']?.toString();
    final isSignedIn = token != null && token.isNotEmpty;
    final guestPhone = PhoneNumberUtils.digitsOnly(_guestPhoneController.text);
    if (!isSignedIn && !PhoneNumberUtils.isValid(guestPhone)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid 11-digit mobile number starting with 09.')),
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
      final reporterName = (isSignedIn ? profile?['full_name'] : null)?.toString().trim() ?? '';
      final nameParts = reporterName
          .split(RegExp(r'\s+'))
          .where((part) => part.isNotEmpty)
          .toList();
      final email = (isSignedIn ? profile?['email'] : null)?.toString().trim() ?? '';
      final rawPhone = isSignedIn
          ? (profile?['contact_number'] ?? profile?['phone'] ?? '').toString().trim()
          : guestPhone;
      final isFirstSubmitAttempt = _clientSubmittedAt == null;
      _clientSubmittedAt ??= DateTime.now().toUtc();
      if (isFirstSubmitAttempt && _incidentTimeChoice == 'just_now') {
        _incidentOccurredAt = _clientSubmittedAt!.toLocal();
        _incidentTimePrecision = 'exact';
      }
      final fields = <String, dynamic>{
        'client_request_id': _clientRequestId,
        'client_submitted_at': _clientSubmittedAt!.toIso8601String(),
        'incident_time_choice': _incidentTimeChoice,
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
        'reporter_type': isSignedIn ? 'resident' : 'guest',
        'reporter_name': reporterName.isNotEmpty ? reporterName : 'Guest Reporter',
        'reporter_email': email,
        'first_name': nameParts.isNotEmpty ? nameParts.first : '',
        'last_name': nameParts.length > 1 ? nameParts.skip(1).join(' ') : '',
        'contact_number': rawPhone.contains('@') ? '' : PhoneNumberUtils.digitsOnly(rawPhone),
        'send_to': _sendTo,
        if (_sendTo == 'barangay' && _recipientDestinationId != null)
          'recipient_barangay_id': _recipientDestinationId,
      };

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
                _sendTo == 'barangay'
                    ? 'Your report has been sent to the closest active barangay. They can escalate it to MDRRMO if more support is needed.'
                    : 'Your report has been sent to MDRRMO for review. The dispatcher can assign a nearby active barangay if appropriate.',
                style: const TextStyle(fontSize: 18, height: 1.4),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    Navigator.pushReplacement(
                      context,
                      MaterialPageRoute(
                        builder: (_) => MyReportsScreen(
                          guestPhone: fields['contact_number'].toString(),
                        ),
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
                            ? 'Use GPS or choose the incident location on the map to continue.'
                            : 'Your current location is outside Norzagaray. If the incident is inside the municipality, choose its location on the map.',
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
                        label: const Text('Use current location'),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: _chooseIncidentLocationOnMap,
                        icon: const Icon(Icons.map_outlined),
                        label: const Text('Choose incident location on map'),
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
                    if (!_hasSignedInProfile) ...[
                      TextField(
                        controller: _guestPhoneController,
                        keyboardType: TextInputType.phone,
                        inputFormatters: PhoneNumberUtils.inputFormatters,
                        decoration: const InputDecoration(
                          labelText: 'Mobile number *',
                          hintText: '09XXXXXXXXX',
                          helperText: 'Required so responders can contact you about this report.',
                          prefixIcon: Icon(Icons.phone),
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 18),
                    ] else ...[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(color: const Color(0xFFEFF6FF), borderRadius: BorderRadius.circular(8)),
                        child: Text(
                          _sendTo == 'barangay'
                              ? 'This report will go to ${_recipientDestinationName ?? 'the selected verified barangay'}. Its dispatcher can escalate it to MDRRMO if more support is needed.'
                              : 'This report will go to MDRRMO. A dispatcher can assign it to a nearby active barangay.',
                          style: const TextStyle(color: Color(0xFF1B4F72), fontWeight: FontWeight.w600),
                        ),
                      ),
                      const SizedBox(height: 18),
                    ],

                    const Text(
                      'Send report to',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                    ),
                    const SizedBox(height: 6),
                    RadioListTile<String>(
                      value: 'barangay',
                      groupValue: _sendTo,
                      contentPadding: EdgeInsets.zero,
                      title: Text(_closestBarangayName == null
                          ? 'Closest Barangay'
                          : 'Closest Barangay ($_closestBarangayName)'),
                      subtitle: const Text('Based on the incident location. The barangay can escalate to MDRRMO.'),
                      onChanged: (value) => setState(() => _sendTo = value!),
                    ),
                    DropdownButtonFormField<String>(
                      value: _recipientDestinationId,
                      decoration: InputDecoration(
                        labelText: 'Barangay destination (closest recommended)',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      hint: Text(_barangays.isEmpty
                          ? 'No verified barangays available'
                          : 'Select a verified barangay'),
                      items: _routingBarangays
                          .where((barangay) => barangay['id'] != null)
                          .map((barangay) => DropdownMenuItem<String>(
                                value: barangay['id'].toString(),
                                child: Text(_barangayOptionLabel(barangay)),
                              ))
                          .toList(),
                      onChanged: _barangays.isEmpty
                          ? null
                          : (value) => setState(() {
                                _recipientBarangayId = value;
                                _sendTo = 'barangay';
                              }),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'All verified barangays are listed. The closest to the incident pin is listed first and selected by default. This destination is used when barangay routing is selected below.',
                      style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                    ),
                    const SizedBox(height: 10),
                    RadioListTile<String>(
                      value: 'mdrrmo',
                      groupValue: _sendTo,
                      contentPadding: EdgeInsets.zero,
                      title: const Text('MDRRMO'),
                      subtitle: const Text('A dispatcher can assign the report to a nearby active barangay.'),
                      onChanged: (value) => setState(() => _sendTo = value!),
                    ),
                    const SizedBox(height: 12),

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
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
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
                                      'Incident location',
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 13,
                                        color: Color(0xFF1E293B),
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      _currentLocation != null
                                          ? '${_currentLocation!.latitude!.toStringAsFixed(6)}, ${_currentLocation!.longitude!.toStringAsFixed(6)} · $_locationSourceLabel'
                                          : 'Choose a current or map location',
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
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              OutlinedButton.icon(
                                onPressed: _isRefreshingLocation
                                    ? null
                                    : () => _getLocation(showResult: true),
                                icon: const Icon(Icons.my_location_rounded),
                                label: const Text('Use current location'),
                              ),
                              OutlinedButton.icon(
                                onPressed: _chooseIncidentLocationOnMap,
                                icon: const Icon(Icons.map_outlined),
                                label: const Text('Choose on map'),
                              ),
                            ],
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
    _guestPhoneController.dispose();
    super.dispose();
  }
}
