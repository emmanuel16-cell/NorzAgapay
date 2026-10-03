import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import 'evac_centers_screen.dart';
import 'public_alerts_screen.dart';
import 'report_statistics_screen.dart';
import 'team_screen.dart';

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
                      _overviewMetricCards(),
                    ],
                  ),
      );

  Widget _overviewMetricCards() => LayoutBuilder(
    builder: (context, constraints) {
      final fitsThreeCards = constraints.maxWidth >= 700;
      final cardWidth = fitsThreeCards
          ? (constraints.maxWidth - 24) / 3
          : 220.0;
      final cards = [
        _overviewMetricCard(
          title: 'Published posts',
          viewLabel: 'View posts',
          value: _posts,
          icon: Icons.campaign_rounded,
          color: const Color(0xFF0284C7),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const PublicAlertsScreen()),
          ),
        ),
        _overviewMetricCard(
          title: 'Evac Stations',
          viewLabel: 'View Evac Stations',
          value: _stations,
          icon: Icons.location_city_rounded,
          color: const Color(0xFF0D9488),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const EvacCentersScreen()),
          ),
        ),
        _overviewMetricCard(
          title: 'Brgy Accounts',
          viewLabel: 'View Accounts',
          value: _teamMembers,
          icon: Icons.groups_rounded,
          color: const Color(0xFF7C3AED),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const TeamScreen()),
          ),
        ),
      ];

      return SizedBox(
        height: 174,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (var index = 0; index < cards.length; index++) ...[
                SizedBox(width: cardWidth, child: cards[index]),
                if (index < cards.length - 1) const SizedBox(width: 12),
              ],
            ],
          ),
        ),
      );
    },
  );

  Widget _overviewMetricCard({
    required String title,
    required String viewLabel,
    required int value,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) => Card(
    margin: EdgeInsets.zero,
    elevation: 2,
    color: Colors.white,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: color.withValues(alpha: 0.14),
                  child: Icon(icon, color: color, size: 27),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    '$value',
                    style: const TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF102A56),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: Color(0xFF0F172A),
              ),
            ),
            const Spacer(),
            Row(
              children: [
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    viewLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFF1E293B),
                    ),
                  ),
                ),
                const Icon(
                  Icons.chevron_right_rounded,
                  size: 21,
                  color: Color(0xFF94A3B8),
                ),
              ],
            ),
          ],
        ),
      ),
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
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 14, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Report timing averages',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ),
                TextButton(
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFF0D9488),
                    padding: EdgeInsets.zero,
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const ReportStatisticsScreen(),
                    ),
                  ),
                  child: const Text(
                    'View all',
                    style: TextStyle(decoration: TextDecoration.underline),
                  ),
                ),
              ],
            ),
            Text(
              '${_reportStatistics['report_count'] ?? 0} resolved barangay reports',
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 8),
            _timingLine('Average response time', response),
            const Divider(
              height: 1,
              thickness: 1,
              indent: 22,
              color: Color(0xFFE2E8F0),
            ),
            _timingLine('Average arrival time', arrival),
            const Divider(
              height: 1,
              thickness: 1,
              indent: 22,
              color: Color(0xFFE2E8F0),
            ),
            _timingLine('Average resolution time', resolution),
          ],
        ),
      ),
    );
  }

  Widget _timingLine(String label, Map<String, dynamic> stage) {
    final seconds = (stage['average_seconds'] as num?)?.toDouble();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          Container(
            width: 9,
            height: 9,
            decoration: const BoxDecoration(
              color: Color(0xFF0D9488),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontSize: 14, color: Color(0xFF334155)),
            ),
          ),
          Text(
            seconds == null ? '—' : _formatDuration(seconds),
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  String _formatDuration(double seconds) {
    final totalSeconds = seconds.round();
    final hours = totalSeconds ~/ 3600;
    final minutes = (totalSeconds % 3600) ~/ 60;
    if (hours > 0) {
      final hourLabel = hours == 1 ? 'hour' : 'hours';
      final minuteLabel = minutes == 1 ? 'minute' : 'minutes';
      return '$hours $hourLabel${minutes == 0 ? '' : ' $minutes $minuteLabel'}';
    }
    if (minutes > 0) return '$minutes ${minutes == 1 ? 'minute' : 'minutes'}';
    return '$totalSeconds ${totalSeconds == 1 ? 'second' : 'seconds'}';
  }

}
