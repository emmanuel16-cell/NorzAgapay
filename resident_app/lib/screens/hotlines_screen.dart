import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import '../core/constants.dart';
import '../core/phone_number_utils.dart';
import '../services/offline_service.dart';
import '../widgets/resident_gradient_app_bar.dart';

class HotlinesScreen extends StatefulWidget {
  const HotlinesScreen({super.key});

  @override
  State<HotlinesScreen> createState() => _HotlinesScreenState();
}

class _HotlinesScreenState extends State<HotlinesScreen> {
  // Barangay names are used for the dropdown; contact numbers come from the
  // shared hotline settings maintained by the barangay dispatcher.
  List<Map<String, dynamic>> _barangayHotlines = [];
  String _selectedBarangay = '';
  final Map<String, String> _barangayIds = {};
  List<Map<String, dynamic>> _hotlineEntries = [];
  bool _loadingHotlines = false;
  bool _hotlinesOffline = false;
  bool _hotlineLoadFailed = false;
  String? _hotlinesCachedAt;
  int _hotlineRequest = 0;

  @override
  void initState() {
    super.initState();
    final profile = OfflineService.getProfile();
    final savedBarangay = profile?['barangay_name'] as String?;
    final verified = OfflineService.getCachedBarangays()
        .where((barangay) => barangay['is_verified'] == true)
        .toList();
    _applyVerifiedBarangays(verified, preferredName: savedBarangay);
    _loadHotlines();
    _refreshBarangays();
  }

  String _normalizeBarangay(String? name) => (name ?? '')
      .toLowerCase()
      .replaceAll(RegExp(r'\s*\([^)]*\)'), '')
      .replaceAll(RegExp(r'[^a-z0-9]'), '');

  void _setBarangayIds(List<Map<String, dynamic>> barangays) {
    _barangayIds.clear();
    for (final barangay in barangays) {
      final name = barangay['name']?.toString();
      final id = barangay['id']?.toString();
      if (name != null && id != null) {
        final normalized = _normalizeBarangay(name);
        _barangayIds[normalized] = id;
        if (normalized == 'friendshipvillage') _barangayIds['fvr'] = id;
      }
    }
  }

  void _applyVerifiedBarangays(List<Map<String, dynamic>> barangays, {String? preferredName}) {
    _barangayHotlines = barangays.where((barangay) => barangay['is_verified'] == true).toList();
    _setBarangayIds(_barangayHotlines);
    final preferred = _barangayHotlines.where(
      (barangay) => _normalizeBarangay(barangay['name']) == _normalizeBarangay(preferredName),
    );
    if (preferred.isNotEmpty) {
      _selectedBarangay = preferred.first['name'].toString();
    } else if (!_barangayHotlines.any((barangay) => barangay['name'] == _selectedBarangay)) {
      _selectedBarangay = _barangayHotlines.isEmpty ? '' : _barangayHotlines.first['name'].toString();
    }
  }

