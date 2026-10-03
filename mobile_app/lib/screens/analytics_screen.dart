import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import 'report_statistics_screen.dart';

class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  bool _loading = true;
  String? _error;
  int _posts = 0;
  int _stations = 0;
  int _teamMembers = 0;
  Map<String, dynamic> _reportStatistics = const {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final auth = context.read<AuthService>();
    if (auth.token == null || auth.currentUser == null) return;
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        ApiService.getBroadcasts(auth.token!),
        ApiService.getEvacuationCenters(auth.token!, barangayId: auth.currentUser!.barangayId),
        ApiService.getTeam(auth.token!),
        ApiService.getReportStatistics(auth.token!),
      ]);
      if (!mounted) return;
      setState(() {
        _posts = (results[0] as List).length;
        _stations = (results[1] as List).length;
        _teamMembers = (results[2] as List).length;
        _reportStatistics = results[3] as Map<String, dynamic>;
        _loading = false;
      });
    } catch (error) {
      if (mounted) setState(() { _error = error.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F6FA),
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          foregroundColor: Colors.white,
          flexibleSpace: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
          ),
          title: const Text('Barangay Analytics'),
          actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded))],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Text('Unable to load analytics: $_error'))
                : ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      const Text('Barangay overview', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 14),
                      _reportTimingCard(),
                      _metric('Published posts', _posts, Icons.campaign_rounded, const Color(0xFF0284C7)),
                      _metric('Evacuation stations', _stations, Icons.location_city_rounded, const Color(0xFF0D9488)),
                      _metric('Barangay team accounts', _teamMembers, Icons.groups_rounded, const Color(0xFF7C3AED)),
                    ],
                  ),
      );

  Widget _reportTimingCard() {
    final averages = _reportStatistics['averages'] is Map
        ? Map<String, dynamic>.from(_reportStatistics['averages'] as Map)
        : <String, dynamic>{};
    final response = averages['response'] is Map ? Map<String, dynamic>.from(averages['response'] as Map) : <String, dynamic>{};
    final arrival = averages['arrival'] is Map ? Map<String, dynamic>.from(averages['arrival'] as Map) : <String, dynamic>{};
    final resolution = averages['resolution'] is Map ? Map<String, dynamic>.from(averages['resolution'] as Map) : <String, dynamic>{};
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Expanded(child: Text('Report timing averages', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)))),
            TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReportStatisticsScreen())), child: const Text('View all')),
          ]),
          Text('${_reportStatistics['report_count'] ?? 0} resolved reports · includes cases handled by MDRRMO', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
          const SizedBox(height: 10),
          _timingLine('Average response time', response),
          _timingLine('Average arrival time', arrival),
          _timingLine('Average resolution time', resolution),
        ]),
      ),
    );
  }

  Widget _timingLine(String label, Map<String, dynamic> stage) {
    final seconds = (stage['average_seconds'] as num?)?.toDouble();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(children: [
        Expanded(child: Text(label, style: const TextStyle(fontSize: 13, color: Color(0xFF334155)))),
        Text(seconds == null ? '—' : _formatDuration(seconds), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        const SizedBox(width: 7),
        Text('n=${stage['sample_count'] ?? 0}', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
      ]),
    );
  }

  String _formatDuration(double seconds) {
    final minutes = seconds.round() ~/ 60;
    if (minutes < 1) return '${seconds.round()} sec';
    final hours = minutes ~/ 60;
    final remainingMinutes = minutes % 60;
    if (hours > 0) return '${hours}h ${remainingMinutes}m';
    return '${minutes}m';
  }

  Widget _metric(String title, int value, IconData icon, Color color) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: ListTile(
          leading: CircleAvatar(backgroundColor: color.withValues(alpha: .12), child: Icon(icon, color: color)),
          title: Text(title),
          trailing: Text('$value', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        ),
      );
}
