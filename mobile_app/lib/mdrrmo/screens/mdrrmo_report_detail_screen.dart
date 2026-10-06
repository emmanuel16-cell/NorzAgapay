import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/incident_time_format.dart';
import '../../widgets/municipality_boundary_map_layer.dart';
import '../../widgets/incident_header_gradient.dart';
import '../models/mdrrmo_report.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

const _detailNavy = Color(0xFF0C243B);
const _detailTeal = Color(0xFF0D9488);
const _detailPage = Color(0xFFF5F6FA);
const _detailInk = Color(0xFF0F172A);
const _detailMuted = Color(0xFF64748B);

class MdrrmoReportDetailScreen extends StatefulWidget {
  final MdrrmoReport report;
  const MdrrmoReportDetailScreen({super.key, required this.report});

  @override
  State<MdrrmoReportDetailScreen> createState() =>
      _MdrrmoReportDetailScreenState();
}

class _MdrrmoReportDetailScreenState extends State<MdrrmoReportDetailScreen>
    with SingleTickerProviderStateMixin {
  late MdrrmoReport _report;
  late final TabController _tabs;
  bool _busy = false;
  bool _incidentTimelineExpanded = false;
  int _assessmentAgencyIndex = 0;
  String _assistanceRequestType = 'goods';
  final _assistanceCategory = TextEditingController();
  final _assistanceDetails = TextEditingController();

  @override
  void initState() {
    super.initState();
    _report = widget.report;
    _tabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    _assistanceCategory.dispose();
    _assistanceDetails.dispose();
    super.dispose();
  }

  String _label(String? value) => (value ?? '').replaceAll('_', ' ').trim();

  Map<String, dynamic>? _myAssignment(String? userId) {
    if (userId == null) return null;
    for (final assignment in _report.assignments) {
      if (assignment['responder_id']?.toString() == userId &&
          assignment['status'] != 'removed')
        return assignment;
    }
    return null;
  }

  DateTime? _assignmentArrival(Map<String, dynamic>? assignment) {
    final value = assignment?['arrived_at'];
    return value == null ? null : DateTime.tryParse(value.toString());
  }

  Future<void> _dispatch() async {
    final auth = context.read<AuthProvider>();
    if (auth.token == null) return;
    setState(() => _busy = true);
    List<Map<String, dynamic>> responders;
    try {
      responders = await ApiService.getActiveMdrrmoResponders(auth.token!);
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$error'), backgroundColor: Colors.red),
        );
      setState(() => _busy = false);
      return;
    }
    setState(() => _busy = false);
    if (!mounted) return;
    if (responders.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No active MDRRMO responders are available.'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    const types = <String, String>{
      'flash_flood': 'Flood / Flash Flood',
      'fire': 'Fire',
      'earthquake': 'Earthquake',
      'medical_emergency': 'Medical Emergency',
      'typhoon': 'Typhoon / Severe Weather',
      'other': 'Other Emergency',
    };
    const severities = <String, String>{
      'low': 'Low',
      'moderate': 'Moderate',
      'high': 'High',
      'critical': 'Critical',
    };
    String? incidentType = types.containsKey(_report.incidentType)
        ? _report.incidentType
        : null;
    String? severity = severities.containsKey(_report.severity)
        ? _report.severity
        : null;
    final notes = TextEditingController(text: _report.dispatchNotes ?? '');
    final selected = <String>{};
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
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
                  'Dispatch MDRRMO Responders',
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
                    'Classify the report, choose one or more active responders, and add optional instructions.',
                    style: TextStyle(color: Color(0xFFCBD5E1), fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    _report.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: incidentType,
                    dropdownColor: const Color(0xFF0F172A),
                    decoration: const InputDecoration(
                      labelText: 'Incident type',
                    ),
                    items: types.entries
                        .map(
                          (entry) => DropdownMenuItem(
                            value: entry.key,
                            child: Text(entry.value),
                          ),
                        )
                        .toList(),
                    onChanged: (value) =>
                        setDialogState(() => incidentType = value),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: severity,
                    dropdownColor: const Color(0xFF0F172A),
                    decoration: const InputDecoration(labelText: 'Severity'),
                    items: severities.entries
                        .map(
                          (entry) => DropdownMenuItem(
                            value: entry.key,
                            child: Text(entry.value),
                          ),
                        )
                        .toList(),
                    onChanged: (value) =>
                        setDialogState(() => severity = value),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Active responders',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: () => setDialogState(() {
                          if (selected.length == responders.length) {
                            selected.clear();
                          } else {
                            selected.addAll(
                              responders.map((r) => r['id'].toString()),
                            );
                          }
                        }),
                        child: Text(
                          selected.length == responders.length
                              ? 'Clear'
                              : 'Select all',
                        ),
                      ),
                    ],
                  ),
                  Container(
                    constraints: const BoxConstraints(maxHeight: 200),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F172A),
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(color: const Color(0xFF334155)),
                    ),
                    child: ListView(
                      shrinkWrap: true,
                      children: responders.map((responder) {
                        final id = responder['id'].toString();
                        final name =
                            responder['full_name']?.toString() ?? 'Responder';
                        final specialty = responder['unit_type']?.toString();
                        return CheckboxListTile(
                          dense: true,
                          activeColor: _detailTeal,
                          checkColor: Colors.white,
                          title: Text(
                            name,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                            ),
                          ),
                          subtitle: specialty == null || specialty.isEmpty
                              ? null
                              : Text(
                                  specialty,
                                  style: const TextStyle(
                                    color: Color(0xFF94A3B8),
                                    fontSize: 11,
                                  ),
                                ),
                          value: selected.contains(id),
                          onChanged: (checked) => setDialogState(() {
                            if (checked == true)
                              selected.add(id);
                            else
                              selected.remove(id);
                          }),
                        );
                      }).toList(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: notes,
                    style: const TextStyle(color: Colors.white),
                    maxLength: 1000,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Dispatcher notes (optional)',
                      hintText: 'Add response instructions…',
                      filled: true,
                      fillColor: Color(0xFF0F172A),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
            ),
            ElevatedButton(
              onPressed:
                  incidentType == null || severity == null || selected.isEmpty
                  ? null
                  : () => Navigator.pop(dialogContext, {
                      'incident_type': incidentType,
                      'severity': severity,
                      'responder_ids': selected.toList(),
                      'notes': notes.text.trim(),
                    }),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF35C5DF),
              ),
              child: const Text(
                'Dispatch',
                style: TextStyle(
                  color: Color(0xFF06213A),
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
    notes.dispose();
    if (result == null || !mounted) return;
    await _run(() async {
      _report = await ApiService.dispatchMdrrmoReport(
        auth.token!,
        _report.id,
        incidentType: result['incident_type'],
        severity: result['severity'],
        responderIds: List<String>.from(result['responder_ids']),
        notes: result['notes'],
      );
    }, 'Report assigned to MDRRMO responders.');
  }

  Future<void> _accept() async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    await _run(() async {
      _report = await ApiService.respondToMdrrmoReport(token, _report.id);
    }, 'Report accepted.');
  }

  Future<void> _arrive() async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    await _run(() async {
      _report = await ApiService.markMdrrmoReportArrived(token, _report.id);
    }, 'Arrival recorded.');
  }

  Future<void> _closeReport() async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    final notes = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text(
          'Close & Record Incident',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        content: TextField(
          controller: notes,
          maxLines: 3,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            labelText: 'Resolution summary (required)',
            hintText: 'Describe the response and outcome',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, notes.text.trim().isNotEmpty),
            child: const Text('Close report'),
          ),
        ],
      ),
    );
    final summary = notes.text.trim();
    notes.dispose();
    if (submitted != true || summary.isEmpty || !mounted) return;
    await _run(() async {
      _report = await ApiService.closeMdrrmoReport(token, _report.id, summary);
    }, 'Incident closed. Its PDF is available from the resolved report card.');
  }

  Future<void> _uploadMedia() async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    final picker = ImagePicker();
    final kind = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose photo'),
              onTap: () => Navigator.pop(ctx, 'image'),
            ),
            ListTile(
              leading: const Icon(Icons.video_library_outlined),
              title: const Text('Choose video'),
              onTap: () => Navigator.pop(ctx, 'video'),
            ),
          ],
        ),
      ),
    );
    if (kind == null) return;
    final file = kind == 'video'
        ? await picker.pickVideo(source: ImageSource.gallery)
        : await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (file == null) return;
    await _run(() async {
      _report = await ApiService.uploadMdrrmoFieldMedia(
        token,
        _report.id,
        file,
      );
    }, 'Field media uploaded.');
  }

  Future<void> _recordFieldAssessment() async {
    final existing = _parseFieldAssessment(
      _extractFieldAssessment(_report.mdrrmoResponseNotes),
    );
    final situation = TextEditingController(text: existing['situation'] ?? '');
    final people = TextEditingController(text: existing['people'] ?? '');
    final actions = TextEditingController(text: existing['actions'] ?? '');
    final risks = TextEditingController(text: existing['risks'] ?? '');
    final formKey = GlobalKey<FormState>();
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('MDRRMO Field Assessment'),
        content: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: situation,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Situation observed *',
                  ),
                  validator: (value) => (value?.trim().isEmpty ?? true)
                      ? 'Describe what you observed.'
                      : null,
                ),
                TextFormField(
                  controller: people,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'People affected / urgency *',
                    hintText: 'Enter details or “Not applicable”',
                  ),
                  validator: (value) => (value?.trim().isEmpty ?? true)
                      ? 'Enter details or “Not applicable”.'
                      : null,
                ),
                TextFormField(
                  controller: actions,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Actions taken *',
                    hintText: 'Enter details or “Not applicable”',
                  ),
                  validator: (value) => (value?.trim().isEmpty ?? true)
                      ? 'Enter details or “Not applicable”.'
                      : null,
                ),
                TextFormField(
                  controller: risks,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Risks / resources needed *',
                    hintText: 'Enter details or “Not applicable”',
                  ),
                  validator: (value) => (value?.trim().isEmpty ?? true)
                      ? 'Enter details or “Not applicable”.'
                      : null,
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate())
                Navigator.pop(dialogContext, true);
            },
            child: const Text('Save Assessment'),
          ),
        ],
      ),
    );
    if (saved == true && mounted) {
      final token = context.read<AuthProvider>().token;
      if (token != null) {
        await _run(() async {
          _report = await ApiService.saveMdrrmoFieldAssessment(
            token,
            _report.id,
            situation: situation.text.trim(),
            affectedPeople: people.text.trim(),
            actionsTaken: actions.text.trim(),
            risksResources: risks.text.trim(),
          );
        }, 'MDRRMO field assessment saved.');
      }
    }
    situation.dispose();
    people.dispose();
    actions.dispose();
    risks.dispose();
  }

  Future<void> _submitAssistanceRequest() async {
    final category = _assistanceCategory.text.trim();
    final details = _assistanceDetails.text.trim();
    if (category.isEmpty || details.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Add the requested resource and explain why it is needed.',
          ),
        ),
      );
      return;
    }
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    await _run(() async {
      await ApiService.requestMdrrmoAssistance(
        token,
        _report.id,
        requestType: _assistanceRequestType,
        subType: category,
        details: details,
      );
      _assistanceCategory.clear();
      _assistanceDetails.clear();
    }, 'Assistance request sent to command staff.');
  }

  Future<void> _run(Future<void> Function() action, String success) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(success), backgroundColor: _detailTeal),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$error'), backgroundColor: Colors.red),
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _section(String title, Widget child) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(13),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: _detailInk,
            fontSize: 15,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 10),
        child,
      ],
    ),
  );

  Widget _reportDetails() {
    final description = (_report.description ?? _report.specifics ?? '')
        .replaceAll(RegExp(r'\[SEND_TO:[^\]]+\]'), '')
        .trim();
    final hasLocation = _report.latitude != 0 && _report.longitude != 0;
    final statusColor = _report.isResolved
        ? const Color(0xFF10B981)
        : _report.isResponding
        ? const Color(0xFFF59E0B)
        : const Color(0xFFEF4444);
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                _report.title,
                style: const TextStyle(
                  color: _detailInk,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: statusColor.withOpacity(.16),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                _report.isResolved
                    ? 'RESOLVED'
                    : _report.isResponding
                    ? 'RESPONDING'
                    : 'PENDING',
                style: TextStyle(
                  color: statusColor,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        if (_report.incidentType != null || _report.severity != null) ...[
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFBFDBFE)),
            ),
            child: Text(
              'Dispatcher classification: ${_label(_report.incidentType).isEmpty ? 'Unclassified' : _label(_report.incidentType)} · ${_report.severity?.toUpperCase() ?? 'UNCLASSIFIED'}',
              style: const TextStyle(
                color: Color(0xFF1E3A8A),
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
        const SizedBox(height: 14),
        _section(
          'Reporter Details',
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.person_outline, color: _detailTeal),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _report.reporterName ?? 'Resident',
                      style: const TextStyle(
                        color: _detailInk,
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ],
              ),
              if (_report.reporterPhone?.isNotEmpty == true) ...[
                const Divider(height: 20),
                Row(
                  children: [
                    const Icon(Icons.phone_outlined, color: _detailTeal),
                    const SizedBox(width: 10),
                    Text(
                      _report.reporterPhone!,
                      style: const TextStyle(color: _detailInk, fontSize: 15),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        _incidentTimeAndTimelineCard(),
        _section(
          'Details about the report',
          Text(
            description.isEmpty ? 'No details provided.' : description,
            style: const TextStyle(
              color: Color(0xFF334155),
              fontSize: 14,
              height: 1.45,
            ),
          ),
        ),
        _section(
          'Assigned MDRRMO Responders',
          _report.assignments.isEmpty
              ? Text(
                  _report.responderName ??
                      (_report.assignedResponderIds.isEmpty
                          ? 'No responders assigned yet.'
                          : '${_report.assignedResponderIds.length} responder(s) assigned'),
                  style: const TextStyle(color: _detailInk, fontSize: 14),
                )
              : Column(
                  children: _report.assignments.map((assignment) {
                    final responder = assignment['responder'];
                    final name = responder is Map
                        ? responder['full_name']?.toString()
                        : null;
                    final status = (assignment['status'] ?? 'assigned')
                        .toString()
                        .toUpperCase();
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.person_pin_circle_outlined,
                            color: _detailTeal,
                            size: 19,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              name ?? 'MDRRMO responder',
                              style: const TextStyle(
                                color: _detailInk,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          Text(
                            status,
                            style: const TextStyle(
                              color: _detailMuted,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
        ),
        if (_report.dispatchNotes?.isNotEmpty == true)
          _section(
            'Dispatcher Notes',
            Text(
              _report.dispatchNotes!,
              style: const TextStyle(color: Color(0xFF334155), height: 1.4),
            ),
          ),
        if (hasLocation)
          _section(
            'Incident Location',
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_report.address?.isNotEmpty == true)
                  Text(
                    _report.address!,
                    style: const TextStyle(color: _detailMuted, fontSize: 13),
                  ),
                const SizedBox(height: 8),
                SizedBox(
                  height: 190,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: FlutterMap(
                      options: MapOptions(
                        initialCenter: LatLng(
                          _report.latitude,
                          _report.longitude,
                        ),
                        initialZoom: 14,
                      ),
                      children: [
                        TileLayer(
                          urlTemplate:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'com.norzagapay.mobile',
                        ),
                        MunicipalityBoundaryMarkerLayer(
                          markers: [
                            Marker(
                              point: LatLng(
                                _report.latitude,
                                _report.longitude,
                              ),
                              width: 36,
                              height: 36,
                              child: const Icon(
                                Icons.location_on,
                                color: Color(0xFFEF4444),
                                size: 34,
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
                ),
                const SizedBox(height: 6),
                Text(
                  'Coordinates: ${_report.latitude.toStringAsFixed(5)}, ${_report.longitude.toStringAsFixed(5)}',
                  style: const TextStyle(color: _detailMuted, fontSize: 12),
                ),
              ],
            ),
          ),
        if (_report.proofUrls.isNotEmpty)
          _section(
            'Proof · ${_report.proofUrls.length} attachment${_report.proofUrls.length == 1 ? '' : 's'}',
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (var i = 0; i < _report.proofUrls.length; i++)
                  GestureDetector(
                    onTap: () => launchUrl(
                      Uri.parse(_report.proofUrls[i]),
                      mode: LaunchMode.externalApplication,
                    ),
                    child: Container(
                      width: 92,
                      height: 92,
                      clipBehavior: Clip.antiAlias,
                      decoration: BoxDecoration(
                        color: const Color(0xFFE2E8F0),
                        borderRadius: BorderRadius.circular(9),
                        border: Border.all(color: const Color(0xFF6687C2)),
                      ),
                      child:
                          (_report.proofTypes.length > i &&
                              _report.proofTypes[i] == 'video')
                          ? const Icon(
                              Icons.play_circle_outline_rounded,
                              color: _detailNavy,
                              size: 36,
                            )
                          : Image.network(
                              _report.proofUrls[i],
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => const Icon(
                                Icons.broken_image_outlined,
                                color: _detailMuted,
                              ),
                            ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _incidentTimeAndTimelineCard() {
    final receivedAt = _report.createdAt == null
        ? 'Not recorded'
        : formatIncidentDateTime(_report.createdAt!);
    final steps = <(String, DateTime?)>[
      ('Report received', _report.createdAt),
      ('MDRRMO responder dispatched', _report.dispatchedAt),
      ('Responder accepted', _report.acceptedAt),
      ('Arrived at incident area', _report.arrivedAt),
      ('Incident resolved', _report.resolvedAt),
    ];
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(
              () => _incidentTimelineExpanded = !_incidentTimelineExpanded,
            ),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Incident Time',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: _detailInk,
                          ),
                        ),
                        const SizedBox(height: 8),
                        IncidentOccurrenceText(
                          occurredAt: _report.incidentOccurredAt,
                          receivedAt: _report.createdAt,
                          resolvedAt: _report.resolvedAt,
                          precision: _report.incidentTimePrecision,
                          isResolved: _report.isResolved,
                          style: const TextStyle(
                            color: Color(0xFF334155),
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Report received: $receivedAt',
                          style: const TextStyle(
                            color: Color(0xFF64748B),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(
                    _incidentTimelineExpanded
                        ? Icons.expand_less
                        : Icons.expand_more,
                    color: _detailInk,
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 220),
            crossFadeState: _incidentTimelineExpanded
                ? CrossFadeState.showFirst
                : CrossFadeState.showSecond,
            firstChild: Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Response Timeline',
                    style: TextStyle(
                      color: _detailInk,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  for (final step in steps)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 4),
                            child: Icon(
                              Icons.circle,
                              size: 7,
                              color: Color(0xFF0284C7),
                            ),
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  step.$1,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFF334155),
                                  ),
                                ),
                                Text(
                                  step.$2 == null
                                      ? 'Not recorded'
                                      : formatIncidentDateTime(step.$2!),
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
                ],
              ),
            ),
            secondChild: const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }

  Widget _fieldAssessment() {
    final media = _report.responderMedia;
    final user = context.read<AuthProvider>().user;
    final assignment = _myAssignment(user?.id);
    final assignmentStatus = assignment?['status']?.toString();
    final canEditAssessment =
        user?.role.name == 'responder' &&
        (assignmentStatus == 'assigned' || assignmentStatus == 'responding') &&
        !_report.isResolved;
    final showBarangayAssessment =
        _report.isEscalated && _assessmentAgencyIndex == 1;
    final rawAssessment = showBarangayAssessment
        ? _report.barangayResponseNotes
        : _report.mdrrmoResponseNotes;
    final assessmentText = _extractFieldAssessment(rawAssessment);
    final assessmentValues = _parseFieldAssessment(assessmentText);
    final arrivalAt = _assignmentArrival(assignment) ?? _report.arrivedAt;
    final canMarkArrival =
        user?.role.name == 'responder' &&
        assignmentStatus == 'responding' &&
        arrivalAt == null &&
        !_report.isResolved;
    final barangayLabel = (_report.barangayName ?? '').trim().isEmpty
        ? 'Barangay'
        : _report.barangayName!.trim();
    return Column(
      children: [
        if (_report.isEscalated)
          Container(
            width: double.infinity,
            height: 46,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Color(0xFF0C243B),
                  Color(0xFF133E68),
                  Color(0xFF0F5B78),
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Row(
              children: [
                _assessmentAgencyTab('MDRRMO', 0),
                _assessmentAgencyTab(barangayLabel, 1),
              ],
            ),
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(14),
            children: [
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: const Color(0xFFE0F2FE),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Icon(
                            Icons.fact_check_outlined,
                            color: Color(0xFF38BDF8),
                            size: 20,
                          ),
                        ),
                        const SizedBox(width: 9),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Latest Field Assessment',
                                style: TextStyle(
                                  color: _detailInk,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                              SizedBox(height: 2),
                              Text(
                                'On-scene report',
                                style: TextStyle(
                                  color: _detailMuted,
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _assessmentValueCard(
                      'Situation',
                      assessmentValues['situation'],
                    ),
                    _assessmentValueCard(
                      'People affected / urgency',
                      assessmentValues['people'],
                    ),
                    _assessmentValueCard(
                      'Actions taken',
                      assessmentValues['actions'],
                    ),
                    _assessmentValueCard(
                      'Risks / resources',
                      assessmentValues['risks'],
                    ),
                  ],
                ),
              ),
              if (!showBarangayAssessment && canEditAssessment)
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : _recordFieldAssessment,
                    icon: const Icon(Icons.fact_check_outlined, size: 17),
                    label: Text(_busy ? 'Saving…' : 'Update Field Assessment'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF38BDF8),
                      side: const BorderSide(color: Color(0xFF38BDF8)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Responder Field Photos & Media',
                    style: TextStyle(
                      color: _detailInk,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    '${media.length} item(s)',
                    style: const TextStyle(
                      color: Color(0xFF94A3B8),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                constraints: const BoxConstraints(minHeight: 84),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: media.isEmpty
                    ? const Center(
                        child: Text(
                          'No field documentation yet. Add scene photos or video after assessing the incident.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: _detailMuted, fontSize: 12),
                        ),
                      )
                    : Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final item in media)
                            GestureDetector(
                              onTap: () => launchUrl(
                                Uri.parse(item['url'].toString()),
                                mode: LaunchMode.externalApplication,
                              ),
                              child: Container(
                                width: 92,
                                height: 92,
                                decoration: BoxDecoration(
                                  color: const Color(0xFFE2E8F0),
                                  borderRadius: BorderRadius.circular(9),
                                ),
                                child: item['type'] == 'video'
                                    ? const Icon(
                                        Icons.play_circle_outline,
                                        color: _detailNavy,
                                        size: 36,
                                      )
                                    : ClipRRect(
                                        borderRadius: BorderRadius.circular(9),
                                        child: Image.network(
                                          item['url'].toString(),
                                          fit: BoxFit.cover,
                                          errorBuilder: (_, __, ___) =>
                                              const Icon(
                                                Icons.broken_image_outlined,
                                              ),
                                        ),
                                      ),
                              ),
                            ),
                        ],
                      ),
              ),
              if (user?.role.name == 'responder' && !_report.isResolved) ...[
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : _uploadMedia,
                    icon: const Icon(Icons.add_a_photo_outlined, size: 17),
                    label: const Text('Attach Field Photo / Video'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF38BDF8),
                      side: const BorderSide(color: Color(0xFF38BDF8)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ],
              if (canMarkArrival) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE0F2FE),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFBAE6FD)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Confirm your arrival after reaching the incident area.',
                        style: TextStyle(
                          color: Color(0xFF075985),
                          fontSize: 11,
                        ),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _busy ? null : _arrive,
                          icon: const Icon(
                            Icons.location_on_outlined,
                            size: 16,
                          ),
                          label: const Text('Mark Arrival Manually'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFF0284C7),
                            side: const BorderSide(color: Color(0xFF38BDF8)),
                            shape: const StadiumBorder(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ] else if (arrivalAt != null) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE0F2FE),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    'Arrival recorded: ${formatIncidentDateTime(arrivalAt)}',
                    style: const TextStyle(
                      color: Color(0xFF075985),
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
              if (_report.resolutionNotes?.isNotEmpty == true)
                _section(
                  'Resolution Summary',
                  Text(
                    _report.resolutionNotes!,
                    style: const TextStyle(
                      color: Color(0xFF334155),
                      height: 1.4,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _assessmentAgencyTab(String label, int index) {
    final selected = _assessmentAgencyIndex == index;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _assessmentAgencyIndex = index),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Center(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: selected ? FontWeight.bold : FontWeight.w500,
                ),
              ),
            ),
            if (selected)
              const Positioned(
                left: 14,
                right: 14,
                bottom: 0,
                child: SizedBox(
                  height: 3,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Color(0xFF64D2B4),
                      borderRadius: BorderRadius.vertical(
                        top: Radius.circular(3),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _assessmentValueCard(String label, String? value) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 6),
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
    decoration: BoxDecoration(
      color: const Color(0xFFF8FAFC),
      borderRadius: BorderRadius.circular(9),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF0284C7),
            fontSize: 11,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          (value ?? '').trim().isEmpty ? 'No details recorded.' : value!.trim(),
          style: const TextStyle(
            color: Color(0xFF475569),
            fontSize: 12,
            height: 1.35,
          ),
        ),
      ],
    ),
  );

  Map<String, String> _parseFieldAssessment(String? source) {
    final values = <String, String>{};
    final text = (source ?? '').trim();
    if (text.isEmpty) return values;
    final body = text.replaceFirst(
      RegExp(
        r'^\[?(?:MDRRMO\s+)?FIELD ASSESSMENT\]?\s*:?\s*',
        caseSensitive: false,
      ),
      '',
    );
    String? current;
    for (final rawLine in body.split(RegExp(r'\r?\n'))) {
      final line = rawLine.trim();
      if (line.isEmpty) continue;
      final colon = line.indexOf(':');
      if (colon > 0) {
        final label = line.substring(0, colon).toLowerCase().trim();
        if (label.contains('situation')) {
          current = 'situation';
        } else if (label.contains('people') ||
            label.contains('affected') ||
            label.contains('urgency')) {
          current = 'people';
        } else if (label.contains('actions')) {
          current = 'actions';
        } else if (label.contains('risks') || label.contains('resources')) {
          current = 'risks';
        } else {
          current = null;
        }
        if (current != null) {
          final value = line.substring(colon + 1).trim();
          values[current] = [
            if ((values[current] ?? '').isNotEmpty) values[current]!,
            value,
          ].where((part) => part.isNotEmpty).join('\n');
          continue;
        }
      }
      if (current != null)
        values[current] = [
          values[current],
          line,
        ].whereType<String>().where((part) => part.isNotEmpty).join('\n');
    }
    if (values.isEmpty) values['situation'] = body.isEmpty ? text : body;
    return values;
  }

  String? _extractFieldAssessment(String? notes) {
    final value = (notes ?? '').trim();
    if (value.isEmpty) return null;
    final upper = value.toUpperCase();
    final taggedStart = upper.indexOf('[MDRRMO FIELD ASSESSMENT]');
    final start = taggedStart >= 0
        ? taggedStart
        : upper.indexOf('FIELD ASSESSMENT');
    if (start < 0) return null;
    final markerLength = taggedStart >= 0
        ? '[MDRRMO FIELD ASSESSMENT]'.length
        : 'FIELD ASSESSMENT'.length;
    return value.substring(start + markerLength).trim();
  }

  Widget _requestAssistance() {
    final user = context.read<AuthProvider>().user;
    final assignment = _myAssignment(user?.id);
    final canRequest =
        user?.role.name == 'responder' &&
        (assignment?['status'] == 'assigned' ||
            assignment?['status'] == 'responding') &&
        !_report.isResolved;
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        _section(
          'Request Assistance',
          Text(
            canRequest
                ? 'Send a resource or responder request to command staff. The report is attached automatically and command staff receive a live notification.'
                : 'Assistance requests are available to responders assigned to this active report.',
            style: const TextStyle(color: Color(0xFF475569), height: 1.45),
          ),
        ),
        if (canRequest)
          _section(
            'Assistance Needed',
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DropdownButtonFormField<String>(
                  value: _assistanceRequestType,
                  decoration: const InputDecoration(labelText: 'Request type'),
                  items: const [
                    DropdownMenuItem(
                      value: 'goods',
                      child: Text('Supplies / Equipment'),
                    ),
                    DropdownMenuItem(
                      value: 'responders',
                      child: Text('Additional Responders'),
                    ),
                  ],
                  onChanged: _busy
                      ? null
                      : (value) {
                          if (value != null)
                            setState(() => _assistanceRequestType = value);
                        },
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _assistanceCategory,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    labelText: _assistanceRequestType == 'goods'
                        ? 'Supplies or equipment'
                        : 'Responder skills / team',
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _assistanceDetails,
                  maxLines: 4,
                  maxLength: 1000,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Why is it needed?',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _busy ? null : _submitAssistanceRequest,
                    icon: const Icon(Icons.send_rounded),
                    label: Text(_busy ? 'Sending…' : 'Send Request'),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget? _bottomAction() {
    final user = context.watch<AuthProvider>().user;
    final isDispatcher = user?.role.name == 'dispatcher';
    final isResponder = user?.role.name == 'responder';
    if (_report.isPending && isDispatcher)
      return _action(
        'Classify & Dispatch Responders',
        Icons.send_rounded,
        _detailTeal,
        _dispatch,
      );
    final assignment = _myAssignment(user?.id);
    final assignmentStatus = assignment?['status']?.toString();
    final myArrival = _assignmentArrival(assignment);
    if (isResponder && !_report.isResolved && assignmentStatus == 'assigned')
      return _action(
        'Accept & Respond',
        Icons.check_circle_outline,
        const Color(0xFF10B981),
        _accept,
      );
    if (isResponder &&
        !_report.isResolved &&
        assignmentStatus == 'responding' &&
        myArrival != null)
      return _action(
        'Close & Record Incident',
        Icons.check_circle,
        const Color(0xFF10B981),
        _closeReport,
      );
    if (_report.isResponding && isDispatcher && _report.arrivedAt != null)
      return _action(
        'Close & Record Incident',
        Icons.check_circle,
        const Color(0xFF10B981),
        _closeReport,
      );
    return null;
  }

  Widget _action(
    String label,
    IconData icon,
    Color color,
    VoidCallback callback,
  ) => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      decoration: const BoxDecoration(
        color: _detailPage,
        border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
      ),
      child: SizedBox(
        height: 48,
        child: ElevatedButton.icon(
          onPressed: _busy ? null : callback,
          icon: Icon(icon, size: 18),
          label: Text(
            _busy ? 'Saving…' : label,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: color,
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
          ),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final action = _bottomAction();
    return Scaffold(
      backgroundColor: _detailPage,
      appBar: AppBar(
        backgroundColor: _detailNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        flexibleSpace: const IncidentHeaderGradient(),
        title: const Text(
          'Incident Response',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: const Color(0xFF64D2B4),
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          tabs: const [
            Tab(text: 'Report Details'),
            Tab(text: 'Assistance'),
            Tab(text: 'Field Assessment'),
          ],
        ),
      ),
      bottomNavigationBar: action,
      body: Column(
        children: [
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _reportDetails(),
                _requestAssistance(),
                _fieldAssessment(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
