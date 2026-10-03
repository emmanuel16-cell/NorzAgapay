import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:location/location.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../widgets/municipality_boundary_map_layer.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../models/incident_report.dart';
import '../core/phone_number_utils.dart';
import '../models/barangay_user.dart';
import '../widgets/video_proof_player.dart';

class ReportDetailScreen extends StatefulWidget {
  final IncidentReport report;

  const ReportDetailScreen({super.key, required this.report});

  @override
  State<ReportDetailScreen> createState() => _ReportDetailScreenState();
}

class _ReportDetailScreenState extends State<ReportDetailScreen> {
  late IncidentReport _report;

  bool get _hasAssignedResponder =>
      _report.barangayRespondedBy != null ||
      _report.assignedTeamLeaderIds.isNotEmpty;
  bool get _hasCompletedMdrrmoRequest => _assistanceRequests.any((request) {
    final dispatcherResponded =
        request['status'] == 'actioned' || request['decision'] != null;
    return request['beyond_barangay_capability'] == true &&
        dispatcherResponded &&
        request['team_acknowledged'] == true;
  });
  bool _isProcessing = false;
  int _selectedTabIndex = 0;
  final Location _locationService = Location();
  final MapController _mapController = MapController();
  LatLng? _currentLocation;
  String? _locationMessage;
  List<Map<String, dynamic>> _assistanceRequests = [];
  final Set<String> _expandedAssistanceRequests = {};
  // Track responder field media (local session, shown in Responder Images)
  final List<XFile> _teamLeaderMedia = [];
  bool _isUploadingMedia = false;