  Future<void> _refreshBarangays() async {
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/barangay/list?verified_only=true'),
        headers: const {'ngrok-skip-browser-warning': 'true'},
      ).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return;
      final rows = (jsonDecode(response.body) as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .where((barangay) => barangay['is_verified'] == true)
          .toList();
      await OfflineService.saveBarangays(rows);
      if (!mounted) return;
      setState(() => _applyVerifiedBarangays(rows, preferredName: OfflineService.getProfile()?['barangay_name']?.toString()));
      _loadHotlines();
    } catch (error) {
      debugPrint('Could not refresh barangay list: $error');
    }
  }

  Future<void> _loadHotlines() async {
    final request = ++_hotlineRequest;
    final id = _barangayIds[_normalizeBarangay(_selectedBarangay)];
    if (mounted) setState(() { _loadingHotlines = true; _hotlineEntries = []; });
    if (id == null) {
      if (mounted && request == _hotlineRequest) setState(() => _loadingHotlines = false);
      return;
    }
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/barangay/hotlines/$id'),
        headers: const {'ngrok-skip-browser-warning': 'true'},
      ).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) throw Exception('HTTP ${response.statusCode}');
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final entries = (data['entries'] as List? ?? const [])
          .map((entry) => Map<String, dynamic>.from(entry as Map))
          .toList();
      if (mounted && request == _hotlineRequest) {
        setState(() {
          _hotlineEntries = entries;
          _loadingHotlines = false;
          _hotlinesOffline = false;
          _hotlineLoadFailed = false;
        });
      }
    } catch (error) {
      debugPrint('Could not load hotline contacts: $error');
      if (mounted && request == _hotlineRequest) {
        final cached = OfflineService.getCachedBarangayHotlines()[id];
        setState(() {
          _hotlineEntries = cached ?? [];
          _loadingHotlines = false;
          _hotlinesOffline = cached != null;
          _hotlineLoadFailed = cached == null;
          _hotlinesCachedAt = OfflineService.getBarangayHotlineCacheTime();
        });
      }
    }
  }

  Future<void> _reloadAllHotlines() async {
    setState(() => _loadingHotlines = true);
    try {
      final barangayResponse = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/barangay/list?verified_only=true'),
        headers: const {'ngrok-skip-browser-warning': 'true'},
      ).timeout(const Duration(seconds: 8));
      if (barangayResponse.statusCode != 200) {
        throw Exception('Could not load barangays (${barangayResponse.statusCode})');
      }
      final barangays = (jsonDecode(barangayResponse.body) as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .where((barangay) => barangay['is_verified'] == true)
          .toList();
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/barangay/hotlines'),
        headers: const {'ngrok-skip-browser-warning': 'true'},
      ).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) {
        throw Exception('Could not load hotline contacts (${response.statusCode})');
      }
      final rows = (jsonDecode(response.body) as List)
          .map((row) => Map<String, dynamic>.from(row as Map));
      final byBarangay = <String, dynamic>{};
      for (final row in rows) {
        byBarangay[row['barangay_id'].toString()] = row['hotlines'] ?? [];
      }
      for (final barangay in barangays) {
        byBarangay.putIfAbsent(barangay['id'].toString(), () => <dynamic>[]);
      }
      await OfflineService.saveBarangays(barangays);
      await OfflineService.saveBarangayHotlines(byBarangay);
      if (!mounted) return;
      setState(() {
        _applyVerifiedBarangays(barangays, preferredName: OfflineService.getProfile()?['barangay_name']?.toString());
        _hotlinesOffline = false;
        _hotlineLoadFailed = false;
        _hotlinesCachedAt = OfflineService.getBarangayHotlineCacheTime();
      });
      _loadHotlines();
    } catch (error) {
      if (mounted) {
        setState(() => _loadingHotlines = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not reload hotline contacts: $error')),
        );
      }
    }
  }

  Future<void> _launch(String urlString) async {
    final Uri url = Uri.parse(urlString);
    try {
      if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
        debugPrint('Could not launch $urlString');
      }
    } catch (e) {
      debugPrint('Launch error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedEntries = _barangayHotlines.where((b) => b['name'] == _selectedBarangay);
    final selectedInfo = selectedEntries.isEmpty
        ? <String, dynamic>{'name': 'No verified barangays'}
        : selectedEntries.first;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: ResidentGradientAppBar(
        title: const Text(
          'Emergency Hotlines',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 19),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── 1. National Emergency Hotline 911 ────────────────────────────
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFDC2626), Color(0xFFB91C1C)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(18),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFDC2626).withValues(alpha: 0.35),
                    blurRadius: 14,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.emergency_share_rounded,
                          color: Colors.white,
                          size: 32,
                        ),
                      ),
                      const SizedBox(width: 16),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'NATIONAL EMERGENCY',
                              style: TextStyle(
                                color: Colors.white70,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 1.1,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Dial 911',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 26,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Toll-Free Nationwide 24/7 Dispatch',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 11.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton.icon(
                      onPressed: () => _launch('tel:911'),
                      icon: const Icon(Icons.call_rounded, size: 20),
                      label: const Text('Call 911'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: const Color(0xFFDC2626),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        elevation: 0,
                        textStyle: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // ── 2. MDRRMO Norzagaray Section (Exact img 3 button styles) ───────
            _buildSectionHeader(
              title: 'MDRRMO Norzagaray',
              badge: 'Municipal Command Desk',
              color: const Color(0xFF1B4F72),
            ),
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE2E8F0)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.03),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Municipal Disaster Risk Reduction & Management Office (Rescue Ng Garay)',
                    style: TextStyle(fontSize: 13, color: Color(0xFF475569), height: 1.35),
                  ),
                  const SizedBox(height: 14),

                  // Image 3 buttons rendered exactly matching the user screenshot:
                  SizedBox(
                    width: double.infinity,
                    child: Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      alignment: WrapAlignment.center,
                      children: [
                        // Button 1: Call MDRRMO Hotline (light mint/green bg)
                        _Image3Button(
                          icon: Icons.phone_rounded,
                          label: 'Call MDRRMO Hotline',
                          backgroundColor: const Color(0xFFE6F4EA), // exact soft mint green from img 3
                          foregroundColor: const Color(0xFF1E8E3E), // vibrant green text & icon
                          onTap: () => _launch('tel:09052470355'),
                        ),

                        // Button 2: Rescue Ng Garay (light baby blue bg)
                        _Image3Button(
                          icon: Icons.facebook_rounded,
                          label: 'Rescue Ng Garay',
                          backgroundColor: const Color(0xFFE8F2FE), // soft blue from img 3
                          foregroundColor: const Color(0xFF1A73E8), // facebook blue text & icon
                          onTap: () => _launch('https://www.facebook.com/RescueNgGaray'),
                        ),

                        // Button 3: Email MDRRMO (light slate/blue bg)
                        _Image3Button(
                          icon: Icons.mail_rounded,
                          label: 'Email MDRRMO',
                          backgroundColor: const Color(0xFFE8EEF5), // soft grayish slate blue from img 3
                          foregroundColor: const Color(0xFF1B4F72), // deep navy/blue from img 3
                          onTap: () => _launch('mailto:norzagarayrescue2015@gmail.com'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Divider(height: 16),
                  const Row(
                    children: [
                      Icon(Icons.info_outline, size: 14, color: Color(0xFF64748B)),
                      SizedBox(width: 6),
                      Text(
                        'Direct Mobile: 0905-247-0355',
                        style: TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),

            // ── 3. Norzagaray Philippine National Police (PNP) ────────────────
            _buildSectionHeader(
              title: 'Philippine National Police (PNP)',
              badge: 'Norzagaray Station',
              color: const Color(0xFF1E3A8A),
            ),
            const SizedBox(height: 10),
            _ContactCard(
              icon: Icons.local_police_rounded,
              iconColor: const Color(0xFF1E3A8A),
              title: 'Norzagaray Municipal Police Station',
              primaryNumber: '0998-598-5389',
              description: 'Patrol base, criminal emergency, and 24/7 law enforcement assistance.',
              onCallPrimary: () => _launch('tel:09985985389'),
            ),
            const SizedBox(height: 22),

            // ── 4. Norzagaray Bureau of Fire Protection (BFP) ─────────────────
            _buildSectionHeader(
              title: 'Bureau of Fire Protection (BFP)',
              badge: 'Norzagaray Fire Station',
              color: const Color(0xFFEA580C),
            ),
            const SizedBox(height: 10),
            _ContactCard(
              icon: Icons.local_fire_department_rounded,
              iconColor: const Color(0xFFEA580C),
              title: 'Norzagaray Fire Station',
              primaryNumber: '0943-348-1854',
              description: 'Fire suppression, hazardous materials containment, and search & rescue.',
              onCallPrimary: () => _launch('tel:09433481854'),
            ),
            const SizedBox(height: 24),

            // ── 5. Barangay Hotlines Dropdown & Status ────────────────────────
            _buildSectionHeader(
              title: 'Barangay Emergency Hotline',
              badge: '13 Barangays',
              color: const Color(0xFF0D9488),
              action: IconButton(
                tooltip: 'Reload all hotlines and save for offline use',
                onPressed: _loadingHotlines ? null : _reloadAllHotlines,
                icon: const Icon(Icons.refresh_rounded, color: Color(0xFF0D9488)),
              ),
            ),
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Select your Barangay to view hotline contacts:',
                    style: TextStyle(fontSize: 12.5, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 10),

                  // Barangay Dropdown
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFCBD5E1)),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _selectedBarangay.isEmpty ? null : _selectedBarangay,
                        isExpanded: true,
                        icon: const Icon(Icons.arrow_drop_down, color: Color(0xFF1B4F72)),
                        items: _barangayHotlines.map((b) {
                          return DropdownMenuItem<String>(
                            value: b['name'] as String,
                            child: Row(
                              children: [
                                const Icon(Icons.location_city_rounded, size: 18, color: Color(0xFF1B4F72)),
                                const SizedBox(width: 8),
                                Text(
                                  'Barangay ${b['name']}',
                                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                        onChanged: _barangayHotlines.isEmpty ? null : (val) {
                          if (val != null) {
                            setState(() => _selectedBarangay = val);
                            _loadHotlines();
                          }
                        },
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  if (_barangayHotlines.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 14),
                      child: Text('No MDRRMO-verified barangays are available yet.'),
                    ),

                  // Display selected barangay dispatcher & hotline info
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              'Barangay ${selectedInfo['name']}',
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: const Color(0xFFFCD34D)),
                              ),
                              child: Text(
                                _loadingHotlines
                                    ? 'Loading'
                                    : _hotlinesOffline
                                        ? 'Offline'
                                        : (_hotlineEntries.isEmpty ? 'No contacts yet' : 'Available'),
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFFB45309),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        if (_loadingHotlines)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            child: Center(child: CircularProgressIndicator()),
                          )
                        else if (_hotlineEntries.isEmpty)
                          Text(
                            _hotlineLoadFailed
                                ? 'Could not load hotline numbers. Connect to the internet and tap reload to save all barangay contacts for offline use.'
                                : 'No hotline numbers have been added for this barangay yet.',
                            style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                          )
                        else
                          ..._hotlineEntries.expand((entry) {
                            final purpose = entry['purpose']?.toString() ?? 'Hotline';
                            final numbers = (entry['numbers'] as List? ?? const [])
                                .map((number) => number.toString()).toList();
                            return [
                              Padding(
                                padding: const EdgeInsets.only(top: 10, bottom: 6),
                                child: Text(purpose, style: const TextStyle(fontWeight: FontWeight.w600)),
                              ),
                              SizedBox(
                                width: double.infinity,
                                child: Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  alignment: WrapAlignment.center,
                                  children: numbers.map((number) => ElevatedButton.icon(
                                    onPressed: () => _launch('tel:${number.replaceAll(RegExp(r'[^0-9+]'), '')}'),
                                    icon: const Icon(Icons.phone_rounded, size: 18),
                                    label: Text('Mobile: ${PhoneNumberUtils.formatForDisplay(number)}'),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFFE6F4EA),
                                      foregroundColor: const Color(0xFF0D9488),
                                      elevation: 0,
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                                      textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                    ),
                                  )).toList(),
                                ),
                              ),
                            ];
                          }),
                      ],
                    ),
                  ),
                  if (_hotlinesCachedAt != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _hotlinesOffline
                          ? 'Showing offline hotline data saved ${_formatCacheTime(_hotlinesCachedAt!)}.'
                          : 'Reload saves all barangay hotline contacts for offline use.',
                      style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader({
    required String title,
    required String badge,
    required Color color,
    Widget? action,
  }) {
    return Row(
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: Color(0xFF0F172A),
          ),
        ),
        const Spacer(),
        if (action != null) action,
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            badge,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ),
      ],
    );
  }

  String _formatCacheTime(String timestamp) {
    final date = DateTime.tryParse(timestamp)?.toLocal();
    if (date == null) return 'previously';
    return '${date.month}/${date.day}/${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
}

// ── Contact Card for PNP & BFP ───────────────────────────────────────────────
class _ContactCard extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String primaryNumber;
  final String description;
  final VoidCallback onCallPrimary;

  const _ContactCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.primaryNumber,
    required this.description,
    required this.onCallPrimary,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: iconColor, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: Center(
              child: ElevatedButton.icon(
                onPressed: onCallPrimary,
                icon: const Icon(Icons.phone_rounded, size: 18),
                label: Text('Mobile: ${PhoneNumberUtils.formatForDisplay(primaryNumber)}'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: iconColor.withValues(alpha: 0.1),
                  foregroundColor: iconColor,
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                  textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Image 3 Button Widget ───────────────────────────────────────────────────
class _Image3Button extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color backgroundColor;
  final Color foregroundColor;
  final VoidCallback onTap;

  const _Image3Button({
    required this.icon,
    required this.label,
    required this.backgroundColor,
    required this.foregroundColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: backgroundColor,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: foregroundColor, size: 20),
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  color: foregroundColor,
                  fontWeight: FontWeight.w600,
                  fontSize: 14.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
