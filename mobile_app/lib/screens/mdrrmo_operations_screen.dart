import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../mdrrmo/core/constants.dart';
import '../mdrrmo/models/user.dart';
import '../mdrrmo/providers/auth_provider.dart';

class _MobileModule {
  final String key;
  final String label;
  final IconData icon;
  final String endpoint;
  const _MobileModule(this.key, this.label, this.icon, this.endpoint);
}

class MdrrmoOperationsScreen extends StatefulWidget {
  const MdrrmoOperationsScreen({super.key});

  @override
  State<MdrrmoOperationsScreen> createState() => _MdrrmoOperationsScreenState();
}

class _MdrrmoOperationsScreenState extends State<MdrrmoOperationsScreen> {
  List<_MobileModule> _modules = const [];
  _MobileModule? _module;
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;

  AuthProvider get _auth => Provider.of<AuthProvider>(context, listen: false);
  String get _token => _auth.token ?? '';
  User get _user => _auth.user!;

  @override
  void initState() {
    super.initState();
    final role = Provider.of<AuthProvider>(context, listen: false).user!.role;
    _modules = _modulesFor(role);
    _module = _modules.first;
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  List<_MobileModule> _modulesFor(UserRole role) {
    const incidents = _MobileModule('incidents', 'Incident Queue', Icons.warning_amber_rounded, '/incident-reports');
    const responders = _MobileModule('responders', 'Responder Tracker', Icons.my_location_rounded, '/users?role=responder&status=active');
    const weather = _MobileModule('weather', 'Weather & Advisories', Icons.cloud_rounded, '/weather/current');
    const users = _MobileModule('users', 'Accounts', Icons.people_alt_rounded, '/users');
    const officerVerification = _MobileModule('officer-verification', 'Officer Verification', Icons.verified_user_rounded, '/verification/pending');
    const barangayRequests = _MobileModule('barangay-requests', 'Barangay Coordination', Icons.account_balance_rounded, '/verification/barangay-accounts/pending');
    const requests = _MobileModule('requests', 'Resource Requests', Icons.inventory_2_rounded, '/requests');
    const units = _MobileModule('units', 'Response Units', Icons.groups_rounded, '/respond-units');
    const stations = _MobileModule('stations', 'Add Evac Station', Icons.location_city_rounded, '/evacuation-centers');
    const broadcasts = _MobileModule('broadcasts', 'Public Advisories', Icons.campaign_rounded, '/broadcasts/mdrrmo');
    const analytics = _MobileModule('analytics', 'Situation Summary', Icons.query_stats_rounded, '/reports/overview');

    switch (role) {
      case UserRole.admin:
        return [incidents, officerVerification, barangayRequests, users, responders, stations, broadcasts, analytics, weather];
      case UserRole.master_admin:
        return [incidents, officerVerification, barangayRequests, users, requests, units, responders, stations, broadcasts, analytics, weather];
      case UserRole.dispatcher:
        return [incidents, responders, weather];
      case UserRole.logistics:
        return [requests, units, responders, stations, weather];
      case UserRole.responder:
        return [];
    }
  }

  Map<String, String> get _headers => {
        'Authorization': 'Bearer $_token',
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      };

  List<Map<String, dynamic>> _extractRows(dynamic response) {
    if (response is List) {
      return response.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
    }
    if (response is Map) {
      for (final key in [
        'users', 'pending_verifications', 'pending_dispatchers', 'requests', 'units',
        'centers', 'evacuation_centers', 'posts', 'broadcasts', 'incidents', 'data',
      ]) {
        final value = response[key];
        if (value is List) {
          return value.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
        }
      }
    }
    return [];
  }

  Future<void> _load() async {
    final module = _module;
    if (module == null) return;
    setState(() => _loading = true);
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}${module.endpoint}'),
        headers: _headers,
      );
      final body = response.body.isNotEmpty ? jsonDecode(response.body) : <String, dynamic>{};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw (body is Map ? body['error'] : null) ?? 'Could not load ${module.label.toLowerCase()}';
      }
      if (!mounted) return;
      setState(() {
        _rows = _extractRows(body);
        _summary = body is Map && body['stats'] is Map
            ? Map<String, dynamic>.from(body['stats'] as Map)
            : body is Map && module.key == 'weather'
                ? Map<String, dynamic>.from(body)
                : {};
      });
    } catch (error) {
      if (mounted) _message('Could not load ${module.label}: $error', isError: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<http.Response> _send(String method, String path, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('${AppConstants.apiBaseUrl}$path');
    final headers = _headers;
    switch (method) {
      case 'POST':
        return http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
      case 'PATCH':
        return http.patch(uri, headers: headers, body: jsonEncode(body ?? {}));
      case 'DELETE':
        return http.delete(uri, headers: headers);
      default:
        return http.get(uri, headers: headers);
    }
  }

  Future<void> _mutate(String method, String path, {Map<String, dynamic>? body, String success = 'Saved'}) async {
    try {
      final response = await _send(method, path, body: body);
      final result = response.body.isNotEmpty ? jsonDecode(response.body) : {};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw (result is Map ? result['error'] : null) ?? 'Request failed';
      }
      if (!mounted) return;
      _message(success);
      await _load();
    } catch (error) {
      if (mounted) _message('$error', isError: true);
    }
  }

  void _message(String text, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      backgroundColor: isError ? const Color(AppColors.danger) : const Color(AppColors.success),
      behavior: SnackBarBehavior.floating,
    ));
  }

  String _displayTitle(Map<String, dynamic> row) =>
      (row['full_name'] ?? row['name'] ?? row['unit_name'] ?? row['title'] ?? row['incident_title'] ?? row['email'] ?? 'Record').toString();

  String _displaySubtitle(Map<String, dynamic> row) {
    final parts = [
      row['role'], row['status'], row['address'], row['barangay_name'], row['specialization'],
      row['unit_type'], row['created_at'] == null ? null : _shortDate(row['created_at'].toString()),
    ].where((value) => value != null && value.toString().trim().isNotEmpty).map((value) => value.toString().replaceAll('_', ' '));
    return parts.join(' · ');
  }

  String _shortDate(String date) {
    final parsed = DateTime.tryParse(date);
    return parsed == null ? date : '${parsed.month}/${parsed.day}/${parsed.year}';
  }

  Future<void> _openMap(Map<String, dynamic> row) async {
    final lat = row['latitude'] ?? row['lat'];
    final lng = row['longitude'] ?? row['lng'];
    if (lat == null || lng == null) return _message('No location is available for this record', isError: true);
    final url = Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng');
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
      _message('Could not open map', isError: true);
    }
  }

  Future<void> _handleRowAction(Map<String, dynamic> row, String action) async {
    final id = (row['id'] ?? row['account_id'] ?? row['user_id'] ?? '').toString();
    if (id.isEmpty) return _message('This record has no identifier', isError: true);
    switch (_module?.key) {
      case 'incidents':
        if (action == 'verify') {
          await _classifyIncident(row);
        }
        break;
      case 'officer-verification':
        if (action == 'approve') {
          await _mutate('POST', '/verification/$id/approve', success: 'Responder verified');
        } else {
          final reason = await _askText('Reason for rejection', required: true);
          if (reason != null) await _mutate('POST', '/verification/$id/reject', body: {'reason': reason}, success: 'Verification declined');
        }
        break;
      case 'barangay-requests':
        if (action == 'approve') {
          await _mutate('POST', '/verification/barangay-accounts/$id/approve', success: 'Barangay request approved and access activated');
        } else {
          final reason = await _askText('Reason for rejection', required: true);
          if (reason != null) await _mutate('POST', '/verification/barangay-accounts/$id/reject', body: {'reason': reason}, success: 'Barangay request declined');
        }
        break;
      case 'requests':
        await _mutate('PATCH', '/requests/$id/status', body: {'status': action}, success: 'Resource request updated');
        break;
      case 'broadcasts':
        if (action == 'pin') {
          await _mutate('PATCH', '/broadcasts/mdrrmo/$id/pin', body: {'is_pinned': row['is_pinned'] != true}, success: 'Advisory updated');
        } else if (action == 'delete') {
          await _mutate('DELETE', '/broadcasts/mdrrmo/$id', success: 'Advisory removed');
        }
        break;
    }
  }

  Future<void> _classifyIncident(Map<String, dynamic> row) async {
    const incidentTypes = <String, String>{
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
    String? incidentType = incidentTypes.containsKey(row['incident_type']) ? row['incident_type'] as String : null;
    String? severity = severities.containsKey(row['severity']) ? row['severity'] as String : null;
    final proofUrls = row['proof_urls'] is List
        ? (row['proof_urls'] as List).map((value) => value.toString()).toList()
        : row['proof_url'] == null ? <String>[] : [row['proof_url'].toString()];
    final classification = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
        title: const Text('Review, classify and dispatch'),
        content: SizedBox(
          width: 460,
          child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((row['title'] ?? 'Incident report').toString(), style: const TextStyle(fontWeight: FontWeight.bold)),
            if ((row['description'] ?? row['specifics'] ?? '').toString().trim().isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 6, bottom: 10), child: Text((row['description'] ?? row['specifics']).toString())),
            if (proofUrls.isNotEmpty) ...[
              const Text('Submitted evidence', style: TextStyle(fontWeight: FontWeight.w600)),
              Wrap(spacing: 4, children: [for (var index = 0; index < proofUrls.length; index++) TextButton.icon(
                onPressed: () async { final uri = Uri.tryParse(proofUrls[index]); if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication); },
                icon: const Icon(Icons.open_in_new, size: 16), label: Text('Evidence ${index + 1}'),
              )]),
            ],
            DropdownButtonFormField<String>(
              value: incidentType,
              decoration: const InputDecoration(labelText: 'Incident type'),
              items: incidentTypes.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
              onChanged: (value) => setDialogState(() => incidentType = value),
            ),
            DropdownButtonFormField<String>(
              value: severity,
              decoration: const InputDecoration(labelText: 'Severity'),
              items: severities.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
              onChanged: (value) => setDialogState(() => severity = value),
            ),
            const Padding(padding: EdgeInsets.only(top: 10), child: Text('Barangay classifications are prefilled on escalated reports. You can adjust them before dispatching MDRRMO responders.', style: TextStyle(fontSize: 12))),
          ])),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          FilledButton(onPressed: incidentType == null || severity == null ? null : () => Navigator.pop(dialogContext, {'incident_type': incidentType!, 'severity': severity!}), child: const Text('Send responders')),
        ],
      )),
    );
    if (classification == null) return;
    final id = row['id'].toString();
    await _mutate('POST', '/incident-reports/$id/verify', body: classification, success: 'Incident classified and responders dispatched');
  }

  Future<String?> _askText(String title, {bool required = false}) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller, autofocus: true, maxLines: 3, decoration: const InputDecoration(hintText: 'Enter a note')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          FilledButton(onPressed: () {
            if (required && controller.text.trim().isEmpty) return;
            Navigator.pop(dialogContext, controller.text.trim());
          }, child: const Text('Continue')),
        ],
      ),
    );
    controller.dispose();
    return value;
  }

  Future<void> _createAccount() async {
    final name = TextEditingController();
    final email = TextEditingController();
    final password = TextEditingController();
    var role = _user.role == UserRole.master_admin ? 'admin' : 'dispatcher';
    final values = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
        title: const Text('Create dashboard account'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Full name')),
          TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
          TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'Temporary password (8+ characters)')),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(value: role, decoration: const InputDecoration(labelText: 'Role'), items: [
            if (_user.role == UserRole.master_admin) const DropdownMenuItem(value: 'admin', child: Text('Admin')),
            const DropdownMenuItem(value: 'logistics', child: Text('Logistics')),
            const DropdownMenuItem(value: 'dispatcher', child: Text('Dispatcher')),
          ], onChanged: (value) => setDialogState(() => role = value ?? role)),
        ])),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')), FilledButton(onPressed: () {
          if (name.text.trim().length < 2 || !email.text.contains('@') || password.text.length < 8) return;
          Navigator.pop(dialogContext, {'full_name': name.text.trim(), 'email': email.text.trim(), 'password': password.text, 'role': role});
        }, child: const Text('Create'))],
      )),
    );
    name.dispose(); email.dispose(); password.dispose();
    if (values != null) await _mutate('POST', '/users', body: values, success: 'Account created');
  }

  Future<void> _createUnit() async {
    final name = TextEditingController();
    final specialization = TextEditingController();
    final values = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add response unit'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Unit name')),
          TextField(controller: specialization, decoration: const InputDecoration(labelText: 'Specialization')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () {
          if (name.text.trim().isEmpty || specialization.text.trim().isEmpty) return;
          Navigator.pop(context, {'unit_name': name.text.trim(), 'specialization': specialization.text.trim()});
        }, child: const Text('Add unit'))],
      ),
    );
    name.dispose(); specialization.dispose();
    if (values != null) await _mutate('POST', '/respond-units', body: values, success: 'Response unit added');
  }

  Future<void> _createStation() async {
    final name = TextEditingController();
    final address = TextEditingController();
    final latitude = TextEditingController(text: '14.9133');
    final longitude = TextEditingController(text: '121.0436');
    String? barangayId;
    final values = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
        title: const Text('Add evacuation station'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Station name')),
          TextField(controller: address, decoration: const InputDecoration(labelText: 'Address')),
          const SizedBox(height: 10),
          FutureBuilder<http.Response>(
            future: http.get(Uri.parse('${AppConstants.apiBaseUrl}/barangay/list'), headers: {'ngrok-skip-browser-warning': 'true'}),
            builder: (context, snapshot) {
              if (!snapshot.hasData) return const LinearProgressIndicator();
              final decoded = jsonDecode(snapshot.data!.body);
              final barangays = decoded is List ? decoded.whereType<Map>().map((b) => Map<String, dynamic>.from(b)).toList() : <Map<String, dynamic>>[];
              if (barangays.isEmpty) return const Text('Barangay list unavailable');
              barangayId ??= barangays.first['id']?.toString();
              return DropdownButtonFormField<String>(value: barangayId, decoration: const InputDecoration(labelText: 'Barangay'), items: barangays.map((b) => DropdownMenuItem(value: b['id'].toString(), child: Text('${b['name']}'))).toList(), onChanged: (value) => setDialogState(() => barangayId = value));
            },
          ),
          Row(children: [Expanded(child: TextField(controller: latitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: const InputDecoration(labelText: 'Latitude'))), const SizedBox(width: 12), Expanded(child: TextField(controller: longitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: const InputDecoration(labelText: 'Longitude')))]),
          const Padding(padding: EdgeInsets.only(top: 8), child: Text('Stations are added once. Resident accounts use this location to find the nearest station and estimate travel time.', style: TextStyle(fontSize: 12))),
        ])),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')), FilledButton(onPressed: () {
          final lat = double.tryParse(latitude.text.trim());
          final lng = double.tryParse(longitude.text.trim());
          if (name.text.trim().isEmpty || address.text.trim().isEmpty || barangayId == null || lat == null || lng == null) return;
          Navigator.pop(dialogContext, {'name': name.text.trim(), 'address': address.text.trim(), 'latitude': lat, 'longitude': lng, 'barangay_id': barangayId});
        }, child: const Text('Add station'))],
      )),
    );
    name.dispose(); address.dispose(); latitude.dispose(); longitude.dispose();
    if (values != null) await _mutate('POST', '/evacuation-centers/mdrrmo', body: values, success: 'Evacuation station added');
  }

  Future<void> _createBroadcast() async {
    final content = await _askText('Publish public advisory', required: true);
    if (content == null) return;
    final response = await http.post(
      Uri.parse('${AppConstants.apiBaseUrl}/broadcasts/mdrrmo'),
      headers: _headers,
      body: jsonEncode({'category': 'Emergency Advisory', 'content': content}),
    );
    final result = response.body.isNotEmpty ? jsonDecode(response.body) : {};
    if (response.statusCode < 200 || response.statusCode >= 300) return _message('${result is Map ? result['error'] : 'Could not publish advisory'}', isError: true);
    _message('Advisory published');
    await _load();
  }

  Future<void> _createForCurrentModule() async {
    switch (_module?.key) {
      case 'users': await _createAccount(); break;
      case 'units': await _createUnit(); break;
      case 'stations': await _createStation(); break;
      case 'broadcasts': await _createBroadcast(); break;
    }
  }

  Widget _summaryCards() {
    if (_summary.isEmpty) return const SizedBox.shrink();
    return Wrap(spacing: 8, runSpacing: 8, children: _summary.entries.map((entry) => Container(
      width: 145,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(AppColors.bgSecondary), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(AppColors.border))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(entry.key.replaceAllMapped(RegExp(r'([A-Z])'), (match) => ' ${match[1]}').toUpperCase(), style: const TextStyle(color: Colors.white60, fontSize: 10)), const SizedBox(height: 4), Text('${entry.value}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold))]),
    )).toList());
  }

  List<Widget> _actionsFor(Map<String, dynamic> row) {
    switch (_module?.key) {
      case 'incidents':
        final status = (row['status'] ?? '').toString().toLowerCase();
        return status == 'resolved' || status == 'closed' || status == 'verified'
            ? [TextButton.icon(onPressed: () => _openMap(row), icon: const Icon(Icons.map_outlined), label: const Text('Map'))]
            : [TextButton.icon(onPressed: () => _openMap(row), icon: const Icon(Icons.map_outlined), label: const Text('Map')), FilledButton.tonal(onPressed: () => _handleRowAction(row, 'verify'), child: const Text('Verify & dispatch'))];
      case 'officer-verification':
      case 'barangay-requests':
        return [TextButton(onPressed: () => _handleRowAction(row, 'reject'), child: const Text('Decline')), FilledButton.tonal(onPressed: () => _handleRowAction(row, 'approve'), child: const Text('Approve'))];
      case 'requests':
        final status = (row['status'] ?? 'pending').toString();
        if (status == 'pending') return [TextButton(onPressed: () => _handleRowAction(row, 'rejected'), child: const Text('Reject')), FilledButton.tonal(onPressed: () => _handleRowAction(row, 'approved'), child: const Text('Approve'))];
        if (status == 'approved') return [FilledButton.tonal(onPressed: () => _handleRowAction(row, 'fulfilled'), child: const Text('Mark fulfilled'))];
        return [];
      case 'responders':
        return [TextButton.icon(onPressed: () => _openMap(row), icon: const Icon(Icons.map_outlined), label: const Text('View location'))];
      case 'stations':
        return [TextButton.icon(onPressed: () => _openMap(row), icon: const Icon(Icons.map_outlined), label: const Text('Map'))];
      case 'broadcasts':
        return [TextButton(onPressed: () => _handleRowAction(row, 'pin'), child: Text(row['is_pinned'] == true ? 'Unpin' : 'Pin')), IconButton(onPressed: () => _handleRowAction(row, 'delete'), icon: const Icon(Icons.delete_outline, color: Colors.redAccent))];
      default:
        return [];
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_modules.isEmpty) return const Scaffold(body: Center(child: Text('Choose the Barangay workspace for barangay accounts.')));
    final module = _module!;
    final user = _user;
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(module.label, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)), Text('${user.fullName} · ${user.role.name.replaceAll('_', ' ')}', style: const TextStyle(fontSize: 11, color: Colors.white70))]),
        actions: [PopupMenuButton<String>(icon: const Icon(Icons.grid_view_rounded), onSelected: (key) { setState(() { _module = _modules.firstWhere((item) => item.key == key); _rows = []; _summary = {}; }); _load(); }, itemBuilder: (_) => _modules.map((item) => PopupMenuItem<String>(value: item.key, child: Row(children: [Icon(item.icon, size: 18), const SizedBox(width: 10), Text(item.label)]))).toList(), tooltip: 'Operations'), IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded), tooltip: 'Refresh')],
      ),
      floatingActionButton: ['users', 'units', 'stations', 'broadcasts'].contains(module.key) ? FloatingActionButton.extended(onPressed: _createForCurrentModule, icon: const Icon(Icons.add), label: Text('Add ${module.key == 'users' ? 'account' : module.key == 'units' ? 'unit' : module.key == 'stations' ? 'station' : 'advisory'}')) : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Card(color: const Color(AppColors.bgSecondary), child: Padding(padding: const EdgeInsets.all(16), child: Row(children: [Icon(module.icon, color: const Color(AppColors.accent), size: 28), const SizedBox(width: 12), Expanded(child: Text(_description(module.key), style: const TextStyle(color: Colors.white70, height: 1.35)))]))),
          if (_summary.isNotEmpty) ...[const SizedBox(height: 8), _summaryCards()],
          if (_loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
          if (!_loading && _rows.isEmpty && _summary.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 48), child: Column(children: [const Icon(Icons.inbox_outlined, size: 44, color: Colors.white38), const SizedBox(height: 12), Text('No ${module.label.toLowerCase()} to show', style: const TextStyle(color: Colors.white70))])),
          ..._rows.map((row) => Card(
            color: const Color(AppColors.bgSecondary),
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(padding: const EdgeInsets.fromLTRB(14, 12, 12, 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [CircleAvatar(backgroundColor: const Color(AppColors.primary).withOpacity(.18), child: Icon(module.icon, color: const Color(AppColors.accent), size: 20)), const SizedBox(width: 11), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(_displayTitle(row), style: const TextStyle(fontWeight: FontWeight.bold)), if (_displaySubtitle(row).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(_displaySubtitle(row), style: const TextStyle(color: Colors.white60, fontSize: 12))), if ((row['description'] ?? row['specifics'] ?? row['content']) != null) Padding(padding: const EdgeInsets.only(top: 7), child: Text('${row['description'] ?? row['specifics'] ?? row['content']}', maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white70, fontSize: 13))) ]))]),
              if (_actionsFor(row).isNotEmpty) Align(alignment: Alignment.centerRight, child: Wrap(spacing: 4, children: _actionsFor(row))),
            ])),
          )),
          const SizedBox(height: 82),
        ]),
      ),
      bottomNavigationBar: SafeArea(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), child: Row(children: [Expanded(child: Text('MDRRMO mobile workspace · ${_modules.length} role tools', style: const TextStyle(color: Colors.white54, fontSize: 11))), TextButton.icon(onPressed: () => _auth.logout(), icon: const Icon(Icons.logout_rounded, size: 17), label: const Text('Sign out'))]))),
    );
  }

  String _description(String key) => switch (key) {
        'incidents' => 'Review municipal incidents. Verification creates responder tasks and starts the dispatch workflow.',
        'responders' => 'See active responders and their latest coordinates. Open a responder location in the map app.',
        'officer-verification' => 'Review responder accounts and approve or decline their verification.',
        'barangay-requests' => 'Review barangay coordination requests. Approval activates access for the barangay team.',
        'users' => 'Create dashboard accounts. Admins can create dispatcher and logistics accounts; Master Admin can also create admins.',
        'requests' => 'Review, approve, reject, and fulfill responder resource requests.',
        'units' => 'Review response units and add new units for operational deployment.',
        'stations' => 'Add an evacuation station and map location. Stations are listed for residents with nearest distance and estimated travel time.',
        'broadcasts' => 'Publish public safety advisories and pin or remove existing advisories.',
        'analytics' => 'Current high-level incident, responder, and task counts for municipal operations.',
        'weather' => 'Current weather and municipal advisories for situational awareness.',
        _ => 'Municipal operations for your account role.',
      };
}