  @override
  void initState() {
    super.initState();
    _report = widget.report;
    _loadCurrentLocation();
    _fetchAssistanceRequest();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final socket = Provider.of<SocketService>(context, listen: false);
      socket.onMdrrmoResponding((data) {
        if (mounted &&
            data != null &&
            (data['id'] == _report.id || data['reportId'] == _report.id)) {
          setState(() {
            _report = IncidentReport.fromJson(Map<String, dynamic>.from(data));
          });
        }
      });
      socket.onReportUpdated((data) {
        if (mounted &&
            data != null &&
            (data['id'] == _report.id || data['reportId'] == _report.id)) {
          setState(() {
            _report = IncidentReport.fromJson(Map<String, dynamic>.from(data));
          });
        }
      });
    });
  }

  Future<void> _fetchAssistanceRequest() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) return;
    try {
      List<Map<String, dynamic>> list = [];
      if (auth.currentUser?.isDispatcher == true) {
        list = await ApiService.getAssistanceRequests(auth.token!);
      } else {
        list = await ApiService.getMyAssistanceRequests(auth.token!);
      }
      final matches = list
          .where((r) => r['incident_report_id'] == _report.id)
          .toList();
      matches.sort((a, b) {
        final aCreated =
            DateTime.tryParse(a['created_at']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0);
        final bCreated =
            DateTime.tryParse(b['created_at']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0);
        return bCreated.compareTo(aCreated);
      });
      if (mounted) {
        setState(() {
          _assistanceRequests = matches;
          _expandedAssistanceRequests
            ..clear()
            ..addAll(
              matches.isNotEmpty ? [matches.first['id']?.toString() ?? ''] : [],
            );
        });
      }
    } catch (_) {}
  }

  Future<void> _loadCurrentLocation() async {
    try {
      var serviceEnabled = await _locationService.serviceEnabled();
      if (!serviceEnabled)
        serviceEnabled = await _locationService.requestService();
      if (!serviceEnabled) {
        if (mounted)
          setState(() => _locationMessage = 'Location service is turned off');
        return;
      }

      var permission = await _locationService.hasPermission();
      if (permission == PermissionStatus.denied) {
        permission = await _locationService.requestPermission();
      }
      if (permission != PermissionStatus.granted &&
          permission != PermissionStatus.grantedLimited) {
        if (mounted)
          setState(
            () => _locationMessage = 'Location permission was not granted',
          );
        return;
      }

      final location = await _locationService.getLocation();
      if (location.latitude != null && location.longitude != null && mounted) {
        setState(() {
          _currentLocation = LatLng(location.latitude!, location.longitude!);
          _locationMessage = null;
        });
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            final incident = LatLng(_report.latitude, _report.longitude);
            _mapController.move(_mapCenter(incident), _mapZoom(incident));
          }
        });
      }
    } catch (_) {
      if (mounted)
        setState(
          () => _locationMessage = 'Unable to get your current location',
        );
    }
  }

  LatLng _mapCenter(LatLng incidentLocation) {
    final current = _currentLocation;
    if (current == null) return incidentLocation;
    return LatLng(
      (incidentLocation.latitude + current.latitude) / 2,
      (incidentLocation.longitude + current.longitude) / 2,
    );
  }

  double _mapZoom(LatLng incidentLocation) {
    final current = _currentLocation;
    if (current == null) return 15;
    final kilometers = const Distance().as(
      LengthUnit.Kilometer,
      current,
      incidentLocation,
    );
    if (kilometers < 1) return 15;
    if (kilometers < 5) return 13;
    if (kilometers < 20) return 11;
    return 9;
  }

  // ── Dispatcher: Action Dialog (Dispatch Tanod vs Escalate to MDRRMO) ─────────
  Future<void> _showDispatcherActionDialog() async {
    // Check if MDRRMO is already responding to this incident
    if (_report.isMdrrmoResponding) {
      final confirmCoRespond = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(
                Icons.warning_amber_rounded,
                color: Color(0xFFF59E0B),
                size: 24,
              ),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'MDRRMO Responding',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          content: const Text(
            'The MDRRMO is currently responding to this incident.\n\nDo you want to proceed with barangay actions?',
            style: TextStyle(
              color: Color(0xFFE2E8F0),
              fontSize: 14,
              height: 1.5,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0284C7),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: const Text(
                'Proceed',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      );

      if (confirmCoRespond != true) return;
    }

    final choice = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Row(
          children: [
            Icon(Icons.shield_outlined, color: Color(0xFF38BDF8), size: 24),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Provide Initial Assistance & Dispatch',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Select an action to address this incident report:',
              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
            ),
            const SizedBox(height: 18),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, 'dispatch_tanod'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0284C7),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  vertical: 14,
                  horizontal: 16,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.groups_rounded, size: 20),
                  SizedBox(width: 10),
                  Text(
                    'Dispatch Tanod',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: _hasAssignedResponder
                  ? () => Navigator.pop(ctx, 'escalate_mdrrmo')
                  : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEF4444),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  vertical: 14,
                  horizontal: 16,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.emergency_rounded, size: 20),
                  const SizedBox(width: 10),
                  Text(
                    _hasAssignedResponder
                        ? 'Escalate to MDRRMO'
                        : 'Dispatch a Responder First',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text(
              'Cancel',
              style: TextStyle(color: Color(0xFF94A3B8)),
            ),
          ),
        ],
      ),
    );

    if (!mounted) return;
    if (choice == 'dispatch_tanod') {
      _showDispatchTanodModal();
    } else if (choice == 'escalate_mdrrmo') {
      _showEscalateModal();
    }
  }

  // ── Dispatcher: Available Responders Modal (multi-select) ─────────────────
  Future<void> _showDispatchTanodModal() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) return;

    List<BarangayUser> teamLeaders = [];
    bool isLoadingLeaders = true;
    String? loadError;
    final Set<String> selectedIds = {};
    final notesController = TextEditingController();
    const incidentTypes = <Map<String, String>>[
      {'value': 'flash_flood', 'label': 'Flood / Flash Flood'},
      {'value': 'fire', 'label': 'Fire'},
      {'value': 'earthquake', 'label': 'Earthquake'},
      {'value': 'medical_emergency', 'label': 'Medical Emergency'},
      {'value': 'typhoon', 'label': 'Typhoon / Severe Weather'},
      {'value': 'other', 'label': 'Other Emergency'},
    ];
    const severities = <Map<String, String>>[
      {'value': 'low', 'label': 'Low'},
      {'value': 'moderate', 'label': 'Moderate'},
      {'value': 'high', 'label': 'High'},
      {'value': 'critical', 'label': 'Critical'},
    ];
    String? classificationType =
        incidentTypes.any((option) => option['value'] == _report.incidentType)
        ? _report.incidentType
        : null;
    String? classificationSeverity =
        severities.any((option) => option['value'] == _report.severity)
        ? _report.severity
        : null;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          if (isLoadingLeaders && teamLeaders.isEmpty && loadError == null) {
            ApiService.getTeam(auth.token!)
                .then((members) {
                  if (ctx.mounted) {
                    setModalState(() {
                      teamLeaders = members
                          .where((m) => m.isResponder && m.isActive)
                          .toList();
                      isLoadingLeaders = false;
                    });
                  }
                })
                .catchError((err) {
                  if (ctx.mounted) {
                    setModalState(() {
                      loadError = err.toString();
                      isLoadingLeaders = false;
                    });
                  }
                });
          }

          return AlertDialog(
            backgroundColor: const Color(0xFF1E293B),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            title: const Row(
              children: [
                Icon(Icons.groups_rounded, color: Color(0xFF38BDF8), size: 22),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Dispatch Tanod',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            content: SizedBox(
              width: double.maxFinite,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Select one or more responders to dispatch for this incident:',
                      style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _report.title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    if ((_report.description ?? _report.specifics ?? '')
                        .trim()
                        .isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 5, bottom: 8),
                        child: Text(
                          _report.description ?? _report.specifics!,
                          style: const TextStyle(
                            color: Color(0xFFCBD5E1),
                            fontSize: 12,
                          ),
                        ),
                      ),
                    if (_report.proofUrls.isNotEmpty) ...[
                      const Text(
                        'Submitted evidence',
                        style: TextStyle(
                          color: Color(0xFFCBD5E1),
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                      ),
                      Wrap(
                        spacing: 4,
                        children: [
                          for (
                            var index = 0;
                            index < _report.proofUrls.length;
                            index++
                          )
                            TextButton.icon(
                              onPressed: () async {
                                final uri = Uri.tryParse(
                                  _report.proofUrls[index],
                                );
                                if (uri != null)
                                  await launchUrl(
                                    uri,
                                    mode: LaunchMode.externalApplication,
                                  );
                              },
                              icon: const Icon(Icons.open_in_new, size: 15),
                              label: Text('Evidence ${index + 1}'),
                            ),
                        ],
                      ),
                    ],
                    DropdownButtonFormField<String>(
                      value: classificationType,
                      dropdownColor: const Color(0xFF0F172A),
                      decoration: const InputDecoration(
                        labelText: 'Incident type',
                        labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                      ),
                      items: incidentTypes
                          .map(
                            (option) => DropdownMenuItem(
                              value: option['value'],
                              child: Text(
                                option['label']!,
                                style: const TextStyle(color: Colors.white),
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (value) =>
                          setModalState(() => classificationType = value),
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      value: classificationSeverity,
                      dropdownColor: const Color(0xFF0F172A),
                      decoration: const InputDecoration(
                        labelText: 'Severity',
                        labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                      ),
                      items: severities
                          .map(
                            (option) => DropdownMenuItem(
                              value: option['value'],
                              child: Text(
                                option['label']!,
                                style: const TextStyle(color: Colors.white),
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (value) =>
                          setModalState(() => classificationSeverity = value),
                    ),
                    const SizedBox(height: 14),
                    const SizedBox(height: 14),
                    if (isLoadingLeaders)
                      const Center(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: CircularProgressIndicator(
                            color: Color(0xFF38BDF8),
                          ),
                        ),
                      )
                    else if (loadError != null)
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          'Error loading team: $loadError',
                          style: const TextStyle(
                            color: Colors.red,
                            fontSize: 13,
                          ),
                        ),
                      )
                    else if (teamLeaders.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0F172A),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFF334155)),
                        ),
                        child: const Row(
                          children: [
                            Icon(
                              Icons.info_outline,
                              color: Color(0xFFF59E0B),
                              size: 20,
                            ),
                            SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'No active Responders available in this barangay. Please add a Responder in the Team tab.',
                                style: TextStyle(
                                  color: Color(0xFF94A3B8),
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ],
                        ),
                      )
                    else ...[
                      // Select / deselect all row
                      Row(
                        children: [
                          Checkbox(
                            value:
                                selectedIds.length == teamLeaders.length &&
                                teamLeaders.isNotEmpty,
                            tristate: true,
                            activeColor: const Color(0xFF38BDF8),
                            checkColor: Colors.white,
                            onChanged: (v) {
                              setModalState(() {
                                if (selectedIds.length == teamLeaders.length) {
                                  selectedIds.clear();
                                } else {
                                  selectedIds.addAll(
                                    teamLeaders.map((l) => l.id),
                                  );
                                }
                              });
                            },
                          ),
                          Text(
                            selectedIds.isEmpty
                                ? 'Select all'
                                : selectedIds.length == teamLeaders.length
                                ? 'Deselect all'
                                : '${selectedIds.length} selected',
                            style: TextStyle(
                              color: selectedIds.isEmpty
                                  ? const Color(0xFF94A3B8)
                                  : const Color(0xFF38BDF8),
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                      const Divider(color: Color(0xFF334155), height: 1),
                      const SizedBox(height: 8),
                      ...teamLeaders.map((leader) {
                        final isChecked = selectedIds.contains(leader.id);
                        return GestureDetector(
                          onTap: () {
                            setModalState(() {
                              if (isChecked) {
                                selectedIds.remove(leader.id);
                              } else {
                                selectedIds.add(leader.id);
                              }
                            });
                          },
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            decoration: BoxDecoration(
                              color: isChecked
                                  ? const Color(
                                      0xFF0284C7,
                                    ).withValues(alpha: 0.18)
                                  : const Color(0xFF0F172A),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: isChecked
                                    ? const Color(0xFF38BDF8)
                                    : const Color(0xFF334155),
                                width: isChecked ? 1.5 : 1.0,
                              ),
                            ),
                            child: CheckboxListTile(
                              value: isChecked,
                              activeColor: const Color(0xFF38BDF8),
                              checkColor: Colors.white,
                              onChanged: (v) {
                                setModalState(() {
                                  if (v == true) {
                                    selectedIds.add(leader.id);
                                  } else {
                                    selectedIds.remove(leader.id);
                                  }
                                });
                              },
                              title: Text(
                                leader.fullName,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                              subtitle: Text(
                                leader.phone == null || leader.phone!.isEmpty
                                    ? leader.email
                                    : PhoneNumberUtils.formatForDisplay(
                                        leader.phone,
                                      ),
                                style: const TextStyle(
                                  color: Color(0xFF94A3B8),
                                  fontSize: 12,
                                ),
                              ),
                              secondary: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(
                                    0xFF10B981,
                                  ).withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text(
                                  'Available',
                                  style: TextStyle(
                                    color: Color(0xFF10B981),
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        );
                      }),
                      const SizedBox(height: 12),
                      TextField(
                        controller: notesController,
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(
                          labelText: 'Dispatch Instructions (Optional)',
                          labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                          hintText:
                              'e.g., Proceed with 3 tanod volunteers and report back',
                          hintStyle: TextStyle(
                            color: Color(0xFF64748B),
                            fontSize: 12,
                          ),
                          filled: true,
                          fillColor: Color(0xFF0F172A),
                          border: OutlineInputBorder(),
                        ),
                        maxLines: 2,
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text(
                  'Cancel',
                  style: TextStyle(color: Color(0xFF94A3B8)),
                ),
              ),
              ElevatedButton(
                onPressed:
                    (selectedIds.isEmpty ||
                        _isProcessing ||
                        classificationType == null ||
                        classificationSeverity == null)
                    ? null
                    : () async {
                        final ids = selectedIds.toList();
                        final selectedNames = teamLeaders
                            .where((l) => ids.contains(l.id))
                            .map((l) => l.fullName)
                            .join(', ');
                        Navigator.pop(ctx);
                        setState(() => _isProcessing = true);
                        try {
                          final updated = await ApiService.dispatchReport(
                            auth.token!,
                            _report.id,
                            teamLeaderIds: ids,
                            notes: notesController.text.trim().isEmpty
                                ? null
                                : notesController.text.trim(),
                            incidentType: classificationType!,
                            severity: classificationSeverity!,
                          );
                          setState(() => _report = updated);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  ids.length == 1
                                      ? 'Dispatched to $selectedNames! Incident will appear in their pending queue.'
                                      : 'Dispatched to $selectedNames (${ids.length} responders).',
                                ),
                                backgroundColor: const Color(0xFF10B981),
                              ),
                            );
                          }
                        } catch (e) {
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text('Error dispatching: $e'),
                                backgroundColor: Colors.red,
                              ),
                            );
                          }
                        } finally {
                          if (mounted) setState(() => _isProcessing = false);
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0284C7),
                ),
                child: Text(
                  classificationType == null || classificationSeverity == null
                      ? 'Classify incident first'
                      : selectedIds.isEmpty
                      ? 'Dispatch Tanod'
                      : 'Dispatch (${selectedIds.length})',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  // ── Dispatcher: Escalate to MDRRMO Modal ────────────────────────────────────
  Future<void> _showEscalateModal() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    if (!_hasAssignedResponder) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Dispatch a responder before escalating this incident to MDRRMO.',
          ),
        ),
      );
      return;
    }
    if (auth.token == null) return;
    final notesController = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.emergency_rounded, color: Color(0xFFEF4444), size: 24),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Escalate to MDRRMO',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Please explain why the barangay cannot respond and requires MDRRMO municipal assistance:',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: notesController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Reason for Escalation *',
                  labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                  hintText:
                      'e.g., Severe structure fire; beyond barangay capabilities and resources.',
                  hintStyle: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                  filled: true,
                  fillColor: Color(0xFF0F172A),
                  border: OutlineInputBorder(),
                ),
                minLines: 3,
                maxLines: 5,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text(
              'Cancel',
              style: TextStyle(color: Color(0xFF94A3B8)),
            ),
          ),
          ElevatedButton(
            onPressed: () {
              if (notesController.text.trim().isEmpty) {
                ScaffoldMessenger.of(ctx).showSnackBar(
                  const SnackBar(
                    content: Text('Please enter reason for escalation'),
                    backgroundColor: Colors.red,
                  ),
                );
                return;
              }
              Navigator.pop(ctx, true);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
            ),
            child: const Text(
              'Escalate to MDRRMO',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      setState(() => _isProcessing = true);
      try {
        final updated = await ApiService.escalateReport(
          auth.token!,
          _report.id,
          notes: notesController.text.trim(),
        );
        setState(() => _report = updated);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Incident successfully escalated to MDRRMO!'),
              backgroundColor: Color(0xFF10B981),
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error escalating: $e'),
              backgroundColor: Colors.red,
            ),
          );
        }
      } finally {
        if (mounted) setState(() => _isProcessing = false);
      }
    }
  }

  Widget _reportContactRow({
    required IconData icon,
    required String label,
    required String value,
    required String actionLabel,
    required IconData actionIcon,
    required Uri uri,
  }) {
    return Row(
      children: [
        Icon(icon, color: const Color(0xFF0284C7), size: 20),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
              ),
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF0F172A),
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        ElevatedButton.icon(
          onPressed: () => launchUrl(uri),
          icon: Icon(actionIcon, size: 16),
          label: Text(actionLabel),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF0284C7),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          ),
        ),
      ],
    );
  }

  // ── Responder: Accept Incident ───────────────────────────────────────────
  Future<void> _handleTeamLeaderAccept() async {
    setState(() => _isProcessing = true);
    final auth = Provider.of<AuthService>(context, listen: false);
    try {
      final updated = await ApiService.respondToReport(
        auth.token!,
        _report.id,
        notes: 'Accepted by Responder ${auth.currentUser?.fullName ?? ""}',
      );
      setState(() => _report = updated);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Incident accepted! Moved to Responding.'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error accepting incident: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  Future<void> _handleRecordAssessment() async {
    final condition = TextEditingController();
    final people = TextEditingController();
    final actions = TextEditingController();
    final risks = TextEditingController();
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text(
          'Field Assessment',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Record what the responder observed on scene. This update is visible to the dispatcher and resident.',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
              const SizedBox(height: 12),
              _assessmentField(
                condition,
                'Situation observed *',
                'Describe current conditions',
              ),
              _assessmentField(
                people,
                'People affected / urgency',
                'Estimated affected people and immediate risks',
              ),
              _assessmentField(
                actions,
                'Actions taken',
                'What responders have done so far',
              ),
              _assessmentField(
                risks,
                'Risks or resources needed',
                'Hazards, equipment, or support required',
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              if (condition.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Describe the situation observed before saving.',
                    ),
                  ),
                );
                return;
              }
              Navigator.pop(ctx, true);
            },
            child: const Text('Save Assessment'),
          ),
        ],
      ),
    );
    if (saved != true || !mounted) return;
    final text = [
      'FIELD ASSESSMENT',
      'Situation: ${condition.text.trim()}',
      if (people.text.trim().isNotEmpty)
        'People affected / urgency: ${people.text.trim()}',
      if (actions.text.trim().isNotEmpty)
        'Actions taken: ${actions.text.trim()}',
      if (risks.text.trim().isNotEmpty)
        'Risks / resources: ${risks.text.trim()}',
    ].join('\n');
    setState(() => _isProcessing = true);
    try {
      final auth = Provider.of<AuthService>(context, listen: false);
      final updated = await ApiService.respondToReport(
        auth.token!,
        _report.id,
        notes: text,
      );
      if (mounted) {
        setState(() => _report = updated);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Field assessment saved.'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
      }
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not save assessment: $e'),
            backgroundColor: Colors.red,
          ),
        );
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  Widget _assessmentField(
    TextEditingController controller,
    String label,
    String hint,
  ) => Padding(
    padding: const EdgeInsets.only(top: 10),
    child: TextField(
      controller: controller,
      maxLines: 2,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: Color(0xFFCBD5E1)),
        hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
        filled: true,
        fillColor: const Color(0xFF0F172A),
        border: const OutlineInputBorder(),
      ),
    ),
  );

  Future<void> _handleRequestAssistance() async {
    bool needsManpower = false;
    bool needsResources = false;
    bool needsEquipment = false;
    bool beyondCapability = false;
    final explanationController = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Color(0xFFF59E0B)),
              SizedBox(width: 8),
              Text(
                'Request Assistance',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _hasCompletedMdrrmoRequest
                      ? 'Request additional support from the Dispatcher.'
                      : 'Request additional support from the Dispatcher or escalate to MDRRMO.',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Quick Actions — What do you need?',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                _checkboxTile(
                  ctx: ctx,
                  setDialogState: setDialogState,
                  icon: Icons.people,
                  label: 'Need more manpower',
                  value: needsManpower,
                  onChanged: (v) => needsManpower = v ?? false,
                ),
                _checkboxTile(
                  ctx: ctx,
                  setDialogState: setDialogState,
                  icon: Icons.inventory_2,
                  label: 'Need more resources / supplies',
                  value: needsResources,
                  onChanged: (v) => needsResources = v ?? false,
                ),
                _checkboxTile(
                  ctx: ctx,
                  setDialogState: setDialogState,
                  icon: Icons.construction,
                  label: 'Need equipment',
                  value: needsEquipment,
                  onChanged: (v) => needsEquipment = v ?? false,
                ),
                if (!_hasCompletedMdrrmoRequest)
                  _checkboxTile(
                    ctx: ctx,
                    setDialogState: setDialogState,
                    icon: Icons.escalator_warning,
                    label:
                        'May exceed barangay capability — request MDRRMO review',
                    value: beyondCapability,
                    onChanged: (v) => beyondCapability = v ?? false,
                  ),
                const SizedBox(height: 14),
                TextField(
                  controller: explanationController,
                  style: const TextStyle(color: Colors.white),
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Explanation / Details *',
                    labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                    hintText:
                        'e.g., We have 3 responders but need 5 more. Floodwater rising rapidly.',
                    hintStyle: TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                    ),
                    filled: true,
                    fillColor: Color(0xFF0F172A),
                    border: OutlineInputBorder(),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Color(0xFF334155)),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFF59E0B),
              ),
              child: const Text(
                'Send Request',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true) {
      final explanation = explanationController.text.trim();
      if (!(needsManpower ||
          needsResources ||
          needsEquipment ||
          beyondCapability)) {
        if (mounted)
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Select at least one type of assistance needed.'),
              backgroundColor: Colors.orange,
            ),
          );
        return;
      }
      if (explanation.length < 10) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Please provide a detailed explanation (at least 10 characters).',
              ),
              backgroundColor: Colors.orange,
            ),
          );
        }
        return;
      }
      setState(() => _isProcessing = true);
      final auth = Provider.of<AuthService>(context, listen: false);
      try {
        await ApiService.submitAssistanceRequest(
          auth.token!,
          incidentReportId: _report.id,
          incidentTitle: _report.title,
          needsMoreManpower: needsManpower,
          needsResources: needsResources,
          needsEquipment: needsEquipment,
          beyondBarangayCapability: beyondCapability,
          explanation: explanation,
        );
        await _fetchAssistanceRequest();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Assistance request sent to Dispatcher!'),
              backgroundColor: Color(0xFF10B981),
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
          );
        }
      } finally {
        if (mounted) setState(() => _isProcessing = false);
      }
    }
  }

  Widget _checkboxTile({
    required BuildContext ctx,
    required StateSetter setDialogState,
    required IconData icon,
    required String label,
    required bool value,
    required ValueChanged<bool?> onChanged,
  }) {
    return CheckboxListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      value: value,
      activeColor: const Color(0xFFF59E0B),
      checkColor: Colors.white,
      onChanged: (v) => setDialogState(() => onChanged(v)),
      title: Row(
        children: [
          Icon(icon, color: const Color(0xFF94A3B8), size: 16),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _handleCloseIncident() async {
    final notesController = TextEditingController();
    var missingResolution = false;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            'Close & Record Incident Report',
            style: TextStyle(
              color: Colors.white,
              fontSize: 17,
              fontWeight: FontWeight.bold,
            ),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Confirm that this incident has been resolved and record the response summary.',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: notesController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Resolution Summary / Notes',
                  labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                  hintText:
                      'e.g., Fire extinguished, area secured, no casualties',
                  hintStyle: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                  filled: true,
                  fillColor: Color(0xFF0F172A),
                  border: OutlineInputBorder(),
                ),
                maxLines: 3,
                onChanged: (_) {
                  if (missingResolution)
                    setDialogState(() => missingResolution = false);
                },
              ),
              if (missingResolution)
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Text(
                    'A resolution summary is required.',
                    style: TextStyle(color: Color(0xFFFCA5A5), fontSize: 12),
                  ),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
            ),
            ElevatedButton(
              onPressed: () {
                if (notesController.text.trim().isEmpty) {
                  setDialogState(() => missingResolution = true);
                  return;
                }
                Navigator.pop(ctx, true);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF10B981),
              ),
              child: const Text(
                'Close Incident',
                style: TextStyle(color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true) {
      setState(() => _isProcessing = true);
      final auth = Provider.of<AuthService>(context, listen: false);
      try {
        final updated = await ApiService.closeReport(
          auth.token!,
          _report.id,
          resolvedNotes: notesController.text.trim(),
        );
        setState(() => _report = updated);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Incident closed and recorded successfully!'),
              backgroundColor: Color(0xFF10B981),
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
          );
        }
      } finally {
        if (mounted) setState(() => _isProcessing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);
    final user = auth.currentUser;
    final canManage = user?.canRespondToEmergency ?? false;

    final incidentDetails = (_report.description ?? '')
        .replaceAll(RegExp(r'\[SEND_TO:[^\]]+\]'), '')
        .trim();
    final incidentLocation = LatLng(_report.latitude, _report.longitude);
    final isResponder = user?.isResponder ?? false;
    final isDispatcher = user?.isDispatcher ?? false;
    final showPendingRoleAction =
        _selectedTabIndex == 0 &&
        canManage &&
        _report.isPending &&
        (isDispatcher || isResponder);
    final showRespondingAction =
        ((_selectedTabIndex == 2 && canManage) ||
            (_selectedTabIndex == 1 && canManage && isResponder)) &&
        _report.isResponding &&
        !_report.isResolved;
    final savedAssessment = _report.cleanBarangayNotes;
    final assessmentStart = savedAssessment?.indexOf('FIELD ASSESSMENT') ?? -1;
    final fieldAssessment = assessmentStart >= 0
        ? savedAssessment!.substring(assessmentStart)
        : null;

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        backgroundColor: const Color(0xFFF5F6FA),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0C243B),
          surfaceTintColor: Colors.transparent,
          scrolledUnderElevation: 0,
          foregroundColor: Colors.white,
          flexibleSpace: const _IncidentResponseGradient(),
          title: const Text('Incident Response'),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(44),
            child: TabBar(
              onTap: (index) => setState(() => _selectedTabIndex = index),
              indicatorColor: const Color(0xFF64D2B4),
              indicatorWeight: 2,
              labelColor: Colors.white,
              unselectedLabelColor: Colors.white70,
              labelStyle: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
              unselectedLabelStyle: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
              tabs: const [
                Tab(text: 'Report Details'),
                Tab(text: 'Request Assistance'),
                Tab(text: 'Field Assessment'),
              ],
            ),
          ),
        ),
        bottomNavigationBar: showPendingRoleAction
            ? SafeArea(
                top: false,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
                  decoration: const BoxDecoration(
                    color: Color(0xFFF5F6FA),
                    border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                  ),
                  child: SizedBox(
                    width: double.infinity,
                    height: 42,
                    child: ElevatedButton.icon(
                      onPressed: _isProcessing
                          ? null
                          : isDispatcher
                          ? _showDispatcherActionDialog
                          : _handleTeamLeaderAccept,
                      icon: Icon(
                        isDispatcher ? Icons.send : Icons.check_circle_outline,
                        size: 16,
                      ),
                      label: Text(
                        isDispatcher
                            ? 'Dispatch / Provide Initial Assistance'
                            : 'Accept & Respond',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: isDispatcher
                            ? const Color(0xFF0284C7)
                            : const Color(0xFF10B981),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : showRespondingAction
            ? SafeArea(
                top: false,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(18, 10, 18, 12),
                  decoration: const BoxDecoration(
                    color: Color(0xFFF5F6FA),
                    border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                  ),
                  child: SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton.icon(
                      onPressed: _isProcessing
                          ? null
                          : _selectedTabIndex == 2
                          ? _handleCloseIncident
                          : _handleRequestAssistance,
                      icon: Icon(
                        _selectedTabIndex == 2
                            ? Icons.check_circle_outline
                            : Icons.sos_outlined,
                      ),
                      label: Text(
                        _selectedTabIndex == 2
                            ? 'Close Incident Report (Mark Resolved)'
                            : 'Request Assistance',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _selectedTabIndex == 2
                            ? const Color(0xFF10B981)
                            : const Color(0xFFF59E0B),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : null,
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_selectedTabIndex == 0) ...[
                if (_report.isMdrrmoResponding) ...[
                  Container(
                    margin: const EdgeInsets.only(bottom: 14),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE0F2FE),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFBAE6FD)),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.shield_outlined,
                          color: Color(0xFF38BDF8),
                          size: 22,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'The MDRRMO is currently responding to this incident${_report.mdrrmoResponderName != null ? " (${_report.mdrrmoResponderName})" : ""}.',
                            style: const TextStyle(
                              color: Color(0xFF075985),
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                // Pending Assignment Banner
                if (_report.isPending) ...[
                  if (isResponder)
                    Container(
                      margin: const EdgeInsets.only(bottom: 14),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE0F2FE),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: const Color(0xFF7DD3FC),
                          width: 1.2,
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.assignment_ind_outlined,
                            color: Color(0xFF38BDF8),
                            size: 26,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Incident Dispatched to You',
                                  style: TextStyle(
                                    color: Color(0xFF0F172A),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _report.barangayResponseNotes ??
                                      'Please review details and tap Accept & Respond below to begin initial response.',
                                  style: const TextStyle(
                                    color: Color(0xFF334155),
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (isDispatcher && _report.barangayRespondedBy != null)
                    Container(
                      margin: const EdgeInsets.only(bottom: 14),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF59E0B).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: const Color(0xFFF59E0B),
                          width: 1.2,
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.schedule,
                            color: Color(0xFFF59E0B),
                            size: 26,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Dispatched to ${_report.barangayResponderName ?? "Responder"}',
                                  style: const TextStyle(
                                    color: Color(0xFF0F172A),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                const Text(
                                  'Awaiting Responder acceptance. You may re-dispatch or escalate if necessary.',
                                  style: TextStyle(
                                    color: Color(0xFF475569),
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
                // Incident title and current status
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _report.title,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: _report.isResolved
                            ? Colors.green.withOpacity(0.2)
                            : _report.isResponding
                            ? Colors.orange.withOpacity(0.2)
                            : Colors.red.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _report.barangayResponseStatus.toUpperCase(),
                        style: TextStyle(
                          color: _report.isResolved
                              ? Colors.green
                              : _report.isResponding
                              ? Colors.orange
                              : Colors.red,
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                if (_report.incidentType != null ||
                    _report.severity != null) ...[
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(top: 8, bottom: 10),
                    padding: const EdgeInsets.all(11),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEFF6FF),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFBFDBFE)),
                    ),
                    child: Text(
                      'Dispatcher classification: ${(_report.incidentType ?? 'Unclassified').replaceAll('_', ' ')} · ${(_report.severity ?? 'Unclassified').toUpperCase()}',
                      style: const TextStyle(
                        color: Color(0xFF1E3A8A),
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
                if (incidentDetails.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      incidentDetails,
                      style: const TextStyle(
                        color: Color(0xFF334155),
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 10),

                // Reporter details can be collapsed to leave more room for the incident.
                if ((_report.reporterName ?? '').trim().isNotEmpty ||
                    (_report.specifics ?? '').trim().isNotEmpty ||
                    (_report.reporterEmail ?? '').trim().isNotEmpty ||
                    (_report.reporterPhone != null &&
                        !_report.reporterPhone!.contains('@')))
                  Card(
                    margin: EdgeInsets.zero,
                    color: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: const BorderSide(color: Color(0xFFE2E8F0)),
                    ),
                    child: ExpansionTile(
                      initiallyExpanded: true,
                      tilePadding: const EdgeInsets.symmetric(horizontal: 12),
                      childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                      iconColor: const Color(0xFF0284C7),
                      collapsedIconColor: const Color(0xFF64748B),
                      leading: const Icon(
                        Icons.person_outline,
                        color: Color(0xFF0284C7),
                      ),
                      title: const Text(
                        'Reporter Details',
                        style: TextStyle(
                          color: Color(0xFF0F172A),
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                      subtitle: (_report.reporterName ?? '').trim().isNotEmpty
                          ? Text(
                              _report.reporterName!.trim(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF475569),
                                fontSize: 13,
                              ),
                            )
                          : null,
                      children: [
                        if ((_report.specifics ?? '').trim().isNotEmpty) ...[
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF8FAFC),
                              borderRadius: BorderRadius.circular(9),
                            ),
                            child: Text(
                              _report.specifics!.trim(),
                              style: const TextStyle(
                                color: Color(0xFF334155),
                                fontSize: 14,
                              ),
                            ),
                          ),
                          if ((_report.reporterEmail ?? '').trim().isNotEmpty ||
                              (_report.reporterPhone != null &&
                                  !_report.reporterPhone!.contains('@')))
                            const SizedBox(height: 10),
                        ],
                        if (_report.reporterPhone != null &&
                            !_report.reporterPhone!.contains('@'))
                          _reportContactRow(
                            icon: Icons.phone_in_talk_outlined,
                            label: 'Reporter Phone',
                            value: PhoneNumberUtils.formatForDisplay(
                              _report.reporterPhone,
                            ),
                            actionLabel: 'Call',
                            actionIcon: Icons.call,
                            uri: Uri.parse(
                              'tel:${PhoneNumberUtils.digitsOnly(_report.reporterPhone)}',
                            ),
                          ),
                        if ((_report.reporterEmail ?? '')
                            .trim()
                            .isNotEmpty) ...[
                          if (_report.reporterPhone != null &&
                              !_report.reporterPhone!.contains('@'))
                            const SizedBox(height: 10),
                          _reportContactRow(
                            icon: Icons.email_outlined,
                            label: 'Reporter Email',
                            value: _report.reporterEmail!.trim(),
                            actionLabel: 'Email',
                            actionIcon: Icons.email_outlined,
                            uri: Uri.parse(
                              'mailto:${_report.reporterEmail!.trim()}',
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                const SizedBox(height: 16),

                // Map Pin Location
                const Text(
                  'Incident Location',
                  style: TextStyle(
                    color: Color(0xFF0F172A),
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: SizedBox(
                    height: 200,
                    child: FlutterMap(
                      mapController: _mapController,
                      options: MapOptions(
                        initialCenter: _mapCenter(incidentLocation),
                        initialZoom: _mapZoom(incidentLocation),
                      ),
                      children: [
                        TileLayer(
                          urlTemplate:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName:
                              'ph.gov.mdrrmo.norzagapay_mobile',
                        ),
                        MunicipalityBoundaryMarkerLayer(
                          markers: [
                            Marker(
                              point: incidentLocation,
                              width: 90,
                              height: 58,
                              child: const Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    'Incident',
                                    style: TextStyle(
                                      color: Colors.red,
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  Icon(
                                    Icons.location_on,
                                    color: Colors.red,
                                    size: 38,
                                  ),
                                ],
                              ),
                            ),
                            if (_currentLocation != null)
                              Marker(
                                point: _currentLocation!,
                                width: 90,
                                height: 58,
                                child: const Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      'You',
                                      style: TextStyle(
                                        color: Color(0xFF38BDF8),
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    Icon(
                                      Icons.my_location,
                                      color: Color(0xFF38BDF8),
                                      size: 32,
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                        const MunicipalityBoundaryMapLayer(
                          outsideColor: Color(0xFFF5F6FA),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Coordinates: ${_report.latitude.toStringAsFixed(5)}, ${_report.longitude.toStringAsFixed(5)}',
                  style: const TextStyle(
                    color: Color(0xFF64748B),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 8),
                if (_currentLocation != null)
                  Text(
                    'Your coordinates: ${_currentLocation!.latitude.toStringAsFixed(5)}, ${_currentLocation!.longitude.toStringAsFixed(5)}',
                    style: const TextStyle(
                      color: Color(0xFF38BDF8),
                      fontSize: 12,
                    ),
                  )
                else
                  Text(
                    _locationMessage ?? 'Getting your coordinates...',
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                    ),
                  ),
                const SizedBox(height: 16),

                // Proof attachments open directly in the full-screen viewer.
                if (_report.proofUrls.isNotEmpty ||
                    _report.proofUrl != null) ...[
                  Builder(
                    builder: (context) {
                      final proofs = _report.proofUrls.isNotEmpty
                          ? _report.proofUrls
                          : [_report.proofUrl!];

                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                'Proof of Incident',
                                style: TextStyle(
                                  color: Color(0xFF0F172A),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(
                                    0xFF0284C7,
                                  ).withOpacity(0.25),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: const Color(0xFF0284C7),
                                  ),
                                ),
                                child: Text(
                                  '${proofs.length} ${proofs.length == 1 ? 'attachment' : 'attachments'}',
                                  style: const TextStyle(
                                    color: Color(0xFF0284C7),
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Container(
                            height: 72,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: const Color(0xFFE2E8F0),
                              ),
                            ),
                            child: ListView.builder(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.all(6),
                              itemCount: proofs.length,
                              itemBuilder: (ctx, i) {
                                final thumbUrl = proofs[i];
                                final type = i < _report.proofTypes.length
                                    ? _report.proofTypes[i]
                                    : null;
                                final isThumbVideo = _isVideoProof(
                                  thumbUrl,
                                  type,
                                );
                                return GestureDetector(
                                  onTap: () => _showMediaViewer(
                                    thumbUrl,
                                    isVideo: isThumbVideo,
                                    title: 'Proof ${i + 1} of ${proofs.length}',
                                  ),
                                  child: Container(
                                    width: 60,
                                    height: 60,
                                    margin: const EdgeInsets.only(right: 6),
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(
                                        color: const Color(0xFFE2E8F0),
                                      ),
                                      color: const Color(0xFFF8FAFC),
                                    ),
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        ClipRRect(
                                          borderRadius: BorderRadius.circular(
                                            7,
                                          ),
                                          child: isThumbVideo
                                              ? const Center(
                                                  child: Icon(
                                                    Icons.videocam,
                                                    color: Color(0xFF38BDF8),
                                                    size: 28,
                                                  ),
                                                )
                                              : Image.network(
                                                  thumbUrl,
                                                  fit: BoxFit.cover,
                                                  errorBuilder: (_, _, _) =>
                                                      const Icon(
                                                        Icons.broken_image,
                                                        color: Colors.grey,
                                                        size: 24,
                                                      ),
                                                ),
                                        ),
                                        if (isThumbVideo)
                                          const Positioned(
                                            bottom: 2,
                                            right: 2,
                                            child: Icon(
                                              Icons.play_circle_fill,
                                              color: Colors.white70,
                                              size: 16,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                          const SizedBox(height: 16),
                        ],
                      );
                    },
                  ),
                ],
              ],

              if (_selectedTabIndex == 1) ...[
                // Barangay Response & Coordination History
                if (_report.barangayResponderName != null ||
                    (_report.barangayResponseNotes != null &&
                        !(_report.cleanBarangayNotes?.contains(
                              'FIELD ASSESSMENT',
                            ) ??
                            false)) ||
                    _report.mdrrmoCoordinationNotes != null ||
                    _report.resolvedNotes != null ||
                    _assistanceRequests.isNotEmpty) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Response & Coordination Log',
                          style: TextStyle(
                            color: Color(0xFF0F172A),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (_report.barangayResponderName != null) ...[
                          Text(
                            'Responder: ${_report.barangayResponderName}',
                            style: const TextStyle(
                              color: Color(0xFF0284C7),
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 8),
                        ],

                        // SOS Assistance Request (matching Image 1 inside Response & Coordination Log)
                        for (final request in _assistanceRequests) ...[
                          _buildAssistanceLogCard(
                            request,
                            isResponder,
                            isDispatcher,
                          ),
                          const SizedBox(height: 10),
                        ],

                        if (_report.barangayResponseNotes != null &&
                            !(_report.cleanBarangayNotes?.contains(
                                  'FIELD ASSESSMENT',
                                ) ??
                                false)) ...[
                          Text(
                            'Initial Assistance: ${_report.barangayResponseNotes}',
                            style: const TextStyle(
                              color: Color(0xFF475569),
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 4),
                        ],
                        if (_report.mdrrmoCoordinationNotes != null) ...[
                          Text(
                            'MDRRMO Coordination: ${_report.mdrrmoCoordinationNotes}',
                            style: const TextStyle(
                              color: Color(0xFF0284C7),
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 4),
                        ],
                        if (_report.resolvedNotes != null)
                          Text(
                            'Resolution Notes: ${_report.resolvedNotes}',
                            style: const TextStyle(
                              color: Color(0xFF10B981),
                              fontSize: 13,
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
              ],

              if (_selectedTabIndex == 2) ...[
                if (fieldAssessment != null) ...[
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.zero,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 38,
                                height: 38,
                                decoration: BoxDecoration(
                                  color: const Color(
                                    0xFF0284C7,
                                  ).withOpacity(0.2),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: const Icon(
                                  Icons.fact_check_outlined,
                                  color: Color(0xFF38BDF8),
                                  size: 21,
                                ),
                              ),
                              const SizedBox(width: 11),
                              const Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Latest Field Assessment',
                                      style: TextStyle(
                                        color: Color(0xFF0F172A),
                                        fontWeight: FontWeight.bold,
                                        fontSize: 15,
                                      ),
                                    ),
                                    SizedBox(height: 2),
                                    Text(
                                      'On-scene report',
                                      style: TextStyle(
                                        color: Color(0xFF64748B),
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          ...fieldAssessment
                              .split('\n')
                              .where(
                                (line) =>
                                    line.trim().isNotEmpty &&
                                    line.trim() != 'FIELD ASSESSMENT',
                              )
                              .map((line) {
                                final separator = line.indexOf(':');
                                final label = separator > 0
                                    ? line.substring(0, separator).trim()
                                    : 'Assessment';
                                final value = separator > 0
                                    ? line.substring(separator + 1).trim()
                                    : line.trim();
                                return Container(
                                  width: double.infinity,
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 11,
                                    vertical: 10,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF8FAFC),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                      color: const Color(0xFFE2E8F0),
                                    ),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        label,
                                        style: const TextStyle(
                                          color: Color(0xFF0369A1),
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        value,
                                        style: const TextStyle(
                                          color: Color(0xFF1E293B),
                                          fontSize: 14,
                                          height: 1.35,
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              }),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (isResponder &&
                    _report.isResponding &&
                    !_report.isResolved) ...[
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: OutlinedButton.icon(
                      onPressed: _isProcessing ? null : _handleRecordAssessment,
                      icon: const Icon(Icons.fact_check_outlined),
                      label: Text(
                        _report.cleanBarangayNotes?.contains(
                                  'FIELD ASSESSMENT',
                                ) ==
                                true
                            ? 'Update Field Assessment'
                            : 'Record Field Assessment',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF38BDF8),
                        side: const BorderSide(color: Color(0xFF0284C7)),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                // Responder Images / Field Media – persistent in DB + local session
                if (_report.responderMedia.isNotEmpty ||
                    _teamLeaderMedia.isNotEmpty ||
                    (isResponder && !_report.isResolved)) ...[
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Responder Field Photos & Media',
                        style: TextStyle(
                          color: Color(0xFF0F172A),
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                      ),
                      Text(
                        '${_report.responderMedia.length + _teamLeaderMedia.length} item(s)',
                        style: const TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Container(
                    height: 110,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child:
                        _report.responderMedia.isEmpty &&
                            _teamLeaderMedia.isEmpty
                        ? const Center(
                            child: Text(
                              'No field documentation yet. Add scene photos or video after assessing the incident.',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Color(0xFF64748B),
                                fontSize: 12,
                              ),
                            ),
                          )
                        : ListView(
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.all(8),
                            children: [
                              // Saved responder media from database
                              ..._report.responderMedia.map((item) {
                                final url = item['url']?.toString() ?? '';
                                final isVideo =
                                    item['type'] == 'video' ||
                                    url.toLowerCase().contains('.mp4') ||
                                    url.toLowerCase().contains('.mov');
                                final uploader =
                                    item['uploader_name']?.toString() ??
                                    'Responder';
                                return GestureDetector(
                                  onTap: () => _showMediaViewer(
                                    url,
                                    isVideo: isVideo,
                                    title: 'Field Media - $uploader',
                                  ),
                                  child: Container(
                                    width: 90,
                                    margin: const EdgeInsets.only(right: 8),
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(
                                        color: const Color(
                                          0xFF38BDF8,
                                        ).withOpacity(0.5),
                                      ),
                                      color: const Color(0xFFF8FAFC),
                                    ),
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        ClipRRect(
                                          borderRadius: BorderRadius.circular(
                                            7,
                                          ),
                                          child: isVideo
                                              ? const Center(
                                                  child: Icon(
                                                    Icons.videocam,
                                                    color: Color(0xFF38BDF8),
                                                    size: 32,
                                                  ),
                                                )
                                              : Image.network(
                                                  url,
                                                  fit: BoxFit.cover,
                                                  errorBuilder: (_, __, ___) =>
                                                      const Icon(
                                                        Icons.broken_image,
                                                        color: Colors.grey,
                                                        size: 24,
                                                      ),
                                                ),
                                        ),
                                        if (isVideo)
                                          const Positioned(
                                            bottom: 18,
                                            right: 4,
                                            child: Icon(
                                              Icons.play_circle_fill,
                                              color: Colors.white70,
                                              size: 18,
                                            ),
                                          ),
                                        Positioned(
                                          bottom: 0,
                                          left: 0,
                                          right: 0,
                                          child: Container(
                                            color: Colors.black87,
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 4,
                                              vertical: 2,
                                            ),
                                            child: Text(
                                              uploader,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 9,
                                              ),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              }),
                              // Local items if any
                              ..._teamLeaderMedia.map((file) {
                                final isVideo =
                                    file.name.endsWith('.mp4') ||
                                    file.name.endsWith('.mov') ||
                                    file.name.endsWith('.avi');
                                return Container(
                                  width: 90,
                                  margin: const EdgeInsets.only(right: 8),
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                      color: const Color(0xFF10B981),
                                    ),
                                    color: const Color(0xFFF8FAFC),
                                  ),
                                  child: Stack(
                                    fit: StackFit.expand,
                                    children: [
                                      ClipRRect(
                                        borderRadius: BorderRadius.circular(7),
                                        child: isVideo
                                            ? const Center(
                                                child: Icon(
                                                  Icons.videocam,
                                                  color: Color(0xFF10B981),
                                                  size: 32,
                                                ),
                                              )
                                            : Image.file(
                                                File(file.path),
                                                fit: BoxFit.cover,
                                                errorBuilder: (_, __, ___) =>
                                                    const Icon(
                                                      Icons.broken_image,
                                                      color: Colors.grey,
                                                      size: 24,
                                                    ),
                                              ),
                                      ),
                                      Positioned(
                                        bottom: 0,
                                        left: 0,
                                        right: 0,
                                        child: Container(
                                          color: const Color(0xFF10B981),
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 4,
                                            vertical: 2,
                                          ),
                                          child: const Text(
                                            'Recent Upload',
                                            maxLines: 1,
                                            textAlign: TextAlign.center,
                                            style: TextStyle(
                                              color: Colors.white,
                                              fontSize: 9,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              }),
                            ],
                          ),
                  ),
                  const SizedBox(height: 12),
                ],

                // Attach Field Photo / Video button – responder only
                if (isResponder && !_report.isResolved) ...[
                  const SizedBox(height: 4),
                  SizedBox(
                    width: double.infinity,
                    height: 46,
                    child: OutlinedButton.icon(
                      onPressed: _isUploadingMedia
                          ? null
                          : _showFieldMediaOptions,
                      icon: _isUploadingMedia
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Color(0xFF38BDF8),
                              ),
                            )
                          : const Icon(Icons.add_a_photo_outlined, size: 18),
                      label: Text(
                        _isUploadingMedia
                            ? 'Uploading Field Media...'
                            : 'Attach Field Photo / Video',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF38BDF8),
                        side: const BorderSide(color: Color(0xFF0284C7)),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                  ),
                ],

                const SizedBox(height: 20),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAssistanceLogCard(
    Map<String, dynamic> req,
    bool isResponder,
    bool isDispatcher,
  ) {
    final requestId = req['id']?.toString() ?? '';
    final isExpanded = _expandedAssistanceRequests.contains(requestId);
    final status = req['status'] as String? ?? 'pending';
    final decision = req['decision'] as String?;
    final teamAcknowledged = req['team_acknowledged'] == true;
    final hasDispatcherResponded = status == 'actioned' || decision != null;

    Widget headerBadge;
    if (isDispatcher) {
      if (status == 'cancelled') {
        headerBadge = _statusBadge('Cancelled', const Color(0xFF64748B));
      } else if (hasDispatcherResponded) {
        headerBadge = _statusBadge('Provided', const Color(0xFF10B981));
      } else {
        headerBadge = _statusBadge('Pending', const Color(0xFFF59E0B));
      }
    } else {
      if (status == 'cancelled') {
        headerBadge = _statusBadge('Cancelled', const Color(0xFF64748B));
      } else if (teamAcknowledged) {
        headerBadge = _statusBadge('Received', const Color(0xFF10B981));
      } else {
        headerBadge = _statusBadge('Pending', const Color(0xFFF59E0B));
      }
    }

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Banner Header row
          InkWell(
            onTap: () => setState(() {
              if (isExpanded) {
                _expandedAssistanceRequests.remove(requestId);
              } else {
                _expandedAssistanceRequests.add(requestId);
              }
            }),
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  const Text(
                    'SOS',
                    style: TextStyle(
                      color: Color(0xFFF59E0B),
                      fontWeight: FontWeight.w900,
                      fontSize: 13,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Text(
                    'Assistance Request',
                    style: TextStyle(
                      color: Color(0xFF0F172A),
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  headerBadge,
                  const Spacer(),
                  Icon(
                    isExpanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    color: const Color(0xFF64748B),
                    size: 20,
                  ),
                ],
              ),
            ),
          ),

          // Detail section
          if (isExpanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Divider(color: Color(0xFFE2E8F0), height: 1),
                  const SizedBox(height: 10),

                  // Requester line (matching image 1: "From: You (Responder)")
                  Text(
                    isResponder
                        ? 'From: You (Responder)'
                        : 'From: ${req['requested_by_user']?['full_name'] ?? 'Responder 1'}',
                    style: const TextStyle(
                      color: Color(0xFF1B4F72),
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Need tags
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (req['needs_more_manpower'] == true)
                        _assistanceTag(
                          Icons.people,
                          'Manpower',
                          const Color(0xFF0284C7),
                        ),
                      if (req['needs_resources'] == true)
                        _assistanceTag(
                          Icons.inventory_2,
                          'Resources',
                          const Color(0xFF7C3AED),
                        ),
                      if (req['needs_equipment'] == true)
                        _assistanceTag(
                          Icons.construction,
                          'Equipment',
                          const Color(0xFF059669),
                        ),
                      if (req['beyond_barangay_capability'] == true)
                        _assistanceTag(
                          Icons.escalator_warning,
                          'Needs MDRRMO',
                          const Color(0xFFEF4444),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),

                  // Explanation text
                  if (req['explanation'] != null &&
                      (req['explanation'] as String).isNotEmpty)
                    Text(
                      req['explanation'],
                      style: const TextStyle(
                        color: Color(0xFF475569),
                        fontSize: 13,
                      ),
                    ),

                  // Dispatcher's Response Block
                  if (hasDispatcherResponded) ...[
                    const SizedBox(height: 12),
                    const Divider(color: Color(0xFFE2E8F0), height: 1),
                    const SizedBox(height: 10),
                    Text(
                      isDispatcher
                          ? 'From: You (Dispatcher)'
                          : 'From: ${req['decided_by_user']?['full_name'] ?? 'Barangay Dispatcher'}',
                      style: const TextStyle(
                        color: Color(0xFF1B4F72),
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (decision == 'provide_barangay_assistance')
                      _decisionBadge(
                        'Provided Assistance',
                        const Color(0xFF10B981),
                      )
                    else if (decision == 'coordinate_mdrrmo')
                      _decisionBadge(
                        'MDRRMO Coordination',
                        const Color(0xFFEF4444),
                      ),
                    if (req['dispatcher_notes'] != null &&
                        (req['dispatcher_notes'] as String).isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        req['dispatcher_notes'],
                        style: const TextStyle(
                          color: Color(0xFF475569),
                          fontSize: 13,
                        ),
                      ),
                    ],

                    // Responder Acknowledge Received button
                    if (isResponder && !teamAcknowledged) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        height: 38,
                        child: ElevatedButton.icon(
                          onPressed: () async {
                            final auth = Provider.of<AuthService>(
                              context,
                              listen: false,
                            );
                            if (auth.token == null) return;
                            try {
                              await ApiService.teamLeaderRequestAction(
                                auth.token!,
                                req['id'],
                                action: 'acknowledge',
                              );
                              await _fetchAssistanceRequest();
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                      'Assistance marked as received!',
                                    ),
                                    backgroundColor: Color(0xFF10B981),
                                  ),
                                );
                              }
                            } catch (e) {
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('Error: $e'),
                                    backgroundColor: Colors.red,
                                  ),
                                );
                              }
                            }
                          },
                          icon: const Icon(
                            Icons.check_circle_outline,
                            size: 16,
                          ),
                          label: const Text(
                            'Mark Received',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF10B981),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _statusBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.6)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _decisionBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.18),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _assistanceTag(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 11),
          const SizedBox(width: 3),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  void _showFieldMediaOptions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E293B),
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
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Capture or Upload Field Media',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 10),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF0284C7),
                  child: Icon(Icons.camera_alt, color: Colors.white, size: 20),
                ),
                title: const Text(
                  'Take Photo (Camera)',
                  style: TextStyle(color: Colors.white),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndAttachMedia(ImageSource.camera);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFEF4444),
                  child: Icon(Icons.videocam, color: Colors.white, size: 20),
                ),
                title: const Text(
                  'Record Video (Camera)',
                  style: TextStyle(color: Colors.white),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndAttachMedia(ImageSource.camera, isVideo: true);
                },
              ),
              const Divider(color: Color(0xFF334155), height: 16),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF10B981),
                  child: Icon(
                    Icons.photo_library,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
                title: const Text(
                  'Upload Photo from Gallery',
                  style: TextStyle(color: Colors.white),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndAttachMedia(ImageSource.gallery);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF8B5CF6),
                  child: Icon(
                    Icons.video_library,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
                title: const Text(
                  'Upload Video from Gallery',
                  style: TextStyle(color: Colors.white),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndAttachMedia(ImageSource.gallery, isVideo: true);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _pickAndAttachMedia(
    ImageSource source, {
    bool isVideo = false,
  }) async {
    final picker = ImagePicker();
    XFile? file;
    try {
      if (isVideo) {
        file = await picker.pickVideo(source: source);
      } else {
        file = await picker.pickImage(source: source, imageQuality: 85);
      }
      if (file == null || !mounted) return;

      final auth = Provider.of<AuthService>(context, listen: false);
      final token = auth.token;
      if (token == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Authentication required. Please login again.'),
            backgroundColor: Colors.red,
          ),
        );
        return;
      }

      setState(() => _isUploadingMedia = true);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                'Uploading field ${isVideo ? "video" : "photo"} to database...',
              ),
            ],
          ),
          duration: const Duration(seconds: 4),
          backgroundColor: const Color(0xFF0284C7),
        ),
      );

      final updated = await ApiService.uploadFieldMedia(
        token,
        _report.id,
        file,
        isVideo: isVideo,
      );

      if (mounted) {
        setState(() {
          _report = updated;
          _isUploadingMedia = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Field ${isVideo ? "video" : "photo"} uploaded and saved successfully!',
            ),
            backgroundColor: const Color(0xFF10B981),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isUploadingMedia = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Upload failed: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  bool _isVideoProof(String url, [String? type]) {
    if (type?.toLowerCase() == 'video') return true;
    final path = url.toLowerCase().split('?').first;
    return const [
      '.mp4',
      '.mov',
      '.webm',
      '.3gp',
      '.mkv',
      '.avi',
    ].any(path.endsWith);
  }

  void _showMediaViewer(String url, {bool isVideo = false, String? title}) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (viewerContext) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: const Color(0xFF0F172A),
            foregroundColor: Colors.white,
            surfaceTintColor: Colors.transparent,
            title: Text(
              title ?? (isVideo ? 'Field Video' : 'Field Photo'),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          body: Center(
            child: isVideo
                ? VideoProofPlayer(
                    url: url,
                    proofType: 'video',
                    height: MediaQuery.sizeOf(viewerContext).height,
                  )
                : InteractiveViewer(
                    child: Image.network(
                      url,
                      width: double.infinity,
                      height: double.infinity,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const Icon(
                        Icons.broken_image,
                        color: Colors.white70,
                        size: 64,
                      ),
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

class _IncidentResponseGradient extends StatelessWidget {
  const _IncidentResponseGradient();

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
  );
}
