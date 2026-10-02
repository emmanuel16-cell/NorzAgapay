import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../mdrrmo/core/constants.dart';
import '../mdrrmo/providers/auth_provider.dart';

const _navy = Color(0xFF0C243B);
const _teal = Color(0xFF0D9488);
const _page = Color(0xFFF5F6FA);
const _ink = Color(0xFF0F172A);
const _muted = Color(0xFF64748B);
const _line = Color(0xFFE2E8F0);

class MdrrmoDispatcherScreen extends StatefulWidget {
  const MdrrmoDispatcherScreen({super.key});

  @override
  State<MdrrmoDispatcherScreen> createState() => _MdrrmoDispatcherScreenState();
}

class _MdrrmoDispatcherScreenState extends State<MdrrmoDispatcherScreen> {
  int _tab = 0;
  bool _loading = true;
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _weather = {};

  static const _tabs = [
    (label: 'Incidents', icon: Icons.warning_amber_rounded),
    (label: 'Responders', icon: Icons.my_location_rounded),
    (label: 'Weather', icon: Icons.cloud_rounded),
  ];

  AuthProvider get _auth => Provider.of<AuthProvider>(context, listen: false);
  String get _endpoint => _tab == 0
      ? '/incident-reports'
      : _tab == 1
          ? '/users?role=responder&status=active'
          : '/weather/current';

