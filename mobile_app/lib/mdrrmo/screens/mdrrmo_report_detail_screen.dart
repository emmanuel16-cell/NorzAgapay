import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

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

  @override
  void initState() {
    super.initState();
    _report = widget.report;
    _tabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
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
    }, 'Incident closed and recorded.');
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
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        _section(
          'Reporter Detail',
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
        if (hasLocation)
          _section(
            'Incident Location',
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_report.address != null)
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
                        MarkerLayer(
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
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _fieldAssessment() {
    final media = _report.responderMedia;
    final assignments = _report.assignments;
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        _section(
          'Dispatcher Classification',
          Text(
            '${_label(_report.incidentType).isEmpty ? 'Unclassified' : _label(_report.incidentType)} · ${_report.severity?.toUpperCase() ?? 'UNCLASSIFIED'}',
            style: const TextStyle(
              color: _detailTeal,
              fontSize: 15,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        _section(
          'Assigned MDRRMO Responders',
          assignments.isEmpty
              ? Text(
                  _report.responderName ??
                      (_report.assignedResponderIds.isEmpty
                          ? 'No responders assigned yet.'
                          : '${_report.assignedResponderIds.length} responder(s) assigned'),
                  style: const TextStyle(color: _detailInk, fontSize: 14),
                )
              : Column(
                  children: assignments.map((assignment) {
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
        _section(
          'Response Timeline',
          Column(
            children: [
              _timeline('Dispatched', _report.dispatchedAt),
              _timeline('Accepted', _report.acceptedAt),
              _timeline('Arrived', _report.arrivedAt),
              _timeline('Resolved', _report.resolvedAt),
            ],
          ),
        ),
        _section(
          'Field Photos & Videos',
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (media.isEmpty)
                const Text(
                  'No field media uploaded yet.',
                  style: TextStyle(color: _detailMuted),
                ),
              if (media.isNotEmpty)
                Wrap(
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
                                        const Icon(Icons.broken_image_outlined),
                                  ),
                                ),
                        ),
                      ),
                  ],
                ),
              if (context.read<AuthProvider>().user?.role.name == 'responder' &&
                  !_report.isResolved) ...[
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _uploadMedia,
                  icon: const Icon(Icons.add_a_photo_outlined),
                  label: const Text('Add field media'),
                ),
              ],
            ],
          ),
        ),
        if (_report.resolutionNotes?.isNotEmpty == true)
          _section(
            'Resolution Summary',
            Text(
              _report.resolutionNotes!,
              style: const TextStyle(color: Color(0xFF334155), height: 1.4),
            ),
          ),
      ],
    );
  }

  Widget _timeline(String label, DateTime? date) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      children: [
        Icon(
          date == null ? Icons.radio_button_unchecked : Icons.check_circle,
          color: date == null ? const Color(0xFFCBD5E1) : _detailTeal,
          size: 18,
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Text(label, style: const TextStyle(color: _detailInk)),
        ),
        Text(
          date == null
              ? '—'
              : '${date.toLocal().day}/${date.toLocal().month} ${date.toLocal().hour.toString().padLeft(2, '0')}:${date.toLocal().minute.toString().padLeft(2, '0')}',
          style: const TextStyle(color: _detailMuted, fontSize: 12),
        ),
      ],
    ),
  );

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
        myArrival == null)
      return _action(
        'Mark Arrived',
        Icons.location_on_outlined,
        const Color(0xFFF59E0B),
        _arrive,
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
            Tab(text: 'Field Assessment'),
            Tab(text: 'Response Status'),
          ],
        ),
      ),
      bottomNavigationBar: action,
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: const Color(0xFFE6F6F3),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _report.title,
                    style: const TextStyle(
                      color: _detailInk,
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _report.isResolved
                      ? 'RESOLVED'
                      : _report.isResponding
                      ? 'RESPONDING'
                      : 'PENDING',
                  style: TextStyle(
                    color: _report.isResolved
                        ? const Color(0xFF10B981)
                        : _report.isResponding
                        ? const Color(0xFFF59E0B)
                        : const Color(0xFFEF4444),
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _reportDetails(),
                _fieldAssessment(),
                _fieldAssessment(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
