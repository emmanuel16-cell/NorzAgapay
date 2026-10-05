import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../core/constants.dart';

class MdrrmoHotlineScreen extends StatefulWidget {
  const MdrrmoHotlineScreen({super.key});

  @override
  State<MdrrmoHotlineScreen> createState() => _MdrrmoHotlineScreenState();
}

class _MdrrmoHotlineScreenState extends State<MdrrmoHotlineScreen> {
  List<Map<String, dynamic>> _hotlines = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final responses = await Future.wait([
        http.get(Uri.parse('${AppConstants.apiBaseUrl}/barangay/list'), headers: const {'ngrok-skip-browser-warning': 'true'}),
        http.get(Uri.parse('${AppConstants.apiBaseUrl}/barangay/hotlines'), headers: const {'ngrok-skip-browser-warning': 'true'}),
      ]).timeout(const Duration(seconds: 12));
      if (responses[0].statusCode != 200 || responses[1].statusCode != 200) throw Exception('Could not load hotline directory');
      final barangayData = jsonDecode(responses[0].body);
      final barangays = barangayData is List ? barangayData : (barangayData['barangays'] as List? ?? const []);
      final names = <String, String>{};
      for (final row in barangays.whereType<Map>()) {
        names[row['id']?.toString() ?? ''] = row['name']?.toString() ?? 'Barangay';
      }
      final rows = jsonDecode(responses[1].body) as List;
      final entries = <Map<String, dynamic>>[];
      for (final row in rows.whereType<Map>()) {
        final barangayId = row['barangay_id']?.toString() ?? '';
        final rawHotlines = row['hotlines'];
        if (rawHotlines is! List) continue;
        for (final item in rawHotlines.whereType<Map>()) {
          final numbers = (item['numbers'] as List? ?? const []).map((value) => value.toString()).where((value) => value.trim().isNotEmpty).toList();
          if (numbers.isEmpty) continue;
          entries.add({'barangay': names[barangayId] ?? 'Barangay', 'purpose': item['purpose']?.toString() ?? 'Emergency hotline', 'numbers': numbers});
        }
      }
      if (mounted) setState(() { _hotlines = entries; _loading = false; });
    } catch (error) {
      if (mounted) setState(() { _error = error.toString(); _loading = false; });
    }
  }

  Future<void> _call(String value) async {
    final number = value.replaceAll(RegExp(r'[^0-9+]'), '');
    final uri = Uri(scheme: 'tel', path: number);
    if (!await launchUrl(uri)) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Calling is not available on this device.')));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F6FA),
    appBar: AppBar(
      backgroundColor: const Color(0xFF0C243B),
      foregroundColor: Colors.white,
      title: const Text('Emergency Hotlines', style: TextStyle(fontWeight: FontWeight.bold)),
      actions: [IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh_rounded))],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator(color: Color(0xFF0D9488)))
        : _error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(_error!, textAlign: TextAlign.center), const SizedBox(height: 12), FilledButton(onPressed: _load, child: const Text('Try again'))])))
            : RefreshIndicator(
                onRefresh: _load,
                child: _hotlines.isEmpty
                    ? ListView(children: const [SizedBox(height: 170), Icon(Icons.phone_disabled_rounded, size: 50, color: Color(0xFF94A3B8)), SizedBox(height: 12), Center(child: Text('No published hotline numbers', style: TextStyle(color: Color(0xFF64748B))))])
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _hotlines.length,
                        itemBuilder: (context, index) {
                          final entry = _hotlines[index];
                          final numbers = (entry['numbers'] as List).cast<String>();
                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE2E8F0))),
                            child: Padding(
                              padding: const EdgeInsets.all(15),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(entry['purpose'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFF0F172A))),
                                const SizedBox(height: 3),
                                Text(entry['barangay'] as String, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
                                const SizedBox(height: 9),
                                for (final number in numbers)
                                  ListTile(
                                    dense: true,
                                    contentPadding: EdgeInsets.zero,
                                    leading: const Icon(Icons.phone_in_talk_rounded, color: Color(0xFF0D9488)),
                                    title: Text(number, style: const TextStyle(fontWeight: FontWeight.w600)),
                                    trailing: IconButton(onPressed: () => _call(number), icon: const Icon(Icons.call_rounded, color: Color(0xFF0284C7))),
                                  ),
                              ]),
                            ),
                          );
                        },
                      ),
              ),
  );
}