  Map<String, String> get _headers => {
        'Authorization': 'Bearer ' + (_auth.token ?? ''),
        'ngrok-skip-browser-warning': 'true',
      };

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final response = await http.get(
        Uri.parse(AppConstants.apiBaseUrl + _endpoint),
        headers: _headers,
      );
      final body = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw (body is Map ? body['error'] : null) ?? 'Could not load this section';
      }
      if (!mounted) return;
      setState(() {
        _rows = _extractRows(body);
        _weather = body is Map ? Map<String, dynamic>.from(body) : {};
      });
    } catch (error) {
      if (mounted) _message('Could not load ' + _tabs[_tab].label.toLowerCase() + ': $error', error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _extractRows(dynamic body) {
    if (body is List) return body.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
    if (body is Map) {
      for (final key in ['incidents', 'incident_reports', 'reports', 'users', 'responders', 'data']) {
        final value = body[key];
        if (value is List) return value.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
      }
    }
    return [];
  }

  void _message(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? const Color(0xFFDC2626) : _teal,
      behavior: SnackBarBehavior.floating,
    ));
  }

  Future<void> _openMap(Map<String, dynamic> row) async {
    final latitude = row['latitude'] ?? row['lat'];
    final longitude = row['longitude'] ?? row['lng'];
    if (latitude == null || longitude == null) {
      _message('No location is available for this record', error: true);
      return;
    }
    final uri = Uri.parse('https://www.google.com/maps/search/?api=1&query=' + latitude.toString() + ',' + longitude.toString());
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      _message('Could not open map', error: true);
    }
  }

  Future<void> _verifyIncident(Map<String, dynamic> row) async {
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
    String? type = types.containsKey(row['incident_type']) ? row['incident_type'] as String : null;
    String? severity = severities.containsKey(row['severity']) ? row['severity'] as String : null;
    final proofUrls = row['proof_urls'] is List
        ? (row['proof_urls'] as List).map((value) => value.toString()).toList()
        : row['proof_url'] == null
            ? <String>[]
            : [row['proof_url'].toString()];
    final classification = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Review, classify and dispatch'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text((row['title'] ?? 'Incident report').toString(), style: const TextStyle(fontWeight: FontWeight.bold)),
                if ((row['description'] ?? row['specifics'] ?? '').toString().trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6, bottom: 10),
                    child: Text((row['description'] ?? row['specifics']).toString()),
                  ),
                if (proofUrls.isNotEmpty) ...[
                  const Text('Submitted evidence', style: TextStyle(fontWeight: FontWeight.w600)),
                  Wrap(
                    children: [
                      for (var index = 0; index < proofUrls.length; index++)
                        TextButton.icon(
                          onPressed: () async {
                            final uri = Uri.tryParse(proofUrls[index]);
                            if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
                          },
                          icon: const Icon(Icons.open_in_new, size: 16),
                          label: Text('Evidence ' + (index + 1).toString()),
                        ),
                    ],
                  ),
                ],
                DropdownButtonFormField<String>(
                  value: type,
                  decoration: const InputDecoration(labelText: 'Incident type'),
                  items: types.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
                  onChanged: (value) => setDialogState(() => type = value),
                ),
                DropdownButtonFormField<String>(
                  value: severity,
                  decoration: const InputDecoration(labelText: 'Severity'),
                  items: severities.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
                  onChanged: (value) => setDialogState(() => severity = value),
                ),
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: Text('Review the report, then classify it before dispatching MDRRMO responders.', style: TextStyle(fontSize: 12, color: _muted)),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            FilledButton(
              onPressed: type == null || severity == null
                  ? null
                  : () => Navigator.pop(dialogContext, {'incident_type': type!, 'severity': severity!}),
              child: const Text('Send responders'),
            ),
          ],
        ),
      ),
    );
    if (classification == null) return;
    final id = (row['id'] ?? '').toString();
    if (id.isEmpty) {
      _message('This report has no identifier', error: true);
      return;
    }
    try {
      await _mutate('/incident-reports/' + id + '/verify', classification);
      _message('Incident classified and responders dispatched');
    } catch (error) {
      _message('$error', error: true);
    }
  }

  Future<void> _mutate(String path, Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse(AppConstants.apiBaseUrl + path),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    final result = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw (result is Map ? result['error'] : null) ?? 'Request failed';
    }
    await _load();
  }

  String _title(Map<String, dynamic> row) =>
      (row['title'] ?? row['incident_title'] ?? row['full_name'] ?? row['name'] ?? 'Record').toString();

  String _subtitle(Map<String, dynamic> row) {
    final barangays = row['barangays'];
    final values = [
      row['barangay_name'] ?? (barangays is Map ? barangays['name'] : null),
      row['incident_type'],
      row['severity'],
      row['status'],
      row['unit_type'] ?? row['specialization'],
    ].where((value) => value != null && value.toString().trim().isNotEmpty);
    return values.map((value) => value.toString().replaceAll('_', ' ')).join(' · ');
  }

  bool _closed(Map<String, dynamic> row) {
    final status = (row['status'] ?? '').toString().toLowerCase();
    return {'verified', 'resolved', 'closed', 'cancelled'}.contains(status);
  }

  Widget _incidentCard(Map<String, dynamic> row) => _RecordCard(
        icon: Icons.warning_amber_rounded,
        title: _title(row),
        subtitle: _subtitle(row),
        description: (row['description'] ?? row['specifics'])?.toString(),
        actions: [
          OutlinedButton.icon(onPressed: () => _openMap(row), icon: const Icon(Icons.map_outlined), label: const Text('Map')),
          if (!_closed(row))
            FilledButton.icon(
              onPressed: () => _verifyIncident(row),
              icon: const Icon(Icons.send_rounded, size: 17),
              label: const Text('Verify & dispatch'),
            ),
        ],
      );

  Widget _responderCard(Map<String, dynamic> row) => _RecordCard(
        icon: Icons.person_pin_circle_rounded,
        title: _title(row),
        subtitle: _subtitle(row),
        description: row['unit_name']?.toString(),
        actions: [
          OutlinedButton.icon(onPressed: () => _openMap(row), icon: const Icon(Icons.map_outlined), label: const Text('View location')),
        ],
      );

  List<MapEntry<String, dynamic>> _weatherFields() {
    final data = Map<String, dynamic>.from(_weather);
    for (final key in ['weather', 'current', 'data']) {
      if (data[key] is Map) return Map<String, dynamic>.from(data[key] as Map).entries.toList();
    }
    return data.entries.where((entry) => entry.key != 'success').toList();
  }

  Widget _weatherContent() {
    final fields = _weatherFields();
    if (fields.isEmpty) return const _EmptyState(label: 'Weather information is unavailable');
    const notableKeys = {'temperature', 'temp', 'description', 'condition', 'humidity', 'wind_speed', 'wind', 'location', 'city'};
    final notable = fields.where((entry) => notableKeys.contains(entry.key.toLowerCase())).toList();
    final items = notable.isEmpty ? fields : notable;
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), gradient: const LinearGradient(colors: [_navy, Color(0xFF1B4F72)])),
          child: const Row(
            children: [
              Icon(Icons.cloud_rounded, color: Colors.white, size: 34),
              SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Current conditions', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                    SizedBox(height: 4),
                    Text('Municipal weather and advisories', style: TextStyle(color: Colors.white70)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        for (final entry in items) _WeatherRow(label: entry.key, value: entry.value),
      ],
    );
  }

  Widget _sectionBody() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: _teal));
    if (_tab == 2) return RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [_weatherContent()]));
    if (_rows.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [SizedBox(height: MediaQuery.sizeOf(context).height * .25), const _EmptyState(label: 'Nothing to show right now')],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
        itemCount: _rows.length,
        itemBuilder: (_, index) => _tab == 0 ? _incidentCard(_rows[index]) : _responderCard(_rows[index]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = _auth.user;
    return Scaffold(
      backgroundColor: _page,
      appBar: AppBar(
        backgroundColor: _navy,
        foregroundColor: Colors.white,
        titleSpacing: 18,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_tabs[_tab].label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            Text(user?.fullName ?? 'MDRRMO Dispatcher', style: const TextStyle(fontSize: 11, color: Colors.white70)),
          ],
        ),
        actions: [
          IconButton(onPressed: _load, tooltip: 'Refresh', icon: const Icon(Icons.refresh_rounded)),
          PopupMenuButton<String>(
            tooltip: 'Account',
            onSelected: (value) async {
              if (value == 'signout') await _auth.logout();
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                enabled: false,
                value: 'identity',
                child: Text((user?.role.name.replaceAll('_', ' ') ?? 'Dispatcher') + ' account', style: const TextStyle(color: _muted)),
              ),
              const PopupMenuItem(value: 'signout', child: Text('Sign out')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 13, 16, 14),
            color: Colors.white,
            child: Row(
              children: [
                Icon(_tabs[_tab].icon, color: _teal, size: 21),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    _tab == 0
                        ? 'Review municipal reports and dispatch responders.'
                        : _tab == 1
                            ? 'See active responders and open their latest location.'
                            : 'Check current weather conditions for situational awareness.',
                    style: const TextStyle(color: _muted, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
          Expanded(child: _sectionBody()),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFF64D2B4), width: 1.5)),
          boxShadow: [BoxShadow(color: Color(0x0D000000), blurRadius: 10, offset: Offset(0, -3))],
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 62,
            child: Row(
              children: [
                for (var index = 0; index < _tabs.length; index++)
                  Expanded(
                    child: _DispatcherNavButton(
                      icon: _tabs[index].icon,
                      label: _tabs[index].label,
                      active: _tab == index,
                      onTap: () {
                        if (_tab == index) {
                          _load();
                          return;
                        }
                        setState(() {
                          _tab = index;
                          _rows = [];
                          _weather = {};
                        });
                        _load();
                      },
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DispatcherNavButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _DispatcherNavButton({required this.icon, required this.label, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: active ? _teal : _muted, size: 22),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 10, color: active ? _teal : _muted, fontWeight: active ? FontWeight.bold : FontWeight.normal)),
          ],
        ),
      );
}

class _RecordCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String? description;
  final List<Widget> actions;
  const _RecordCard({required this.icon, required this.title, required this.subtitle, required this.actions, this.description});

  @override
  Widget build(BuildContext context) => Card(
        color: Colors.white,
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 11),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15), side: const BorderSide(color: _line)),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 12, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(backgroundColor: const Color(0xFFE6F6F3), child: Icon(icon, color: _teal, size: 21)),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: const TextStyle(color: _ink, fontWeight: FontWeight.bold, fontSize: 15)),
                        if (subtitle.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(subtitle, style: const TextStyle(color: _muted, fontSize: 12)),
                        ],
                        if (description != null && description!.trim().isNotEmpty) ...[
                          const SizedBox(height: 7),
                          Text(description!, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: _ink, fontSize: 13, height: 1.35)),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              if (actions.isNotEmpty)
                Align(alignment: Alignment.centerRight, child: Wrap(spacing: 7, runSpacing: 4, children: actions)),
            ],
          ),
        ),
      );
}

class _WeatherRow extends StatelessWidget {
  final String label;
  final dynamic value;
  const _WeatherRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final readableLabel = label.replaceAll('_', ' ').replaceAllMapped(RegExp(r'([A-Z])'), (match) => ' ' + match[1]!).trim();
    final readableValue = value is Map || value is List ? jsonEncode(value) : '$value';
    return Card(
      color: Colors.white,
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: _line)),
      child: ListTile(
        title: Text(readableLabel, style: const TextStyle(color: _muted, fontSize: 12)),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(readableValue, style: const TextStyle(color: _ink, fontSize: 15, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String label;
  const _EmptyState({required this.label});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.inbox_outlined, color: Color(0xFF94A3B8), size: 46),
            const SizedBox(height: 11),
            Text(label, textAlign: TextAlign.center, style: const TextStyle(color: _muted, fontSize: 14)),
          ],
        ),
      );
}
