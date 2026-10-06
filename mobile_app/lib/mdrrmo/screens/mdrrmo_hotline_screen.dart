import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../core/constants.dart';
import '../../core/phone_number_utils.dart';

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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final responses = await Future.wait([
        http.get(
          Uri.parse('${AppConstants.apiBaseUrl}/barangay/list'),
          headers: const {'ngrok-skip-browser-warning': 'true'},
        ),
        http.get(
          Uri.parse('${AppConstants.apiBaseUrl}/barangay/hotlines'),
          headers: const {'ngrok-skip-browser-warning': 'true'},
        ),
      ]).timeout(const Duration(seconds: 12));
      if (responses[0].statusCode != 200 || responses[1].statusCode != 200)
        throw Exception('Could not load hotline directory');
      final barangayData = jsonDecode(responses[0].body);
      final barangays = barangayData is List
          ? barangayData
          : (barangayData['barangays'] as List? ?? const []);
      final names = <String, String>{};
      for (final row in barangays.whereType<Map>()) {
        names[row['id']?.toString() ?? ''] =
            row['name']?.toString() ?? 'Barangay';
      }
      final rows = jsonDecode(responses[1].body) as List;
      final entries = <Map<String, dynamic>>[];
      for (final row in rows.whereType<Map>()) {
        final barangayId = row['barangay_id']?.toString() ?? '';
        final rawHotlines = row['hotlines'];
        if (rawHotlines is! List) continue;
        for (final item in rawHotlines.whereType<Map>()) {
          final numbers = (item['numbers'] as List? ?? const [])
              .map((value) => value.toString())
              .where((value) => value.trim().isNotEmpty)
              .toList();
          if (numbers.isEmpty) continue;
          entries.add({
            'barangay': names[barangayId] ?? 'Barangay',
            'purpose': item['purpose']?.toString() ?? 'Emergency hotline',
            'numbers': numbers,
          });
        }
      }
      if (mounted)
        setState(() {
          _hotlines = entries;
          _loading = false;
        });
    } catch (error) {
      if (mounted)
        setState(() {
          _error = error.toString();
          _loading = false;
        });
    }
  }

  Future<void> _call(String value) async {
    final number = value.replaceAll(RegExp(r'[^0-9+]'), '');
    final uri = Uri(scheme: 'tel', path: number);
    await _launch(uri);
  }

  Future<void> _launch(Uri uri) async {
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
          mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              uri.scheme == 'tel'
                  ? 'Calling is not available on this device.'
                  : 'Unable to open that link.',
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              uri.scheme == 'tel'
                  ? 'Calling is not available on this device.'
                  : 'Unable to open that link.',
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final byBarangay = <String, List<Map<String, dynamic>>>{};
    for (final entry in _hotlines) {
      final barangay = entry['barangay']?.toString() ?? 'Barangay';
      byBarangay.putIfAbsent(barangay, () => []).add(entry);
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FB),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        flexibleSpace: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
        title: const Text(
          'Emergency Hotlines',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh hotline directory',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
          children: [
            _nationalEmergencyCard(),
            const SizedBox(height: 20),
            _sectionHeader(
              'MDRRMO Norzagaray',
              'Municipal Command Desk',
              const Color(0xFF1B4F72),
            ),
            const SizedBox(height: 10),
            _mdrrmoCard(),
            const SizedBox(height: 22),
            _sectionHeader(
              'Philippine National Police (PNP)',
              'Norzagaray Station',
              const Color(0xFF1E3A8A),
            ),
            const SizedBox(height: 10),
            _contactCard(
              icon: Icons.local_police_rounded,
              color: const Color(0xFF1E3A8A),
              title: 'Norzagaray Municipal Police Station',
              description:
                  'Patrol base, criminal emergency, and 24/7 law enforcement assistance.',
              number: '0998-598-5389',
            ),
            const SizedBox(height: 22),
            _sectionHeader(
              'Bureau of Fire Protection (BFP)',
              'Norzagaray Fire Station',
              const Color(0xFFEA580C),
            ),
            const SizedBox(height: 10),
            _contactCard(
              icon: Icons.local_fire_department_rounded,
              color: const Color(0xFFEA580C),
              title: 'Norzagaray Fire Station',
              description:
                  'Fire suppression, hazardous materials containment, and search & rescue.',
              number: '0943-348-1854',
            ),
            const SizedBox(height: 24),
            _sectionHeader(
              'Barangay Emergency Hotline',
              _loading ? 'Updating' : '${byBarangay.length} Barangays',
              const Color(0xFF0D9488),
            ),
            const SizedBox(height: 10),
            if (_loading)
              _directoryMessage(
                child: const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 14),
                    child: CircularProgressIndicator(color: Color(0xFF0D9488)),
                  ),
                ),
              )
            else if (_error != null)
              _directoryMessage(
                child: Column(
                  children: [
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Color(0xFF64748B)),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Try again'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF0D9488),
                      ),
                    ),
                  ],
                ),
              )
            else if (byBarangay.isEmpty)
              _directoryMessage(
                child: const Row(
                  children: [
                    Icon(
                      Icons.phone_disabled_rounded,
                      color: Color(0xFF94A3B8),
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'No published hotline numbers yet.',
                        style: TextStyle(color: Color(0xFF64748B)),
                      ),
                    ),
                  ],
                ),
              )
            else
              ...byBarangay.entries.expand(
                (barangay) => [
                  Padding(
                    padding: const EdgeInsets.only(top: 2, bottom: 8),
                    child: _sectionHeader(
                      'Barangay ${barangay.key}',
                      '${barangay.value.length} ${barangay.value.length == 1 ? 'Contact' : 'Contacts'}',
                      const Color(0xFF0D9488),
                    ),
                  ),
                  ...barangay.value.map(_hotlineCard),
                  const SizedBox(height: 12),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _nationalEmergencyCard() => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [Color(0xFFDC2626), Color(0xFFB91C1C)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(16),
      boxShadow: [
        BoxShadow(
          color: const Color(0xFFDC2626).withValues(alpha: .25),
          blurRadius: 14,
          offset: const Offset(0, 6),
        ),
      ],
    ),
    child: Column(
      children: [
        const Row(
          children: [
            CircleAvatar(
              radius: 25,
              backgroundColor: Color(0x44FFFFFF),
              child: Icon(
                Icons.emergency_share_rounded,
                color: Colors.white,
                size: 28,
              ),
            ),
            SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'NATIONAL EMERGENCY',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      letterSpacing: .8,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Dial 911',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Toll-Free Nationwide 24/7 Dispatch',
                    style: TextStyle(color: Colors.white, fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          height: 46,
          child: ElevatedButton.icon(
            onPressed: () => _call('911'),
            icon: const Icon(Icons.call_rounded, size: 18),
            label: const Text('Call 911'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: const Color(0xFFDC2626),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              textStyle: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _sectionHeader(String title, String badge, Color color) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.bold,
          color: Color(0xFF0F172A),
        ),
      ),
      const SizedBox(height: 3),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          badge,
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
      ),
    ],
  );

  Widget _mdrrmoCard() => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(14),
    decoration: _cardDecoration(),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Municipal Disaster Risk Reduction & Management Office (Rescue Ng Garay)',
          style: TextStyle(
            fontSize: 12,
            color: Color(0xFF475569),
            height: 1.35,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: WrapAlignment.center,
          children: [
            _actionChip(
              Icons.phone_rounded,
              'Call MDRRMO Hotline',
              const Color(0xFFE6F4EA),
              const Color(0xFF1E8E3E),
              () => _call('0905-247-0355'),
            ),
            _actionChip(
              Icons.facebook_rounded,
              'Rescue Ng Garay',
              const Color(0xFFE8F2FE),
              const Color(0xFF1A73E8),
              () =>
                  _launch(Uri.parse('https://www.facebook.com/RescueNgGaray')),
            ),
            _actionChip(
              Icons.mail_rounded,
              'Email MDRRMO',
              const Color(0xFFE8EEF5),
              const Color(0xFF1B4F72),
              () => _launch(
                Uri(scheme: 'mailto', path: 'norzagarayrescue2015@gmail.com'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        const Divider(height: 14),
        const Row(
          children: [
            Icon(Icons.info_outline, size: 14, color: Color(0xFF64748B)),
            SizedBox(width: 6),
            Text(
              'Direct Mobile: 0905-247-0355',
              style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _contactCard({
    required IconData icon,
    required Color color,
    required String title,
    required String description,
    required String number,
  }) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(14),
    decoration: _cardDecoration(),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: color.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    description,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF64748B),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Center(
          child: _actionChip(
            Icons.phone_rounded,
            'Mobile: ${PhoneNumberUtils.formatForDisplay(number)}',
            color.withValues(alpha: .1),
            color,
            () => _call(number),
          ),
        ),
      ],
    ),
  );

  Widget _actionChip(
    IconData icon,
    String label,
    Color background,
    Color foreground,
    VoidCallback onPressed,
  ) => ElevatedButton.icon(
    onPressed: onPressed,
    icon: Icon(icon, size: 16),
    label: Text(label),
    style: ElevatedButton.styleFrom(
      backgroundColor: background,
      foregroundColor: foreground,
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
      textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
    ),
  );

  Widget _directoryMessage({required Widget child}) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: _cardDecoration(),
    child: child,
  );

  Widget _hotlineCard(Map<String, dynamic> entry) {
    final purpose = entry['purpose']?.toString() ?? 'Emergency hotline';
    final numbers = (entry['numbers'] as List? ?? const [])
        .map((value) => value.toString())
        .toList();

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: const Color(0xFFE6F4EA),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.phone_in_talk_rounded,
                  color: Color(0xFF0D9488),
                  size: 21,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    purpose,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (numbers.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: numbers.map((number) => _callChip(number)).toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _callChip(String number) => ElevatedButton.icon(
    onPressed: () => _call(number),
    icon: const Icon(Icons.call_rounded, size: 15),
    label: Text('Mobile: ${PhoneNumberUtils.formatForDisplay(number)}'),
    style: ElevatedButton.styleFrom(
      backgroundColor: const Color(0xFFE6F4EA),
      foregroundColor: const Color(0xFF0D9488),
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
      textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
    ),
  );

  BoxDecoration _cardDecoration() => BoxDecoration(
    color: Colors.white,
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: const Color(0xFFE2E8F0)),
    boxShadow: [
      BoxShadow(
        color: Colors.black.withValues(alpha: .03),
        blurRadius: 10,
        offset: const Offset(0, 4),
      ),
    ],
  );
}
