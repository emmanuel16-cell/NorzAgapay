import 'package:flutter/material.dart';
import 'dart:async';
import 'package:provider/provider.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:location/location.dart';
import 'package:image_picker/image_picker.dart';
import '../../widgets/municipality_boundary_map_layer.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/task.dart';
import '../models/user.dart';
import '../providers/auth_provider.dart';
import '../providers/task_provider.dart';
import '../core/constants.dart';

class TaskDetailScreen extends StatefulWidget {
  final Task task;
  const TaskDetailScreen({super.key, required this.task});

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  bool _isUpdating = false;
  List<Map<String, dynamic>> _availableOfficers = [];
  bool _loadingOfficers = false;
  final Location _locationService = Location();
  StreamSubscription<LocationData>? _arrivalLocationSubscription;
  LocationData? _lastArrivalLocation;
  DateTime? _arrivalCandidateSince;
  bool _startingArrivalTracking = false;

  @override
  void dispose() {
    _arrivalLocationSubscription?.cancel();
    super.dispose();
  }

  Future<void> _updateStatus(
    TaskStatus status, {
    String? proofUrl,
    String? arrivalMethod,
    LocationData? arrivalLocation,
  }) async {
    setState(() => _isUpdating = true);
    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      await Provider.of<TaskProvider>(
        context,
        listen: false,
      ).updateTaskStatus(
        widget.task.id,
        status.name,
        auth.token!,
        proofUrl: proofUrl,
        arrivalMethod: status == TaskStatus.in_progress ? (arrivalMethod ?? 'manual') : null,
        latitude: arrivalLocation?.latitude,
        longitude: arrivalLocation?.longitude,
        accuracyM: arrivalLocation?.accuracy,
        fixAt: (status == TaskStatus.in_progress || status == TaskStatus.accepted) && arrivalMethod == 'gps'
            ? _locationFixTime(arrivalLocation!)
            : null,
      );
      if (status == TaskStatus.in_progress) _stopArrivalTracking();
      if (mounted &&
          (status == TaskStatus.completed || status == TaskStatus.cancelled)) {
        Navigator.pop(context);
      }
    } catch (e) {
      if (status == TaskStatus.in_progress && arrivalMethod == 'gps') {
        _arrivalCandidateSince = null;
      }
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString()),
            backgroundColor: const Color(AppColors.danger),
          ),
        );
    } finally {
      if (mounted) setState(() => _isUpdating = false);
    }
  }

  Future<void> _resolveAndReturn(Task task) async {
    if (_isUpdating) return;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: Colors.white,
      builder: (sheetContext) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined),
              title: const Text('Take a response proof photo'),
              onTap: () => Navigator.pop(sheetContext, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose a response proof photo'),
              onTap: () => Navigator.pop(sheetContext, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    setState(() => _isUpdating = true);
    try {
      final file = await ImagePicker().pickImage(source: source, imageQuality: 85);
      if (file == null || !mounted) return;

      final auth = Provider.of<AuthProvider>(context, listen: false);
      final proofUrl = await auth.uploadFile(
        file: file,
        category: 'proof_photo',
        token: auth.token!,
        taskId: task.id,
      );
      if (proofUrl == null) throw Exception('The proof photo could not be confirmed.');

      await Provider.of<TaskProvider>(context, listen: false).updateTaskStatus(
        task.id,
        TaskStatus.returning.name,
        auth.token!,
        proofUrl: proofUrl,
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString()),
            backgroundColor: const Color(AppColors.danger),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isUpdating = false);
    }
  }

  void _syncArrivalTracking(Task task, bool isResponder) {
    if (isResponder && task.status == TaskStatus.accepted &&
        task.latitude != null && task.longitude != null) {
      unawaited(_startArrivalTracking());
    } else if (_arrivalLocationSubscription != null) {
      _stopArrivalTracking();
    }
  }

  Future<void> _startArrivalTracking() async {
    if (_arrivalLocationSubscription != null || _startingArrivalTracking) return;
    _startingArrivalTracking = true;
    try {
      var serviceEnabled = await _locationService.serviceEnabled();
      if (!serviceEnabled) serviceEnabled = await _locationService.requestService();
      if (!serviceEnabled) return;

      var permission = await _locationService.hasPermission();
      if (permission == PermissionStatus.denied) {
        permission = await _locationService.requestPermission();
      }
      if (permission != PermissionStatus.granted &&
          permission != PermissionStatus.grantedLimited) return;
      if (!mounted) return;
      final currentTask = Provider.of<TaskProvider>(context, listen: false).tasks.firstWhere(
        (item) => item.id == widget.task.id,
        orElse: () => widget.task,
      );
      if (currentTask.status != TaskStatus.accepted) return;

      await _locationService.changeSettings(
        accuracy: LocationAccuracy.high,
        interval: 5000,
        distanceFilter: 5,
      );
      _arrivalLocationSubscription = _locationService.onLocationChanged.listen(
        (location) => unawaited(_handleTaskArrivalLocation(location)),
      );
    } catch (error) {
      debugPrint('Task arrival tracking error: $error');
    } finally {
      _startingArrivalTracking = false;
    }
  }

  Future<void> _handleTaskArrivalLocation(LocationData location) async {
    if (!mounted || _isUpdating || location.latitude == null || location.longitude == null) return;
    _lastArrivalLocation = location;
    final task = Provider.of<TaskProvider>(context, listen: false).tasks.firstWhere(
      (item) => item.id == widget.task.id,
      orElse: () => widget.task,
    );
    final incidentLatitude = task.latitude;
    final incidentLongitude = task.longitude;
    final accuracy = location.accuracy;
    if (incidentLatitude == null || incidentLongitude == null ||
        accuracy == null || accuracy < 0 || accuracy > 50) {
      _arrivalCandidateSince = null;
      return;
    }

    final distanceM = const Distance().as(
      LengthUnit.Meter,
      LatLng(location.latitude!, location.longitude!),
      LatLng(incidentLatitude, incidentLongitude),
    );
    if (distanceM + accuracy > 100) {
      _arrivalCandidateSince = null;
      return;
    }

    final now = DateTime.now().toUtc();
    _arrivalCandidateSince ??= now;
    if (now.difference(_arrivalCandidateSince!).inSeconds < 15) return;
    await _updateStatus(
      TaskStatus.in_progress,
      arrivalMethod: 'gps',
      arrivalLocation: location,
    );
  }

  DateTime _locationFixTime(LocationData location) {
    final timestamp = location.time;
    if (timestamp == null || timestamp <= 0) return DateTime.now().toUtc();
    return DateTime.fromMillisecondsSinceEpoch(timestamp.round(), isUtc: true);
  }

  Future<LocationData?> _getAcceptanceLocation() async {
    try {
      if (!await _locationService.serviceEnabled()) return null;
      var permission = await _locationService.hasPermission();
      if (permission == PermissionStatus.denied) {
        permission = await _locationService.requestPermission();
      }
      if (permission != PermissionStatus.granted &&
          permission != PermissionStatus.grantedLimited) return null;
      return await _locationService.getLocation();
    } catch (error) {
      debugPrint('Task acceptance location capture error: $error');
      return null;
    }
  }

  String _formatDistance(double distanceM) => distanceM >= 1000
      ? '${(distanceM / 1000).toStringAsFixed(distanceM >= 10000 ? 1 : 2)} km'
      : '${distanceM.round()} m';

  void _stopArrivalTracking() {
    _arrivalLocationSubscription?.cancel();
    _arrivalLocationSubscription = null;
    _arrivalCandidateSince = null;
  }

  Future<void> _fetchOfficers() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    setState(() => _loadingOfficers = true);
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/officers'),
        headers: {
          'Authorization': 'Bearer ${auth.token}',
          'ngrok-skip-browser-warning': 'true',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          _availableOfficers = (data['officers'] as List? ?? [])
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        });
      }
    } catch (e) {
      debugPrint('Fetch officers error: $e');
    } finally {
      setState(() => _loadingOfficers = false);
    }
  }

  Future<void> _addMembersToDispatch(List<String> officerIds) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final taskId = widget.task.id;
    final unitId = auth.myUnit?['id'];

    try {
      // Try task-specific endpoint first
      http.Response? response;
      try {
        response = await http.post(
          Uri.parse('${AppConstants.apiBaseUrl}/tasks/$taskId/members'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${auth.token}',
            'ngrok-skip-browser-warning': 'true',
          },
          body: json.encode({'officer_ids': officerIds}),
        );
      } catch (_) {}

      // Fallback: add to respond unit
      if (response == null ||
          (response.statusCode != 200 && response.statusCode != 201)) {
        if (unitId != null) {
          await http.post(
            Uri.parse(
              '${AppConstants.apiBaseUrl}/respond-units/$unitId/members',
            ),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ${auth.token}',
              'ngrok-skip-browser-warning': 'true',
            },
            body: json.encode({'officer_ids': officerIds}),
          );
        }
      }

      await auth.fetchMyUnit();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Row(
              children: [
                Icon(Icons.check_circle_rounded, color: Colors.white),
                SizedBox(width: 8),
                Text('Members added to dispatch!'),
              ],
            ),
            backgroundColor: Color(AppColors.success),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: const Color(AppColors.danger),
          ),
        );
      }
    }
  }

  void _showAddMembersModal() {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final currentMemberIds = auth.unitMembers
        .map((m) => m['id'].toString())
        .toList();
    final selected = <String>{};

    _fetchOfficers();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            final available = _availableOfficers
                .where((o) => !currentMemberIds.contains(o['id'].toString()))
                .toList();
            return DraggableScrollableSheet(
              expand: false,
              initialChildSize: 0.65,
              maxChildSize: 0.92,
              minChildSize: 0.4,
              builder: (_, controller) => Column(
                children: [
                  Container(
                    margin: const EdgeInsets.symmetric(vertical: 12),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Color(0xFFE2E8F0),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: const Color(
                              AppColors.success,
                            ).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(
                            Icons.group_add_rounded,
                            color: Color(AppColors.success),
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Add Members on the Move',
                                style: TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              Text(
                                'Select officers to add to this dispatch',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ),
                        ),
                        TextButton(
                          onPressed: selected.isEmpty
                              ? null
                              : () async {
                                  Navigator.pop(ctx);
                                  await _addMembersToDispatch(
                                    selected.toList(),
                                  );
                                },
                          child: Text(
                            'Add (${selected.length})',
                            style: TextStyle(
                              color: selected.isEmpty
                                  ? Colors.grey
                                  : const Color(AppColors.success),
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(color: Color(0xFFE2E8F0), height: 1),
                  const SizedBox(height: 8),
                  Expanded(
                    child: _loadingOfficers
                        ? const Center(child: CircularProgressIndicator())
                        : available.isEmpty
                        ? const Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.people_outline,
                                  size: 48,
                                  color: Colors.grey,
                                ),
                                SizedBox(height: 12),
                                Text(
                                  'No other officers available',
                                  style: TextStyle(color: Colors.grey),
                                ),
                              ],
                            ),
                          )
                        : ListView.builder(
                            controller: controller,
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            itemCount: available.length,
                            itemBuilder: (_, i) {
                              final officer = available[i];
                              final id = officer['id'].toString();
                              final isSelected = selected.contains(id);
                              return Container(
                                margin: const EdgeInsets.only(bottom: 8),
                                decoration: BoxDecoration(
                                  color: isSelected
                                      ? const Color(
                                          AppColors.success,
                                        ).withOpacity(0.1)
                                      : const Color(
                                          0xFFF5F6FA,
                                        ).withOpacity(0.5),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: isSelected
                                        ? const Color(
                                            AppColors.success,
                                          ).withOpacity(0.5)
                                        : Color(0xFFE2E8F0),
                                  ),
                                ),
                                child: ListTile(
                                  contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 4,
                                  ),
                                  leading: CircleAvatar(
                                    backgroundColor: isSelected
                                        ? const Color(AppColors.success)
                                        : const Color(
                                            AppColors.primary,
                                          ).withOpacity(0.3),
                                    child: isSelected
                                        ? const Icon(
                                            Icons.check,
                                            color: Colors.white,
                                            size: 18,
                                          )
                                        : Text(
                                            (officer['name'] as String? ??
                                                    'O')[0]
                                                .toUpperCase(),
                                            style: const TextStyle(
                                              fontWeight: FontWeight.bold,
                                              color: Colors.white,
                                            ),
                                          ),
                                  ),
                                  title: Text(
                                    officer['name'] ?? 'Officer',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                      fontSize: 14,
                                    ),
                                  ),
                                  subtitle:
                                      (officer['specialization'] as String? ??
                                              '')
                                          .trim()
                                          .isNotEmpty
                                      ? Padding(
                                          padding: const EdgeInsets.only(
                                            top: 4,
                                          ),
                                          child: Wrap(
                                            spacing: 4,
                                            runSpacing: 4,
                                            children:
                                                (officer['specialization']
                                                        as String)
                                                    .split(',')
                                                    .map((s) => s.trim())
                                                    .where((s) => s.isNotEmpty)
                                                    .map(
                                                      (s) => Container(
                                                        padding:
                                                            const EdgeInsets.symmetric(
                                                              horizontal: 6,
                                                              vertical: 2,
                                                            ),
                                                        decoration: BoxDecoration(
                                                          color:
                                                              const Color(
                                                                0xFF0D9488,
                                                              ).withValues(
                                                                alpha: 0.12,
                                                              ),
                                                          borderRadius:
                                                              BorderRadius.circular(
                                                                4,
                                                              ),
                                                          border: Border.all(
                                                            color:
                                                                const Color(
                                                                  0xFF0D9488,
                                                                ).withValues(
                                                                  alpha: 0.25,
                                                                ),
                                                          ),
                                                        ),
                                                        child: Text(
                                                          s,
                                                          style:
                                                              const TextStyle(
                                                                fontSize: 10,
                                                                color: Color(
                                                                  0xFF0D9488,
                                                                ),
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w600,
                                                              ),
                                                        ),
                                                      ),
                                                    )
                                                    .toList(),
                                          ),
                                        )
                                      : null,
                                  trailing: Icon(
                                    isSelected
                                        ? Icons.remove_circle_outline
                                        : Icons.add_circle_outline,
                                    color: isSelected
                                        ? const Color(AppColors.danger)
                                        : const Color(0xFF0D9488),
                                  ),
                                  onTap: () {
                                    setModalState(() {
                                      if (isSelected)
                                        selected.remove(id);
                                      else
                                        selected.add(id);
                                    });
                                  },
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<TaskProvider>(
      builder: (context, taskProvider, child) {
        final task = taskProvider.tasks.firstWhere(
          (t) => t.id == widget.task.id,
          orElse: () => widget.task,
        );
        final lat = task.latitude ?? AppConstants.defaultLat;
        final lng = task.longitude ?? AppConstants.defaultLng;
        final auth = Provider.of<AuthProvider>(context, listen: false);
        final isTeamLeader = auth.isTeamLeader;
        final user = auth.user;
        final isResponder = user?.role == UserRole.responder;
        _syncArrivalTracking(task, isResponder);

        return Scaffold(
          backgroundColor: const Color(0xFFF5F6FA),
          appBar: AppBar(
            title: const Text('Dispatch Details'),
            elevation: 0,
            backgroundColor: Colors.white,
            foregroundColor: const Color(0xFF0C243B),
            actions: [
              // Team Leader: Add Members on the Move button
              if (isResponder &&
                  isTeamLeader &&
                  (task.status == TaskStatus.pending ||
                      task.status == TaskStatus.accepted ||
                      task.status == TaskStatus.in_progress))
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ElevatedButton.icon(
                    onPressed: _showAddMembersModal,
                    icon: const Icon(Icons.group_add_rounded, size: 16),
                    label: const Text(
                      'Add Members',
                      style: TextStyle(fontSize: 12),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(AppColors.success),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          body: Column(
            children: [
              // Map
              Stack(
                children: [
                  SizedBox(
                    height: 240,
                    child: FlutterMap(
                      options: MapOptions(
                        initialCenter: LatLng(lat, lng),
                        initialZoom: 15.5,
                      ),
                      children: [
                        TileLayer(
                          urlTemplate:
                              'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
                          userAgentPackageName: 'com.norzagapay.app',
                        ),
                        MunicipalityBoundaryMarkerLayer(
                          markers: [
                            Marker(
                              point: LatLng(lat, lng),
                              width: 60,
                              height: 60,
                              child: Column(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(8),
                                    decoration: BoxDecoration(
                                      color: const Color(AppColors.danger),
                                      shape: BoxShape.circle,
                                      boxShadow: [
                                        BoxShadow(
                                          color: const Color(
                                            AppColors.danger,
                                          ).withOpacity(0.5),
                                          blurRadius: 12,
                                        ),
                                      ],
                                    ),
                                    child: const Icon(
                                      Icons.warning_rounded,
                                      color: Colors.white,
                                      size: 20,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const MunicipalityBoundaryMapLayer(
                          outsideColor: Colors.white,
                        ),
                      ],
                    ),
                  ),
                  // Coordinates overlay
                  Positioned(
                    bottom: 10,
                    right: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.7),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: Color(0xFFE2E8F0)),
                      ),
                      child: Text(
                        '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
                        style: const TextStyle(
                          color: Color(0xFF475569),
                          fontSize: 10,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                  ),
                ],
              ),

              // Details
              Expanded(
                child: Container(
                  decoration: const BoxDecoration(
                    color: Color(0xFFF5F6FA),
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(24),
                    ),
                  ),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Status badge + title
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _buildStatusBadge(task),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    task.title,
                                    style: const TextStyle(
                                      fontSize: 20,
                                      fontWeight: FontWeight.bold,
                                      letterSpacing: -0.3,
                                    ),
                                  ),
                                  if (task.incidentTitle != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Text(
                                        task.incidentTitle!,
                                        style: const TextStyle(
                                          color: Colors.grey,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),

                        // Dispatcher classification from the incident record.
                        if (task.incidentType != null ||
                            task.incidentSeverity != null) ...[
                          const SizedBox(height: 14),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 11,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFF0D9488).withOpacity(0.12),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: const Color(
                                  0xFF0D9488,
                                ).withOpacity(0.35),
                              ),
                            ),
                            child: Text(
                              'Dispatcher classification: ${(task.incidentType ?? 'Unclassified').replaceAll('_', ' ')} · ${(task.incidentSeverity ?? 'Unclassified').toUpperCase()}',
                              style: const TextStyle(
                                color: Color(0xFF0D9488),
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],

                        if (task.travelDistanceM != null) ...[
                          const SizedBox(height: 14),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                            decoration: BoxDecoration(
                              color: const Color(0xFF0284C7).withOpacity(0.08),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: const Color(0xFF0284C7).withOpacity(0.2)),
                            ),
                            child: Text(
                              'Distance from responder GPS at acceptance: ${_formatDistance(task.travelDistanceM!)}${task.travelDistanceAccuracyM == null ? '' : ' · accuracy ±${task.travelDistanceAccuracyM!.round()} m'}',
                              style: const TextStyle(color: Color(0xFF0369A1), fontSize: 12, fontWeight: FontWeight.w600),
                            ),
                          ),
                        ],

                        // Team Leader banner
                        if (isResponder && isTeamLeader) ...[
                          const SizedBox(height: 16),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 10,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(
                                AppColors.success,
                              ).withOpacity(0.1),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: const Color(
                                  AppColors.success,
                                ).withOpacity(0.3),
                              ),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.star_rounded,
                                  color: Color(AppColors.success),
                                  size: 18,
                                ),
                                const SizedBox(width: 8),
                                const Expanded(
                                  child: Text(
                                    'You are the Team Leader — you can add members on the move.',
                                    style: TextStyle(
                                      color: Color(AppColors.success),
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                                TextButton(
                                  onPressed: _showAddMembersModal,
                                  style: TextButton.styleFrom(
                                    foregroundColor: const Color(
                                      AppColors.success,
                                    ),
                                    padding: EdgeInsets.zero,
                                  ),
                                  child: const Text(
                                    'Add Members',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],

                        const SizedBox(height: 24),
                        _buildSectionTitle('INCIDENT RESPONSE DETAILS'),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Color(0xFFE2E8F0)),
                          ),
                          child: Text(
                            task.description ??
                                'A resident has reported an incident. Please proceed to the coordinates for verification and response.',
                            style: const TextStyle(
                              color: Color(0xFF475569),
                              height: 1.6,
                              fontSize: 14,
                            ),
                          ),
                        ),

                        if (task.address != null) ...[
                          const SizedBox(height: 20),
                          _buildSectionTitle('LOCATION'),
                          const SizedBox(height: 10),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Color(0xFFE2E8F0)),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.location_on_rounded,
                                  color: Color(AppColors.danger),
                                  size: 20,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    task.address!,
                                    style: const TextStyle(
                                      color: Color(0xFF475569),
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],

                        // Current team (if team leader)
                        if (isResponder && isTeamLeader) ...[
                          const SizedBox(height: 20),
                          _buildSectionTitle('DISPATCH TEAM'),
                          const SizedBox(height: 10),
                          Consumer<AuthProvider>(
                            builder: (_, auth, __) {
                              final members = auth.unitMembers;
                              if (members.isEmpty) {
                                return Container(
                                  padding: const EdgeInsets.all(16),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Row(
                                    children: [
                                      Icon(
                                        Icons.people_outline,
                                        color: Colors.grey,
                                      ),
                                      SizedBox(width: 10),
                                      Text(
                                        'No team members added yet',
                                        style: TextStyle(color: Colors.grey),
                                      ),
                                    ],
                                  ),
                                );
                              }
                              return Column(
                                children: members
                                    .map(
                                      (m) => Container(
                                        margin: const EdgeInsets.only(
                                          bottom: 8,
                                        ),
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 14,
                                          vertical: 10,
                                        ),
                                        decoration: BoxDecoration(
                                          color: Colors.white,
                                          borderRadius: BorderRadius.circular(
                                            10,
                                          ),
                                          border: Border.all(
                                            color: Color(0xFFE2E8F0),
                                          ),
                                        ),
                                        child: Row(
                                          children: [
                                            CircleAvatar(
                                              radius: 16,
                                              backgroundColor: const Color(
                                                AppColors.primary,
                                              ).withOpacity(0.2),
                                              child: Text(
                                                (m['name'] as String? ?? 'O')[0]
                                                    .toUpperCase(),
                                                style: const TextStyle(
                                                  color: Color(0xFF0D9488),
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 13,
                                                ),
                                              ),
                                            ),
                                            const SizedBox(width: 10),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    m['name'] ?? 'Officer',
                                                    style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.w600,
                                                      fontSize: 13,
                                                    ),
                                                  ),
                                                  if ((m['specialization']
                                                              as String? ??
                                                          '')
                                                      .trim()
                                                      .isNotEmpty) ...[
                                                    const SizedBox(height: 3),
                                                    Wrap(
                                                      spacing: 4,
                                                      runSpacing: 4,
                                                      children:
                                                          (m['specialization']
                                                                  as String)
                                                              .split(',')
                                                              .map(
                                                                (s) => s.trim(),
                                                              )
                                                              .where(
                                                                (s) => s
                                                                    .isNotEmpty,
                                                              )
                                                              .map(
                                                                (
                                                                  s,
                                                                ) => Container(
                                                                  padding:
                                                                      const EdgeInsets.symmetric(
                                                                        horizontal:
                                                                            6,
                                                                        vertical:
                                                                            2,
                                                                      ),
                                                                  decoration: BoxDecoration(
                                                                    color:
                                                                        const Color(
                                                                          0xFF0D9488,
                                                                        ).withValues(
                                                                          alpha:
                                                                              0.12,
                                                                        ),
                                                                    borderRadius:
                                                                        BorderRadius.circular(
                                                                          4,
                                                                        ),
                                                                    border: Border.all(
                                                                      color:
                                                                          const Color(
                                                                            0xFF0D9488,
                                                                          ).withValues(
                                                                            alpha:
                                                                                0.25,
                                                                          ),
                                                                    ),
                                                                  ),
                                                                  child: Text(
                                                                    s,
                                                                    style: const TextStyle(
                                                                      fontSize:
                                                                          10,
                                                                      color: Color(
                                                                        0xFF0D9488,
                                                                      ),
                                                                      fontWeight:
                                                                          FontWeight
                                                                              .w600,
                                                                    ),
                                                                  ),
                                                                ),
                                                              )
                                                              .toList(),
                                                    ),
                                                  ],
                                                ],
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    )
                                    .toList(),
                              );
                            },
                          ),
                          const SizedBox(height: 8),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: _showAddMembersModal,
                              icon: const Icon(
                                Icons.group_add_rounded,
                                size: 18,
                              ),
                              label: const Text('Add Members on the Move'),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: const Color(AppColors.success),
                                side: BorderSide(
                                  color: const Color(
                                    AppColors.success,
                                  ).withOpacity(0.5),
                                ),
                                padding: const EdgeInsets.symmetric(
                                  vertical: 12,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                              ),
                            ),
                          ),
                        ],

                        const SizedBox(height: 32),

                        if (_isUpdating)
                          const Center(child: CircularProgressIndicator())
                        else
                          _buildActionButtons(task),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStatusBadge(Task task) {
    final status = task.status;
    Color color;
    String label;
    IconData icon;

    switch (status) {
      case TaskStatus.pending:
        color = const Color(AppColors.danger);
        label = 'PENDING';
        icon = Icons.warning_amber_rounded;
        break;
      case TaskStatus.accepted:
        color = const Color(AppColors.warning);
        label = 'EN ROUTE';
        icon = Icons.directions_run_rounded;
        break;
      case TaskStatus.in_progress:
        color = const Color(AppColors.success);
        label = 'ON SCENE';
        icon = Icons.local_fire_department_rounded;
        break;
      case TaskStatus.returning:
        color = Colors.deepPurpleAccent;
        label = 'RETURNING TO BASE';
        icon = Icons.keyboard_return_rounded;
        break;
      case TaskStatus.completed:
        color = Colors.blue;
        label = task.returnedAt != null ? 'RETURNED TO BASE' : 'COMPLETED';
        icon = Icons.check_circle_rounded;
        break;
      default:
        color = Colors.grey;
        label = status.name.toUpperCase();
        icon = Icons.info_rounded;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 14),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        color: Colors.grey,
        fontSize: 11,
        fontWeight: FontWeight.bold,
        letterSpacing: 1.5,
      ),
    );
  }

  Future<void> _handleAcceptTask(Task task) async {
    final isBarangayResponding = task.barangayResponseStatus == 'responding';
    if (isBarangayResponding) {
      final proceed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(
                Icons.warning_amber_rounded,
                color: Color(AppColors.warning),
                size: 24,
              ),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Barangay Responding',
                  style: TextStyle(
                    color: Color(0xFF0F172A),
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          content: Text(
            'Barangay ${task.barangayName ?? "Partida"} is currently responding to this incident.\n\nDo you want to also respond to this incident?',
            style: const TextStyle(
              color: Color(0xFF475569),
              fontSize: 14,
              height: 1.5,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0D9488),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: const Text(
                'Yes, Also Respond',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      );

      if (proceed != true) return;
    }

    final currentUser = Provider.of<AuthProvider>(context, listen: false).user;
    final acceptanceLocation = currentUser?.role == UserRole.responder
        ? await _getAcceptanceLocation()
        : null;
    if (!mounted) return;
    _updateStatus(
      TaskStatus.accepted,
      arrivalMethod: acceptanceLocation == null ? null : 'gps',
      arrivalLocation: acceptanceLocation,
    );
  }

  Widget _buildActionButtons(Task task) {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final user = auth.user;
    if (user == null) return const SizedBox.shrink();

    final isResponder = user.role == UserRole.responder;
    final status = task.status;

    if (status == TaskStatus.completed || status == TaskStatus.cancelled) {
      return Center(
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: status == TaskStatus.completed
                    ? const Color(AppColors.success).withOpacity(0.1)
                    : Colors.grey.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                status == TaskStatus.completed
                    ? Icons.check_circle_rounded
                    : Icons.cancel_rounded,
                color: status == TaskStatus.completed
                    ? const Color(AppColors.success)
                    : Colors.grey,
                size: 52,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              status == TaskStatus.completed
                  ? (task.returnedAt != null ? 'RETURNED TO BASE' : 'RESPONSE COMPLETED')
                  : 'RESPONSE CANCELLED',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 18,
                letterSpacing: 1,
              ),
            ),
          ],
        ),
      );
    }

    if (isResponder) {
      if (status == TaskStatus.pending) {
        return _buildBtn(
          label: '🚗 Accept & En Route',
          color: const Color(AppColors.warning),
          onTap: () => _handleAcceptTask(task),
        );
      } else if (status == TaskStatus.accepted) {
        return Column(
          children: [
            const Padding(
              padding: EdgeInsets.only(bottom: 10),
              child: Text(
                'GPS will record arrival after two accurate fixes inside 100 m. You can also mark arrival manually.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ),
            _buildBtn(
              label: '⚡ I Have Arrived — On Scene',
              color: const Color(AppColors.success),
              onTap: () => _updateStatus(
                TaskStatus.in_progress,
                arrivalMethod: 'manual',
                arrivalLocation: _lastArrivalLocation,
              ),
            ),
          ],
        );
      } else if (status == TaskStatus.in_progress) {
        if (task.arrivedAt == null) {
          return _buildBtn(
            label: '📍 Record Arrival',
            color: const Color(AppColors.success),
            onTap: () => _updateStatus(
              TaskStatus.in_progress,
              arrivalMethod: 'manual',
              arrivalLocation: _lastArrivalLocation,
            ),
          );
        }
        return _buildBtn(
          label: '✅ Resolve & Return to Base',
          color: const Color(AppColors.primary),
          onTap: () => _resolveAndReturn(task),
        );
      } else if (status == TaskStatus.returning) {
        return _buildBtn(
          label: '✅ Mark Returned to Base',
          color: const Color(AppColors.primary),
          onTap: () => _updateStatus(TaskStatus.completed),
        );
      }
    }

    // Responder fallback
    final isJoined = task.joinedResponderIds.contains(user.id);
    if (!isJoined) {
      return _buildBtn(
        label: 'Accept Task',
        color: const Color(AppColors.primary),
        onTap: () => _handleAcceptTask(task),
      );
    }
    if (status == TaskStatus.accepted) {
      return _buildBtn(
        label: 'I Have Arrived',
        color: const Color(AppColors.success),
        onTap: () => _updateStatus(
          TaskStatus.in_progress,
          arrivalMethod: 'manual',
          arrivalLocation: _lastArrivalLocation,
        ),
      );
    }
    if (status == TaskStatus.in_progress) {
      if (task.arrivedAt == null) {
        return _buildBtn(
          label: 'Record Arrival',
          color: const Color(AppColors.success),
          onTap: () => _updateStatus(
            TaskStatus.in_progress,
            arrivalMethod: 'manual',
            arrivalLocation: _lastArrivalLocation,
          ),
        );
      }
      return _buildBtn(
        label: 'Resolve & Return to Base',
        color: const Color(AppColors.primary),
        onTap: () => _resolveAndReturn(task),
      );
    }
    if (status == TaskStatus.returning) {
      return _buildBtn(
        label: 'Mark Returned to Base',
        color: const Color(AppColors.primary),
        onTap: () => _updateStatus(TaskStatus.completed),
      );
    }

    return const SizedBox.shrink();
  }

  Widget _buildBtn({
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: _isUpdating ? null : onTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          elevation: 4,
          shadowColor: color.withOpacity(0.4),
        ),
        child: _isUpdating
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
