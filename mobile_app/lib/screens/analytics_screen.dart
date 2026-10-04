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
                      _reportTimingCard(),
                      _overviewMetricCards(),
                      const SizedBox(height: 14),
                      _reportVolumeChartCard(),
                      _averageHandlingChartCard(),
                    ],
                  ),
      );

  Widget _overviewMetricCards() => LayoutBuilder(
    builder: (context, constraints) {
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
        height: constraints.maxWidth < 420 ? 108 : 116,
        child: Row(
          children: [
            for (var index = 0; index < cards.length; index++) ...[
              Expanded(child: cards[index]),
              if (index < cards.length - 1)
                SizedBox(width: constraints.maxWidth < 420 ? 6 : 12),
            ],
          ],
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
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 160;
          return Padding(
            padding: EdgeInsets.all(compact ? 8 : 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: compact ? 17 : 21,
                      backgroundColor: color.withValues(alpha: 0.14),
                      child: Icon(icon, color: color, size: compact ? 18 : 23),
                    ),
                    SizedBox(width: compact ? 5 : 10),
                    Expanded(
                      child: Text(
                        '$value',
                        style: TextStyle(
                          fontSize: compact ? 22 : 26,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF102A56),
                        ),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: compact ? 3 : 5),
                Text(
                  title,
                  maxLines: compact ? 2 : 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: compact ? 12 : 15,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF0F172A),
                  ),
                ),
                const SizedBox(height: 6),
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
                    const SizedBox(width: 5),
                    Expanded(
                      child: Text(
                        compact ? 'View' : viewLabel,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: compact ? 10 : 12,
                          color: const Color(0xFF1E293B),
                        ),
                      ),
                    ),
                    Icon(
                      Icons.chevron_right_rounded,
                      size: compact ? 16 : 21,
                      color: const Color(0xFF94A3B8),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    ),
  );

  Widget _reportVolumeChartCard() {
    final raw = _reportStatistics['report_volume_by_month'];
    final months = raw is List
        ? raw
              .whereType<Map>()
              .map((entry) => Map<String, dynamic>.from(entry))
              .toList()
        : <Map<String, dynamic>>[];
    return _chartCard(
      title: 'Reports over time',
      subtitle: 'Monthly submissions · last 6 months',
      legend: [
        _chartLegendItem('Community', const Color(0xFF0284C7)),
        _chartLegendItem('Emergency', const Color(0xFFF59E0B)),
      ],
      chart: months.isEmpty
          ? const SizedBox(
              height: 176,
              child: Center(
                child: Text(
                  'Monthly report data is not available yet.',
                  style: TextStyle(color: Color(0xFF64748B)),
                ),
              ),
            )
          : SizedBox(
              height: 176,
              child: CustomPaint(
                painter: _ReportVolumeChartPainter(months: months),
                child: const SizedBox.expand(),
              ),
            ),
    );
  }

  Widget _averageHandlingChartCard() {
    Map<String, double?> valuesFor(String type) {
      final byType = _reportStatistics['timing_by_type'] is Map
          ? Map<String, dynamic>.from(
              _reportStatistics['timing_by_type'] as Map,
            )
          : <String, dynamic>{};
      final typeStats = byType[type] is Map
          ? Map<String, dynamic>.from(byType[type] as Map)
          : <String, dynamic>{};
      double? minutesFor(String stage) {
        final timing = typeStats[stage] is Map
            ? Map<String, dynamic>.from(typeStats[stage] as Map)
            : <String, dynamic>{};
        final seconds = (timing['average_seconds'] as num?)?.toDouble();
        return seconds == null ? null : seconds / 60;
      }

      return {
        'Response': minutesFor('response'),
        'Arrival': minutesFor('arrival'),
        'Resolution': minutesFor('resolution'),
      };
    }

    final community = valuesFor('community');
    final emergency = valuesFor('emergency');
    final hasData = [...community.values, ...emergency.values].any(
      (value) => value != null,
    );

    return _chartCard(
      title: 'Average handling times',
      subtitle: 'Resolved barangay reports · minutes',
      legend: [
        _chartLegendItem('Community', const Color(0xFF0284C7)),
        _chartLegendItem('Emergency', const Color(0xFFF59E0B)),
      ],
      chart: hasData
          ? SizedBox(
              height: 176,
              child: CustomPaint(
                painter: _HandlingTimeChartPainter(
                  community: community,
                  emergency: emergency,
                ),
                child: const SizedBox.expand(),
              ),
            )
          : const SizedBox(
              height: 176,
              child: Center(
                child: Text(
                  'Resolve barangay reports to see timing comparisons.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF64748B)),
                ),
              ),
            ),
    );
  }

  Widget _chartCard({
    required String title,
    required String subtitle,
    required List<Widget> legend,
    required Widget chart,
  }) => Card(
    margin: const EdgeInsets.only(bottom: 12),
    elevation: 1,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 3),
          Text(
            subtitle,
            style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
          ),
          const SizedBox(height: 10),
          Wrap(spacing: 16, runSpacing: 6, children: legend),
          const SizedBox(height: 4),
          chart,
        ],
      ),
    ),
  );

  Widget _chartLegendItem(String label, Color color) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 9,
        height: 9,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
      const SizedBox(width: 6),
      Text(
        label,
        style: const TextStyle(fontSize: 12, color: Color(0xFF475569)),
      ),
    ],
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

void _paintChartLabel(
  Canvas canvas,
  String value,
  Offset anchor, {
  TextAlign align = TextAlign.left,
  double fontSize = 10,
  Color color = const Color(0xFF64748B),
}) {
  final painter = TextPainter(
    text: TextSpan(
      text: value,
      style: TextStyle(fontSize: fontSize, color: color),
    ),
    textDirection: TextDirection.ltr,
    textAlign: align,
    maxLines: 1,
  )..layout();
  final dx = switch (align) {
    TextAlign.center => anchor.dx - painter.width / 2,
    TextAlign.right || TextAlign.end => anchor.dx - painter.width,
    _ => anchor.dx,
  };
  painter.paint(canvas, Offset(dx, anchor.dy));
}

class _ReportVolumeChartPainter extends CustomPainter {
  final List<Map<String, dynamic>> months;

  const _ReportVolumeChartPainter({required this.months});

  @override
  void paint(Canvas canvas, Size size) {
    if (months.isEmpty || size.width < 80 || size.height < 60) return;

    const left = 30.0;
    const right = 8.0;
    const top = 10.0;
    const bottomPadding = 25.0;
    final bottom = size.height - bottomPadding;
    final plotWidth = size.width - left - right;
    final plotHeight = bottom - top;
    if (plotWidth <= 0 || plotHeight <= 0) return;

    var highestCount = 0;
    for (final month in months) {
      for (final key in const ['community', 'emergency']) {
        final value = month[key];
        if (value is num && value > highestCount) highestCount = value.toInt();
      }
    }
    final axisMaximum = highestCount <= 1 ? 2.0 : highestCount.toDouble();
    final gridPaint = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..strokeWidth = 1;

    for (var tick = 0; tick <= 2; tick++) {
      final ratio = tick / 2;
      final y = bottom - plotHeight * ratio;
      canvas.drawLine(Offset(left, y), Offset(size.width - right, y), gridPaint);
      _paintChartLabel(
        canvas,
        (axisMaximum * ratio).round().toString(),
        Offset(left - 5, y - 6),
        align: TextAlign.right,
      );
    }

    final lineSpecs = [
      ('community', const Color(0xFF0284C7)),
      ('emergency', const Color(0xFFF59E0B)),
    ];
    for (final (key, color) in lineSpecs) {
      final points = <Offset>[];
      for (var index = 0; index < months.length; index++) {
        final rawValue = months[index][key];
        final count = rawValue is num ? rawValue.toDouble() : 0.0;
        final x = months.length == 1
            ? left + plotWidth / 2
            : left + plotWidth * index / (months.length - 1);
        final y = bottom - (count / axisMaximum) * plotHeight;
        points.add(Offset(x, y));
      }
      final linePaint = Paint()
        ..color = color
        ..strokeWidth = 2.5
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke;
      final pointPaint = Paint()..color = color;
      for (var index = 0; index < points.length; index++) {
        if (index > 0) canvas.drawLine(points[index - 1], points[index], linePaint);
        canvas.drawCircle(points[index], 3, pointPaint);
      }
    }

    for (var index = 0; index < months.length; index++) {
      final x = months.length == 1
          ? left + plotWidth / 2
          : left + plotWidth * index / (months.length - 1);
      _paintChartLabel(
        canvas,
        months[index]['label']?.toString() ?? '',
        Offset(x, bottom + 7),
        align: TextAlign.center,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ReportVolumeChartPainter oldDelegate) => true;
}

class _HandlingTimeChartPainter extends CustomPainter {
  final Map<String, double?> community;
  final Map<String, double?> emergency;

  const _HandlingTimeChartPainter({
    required this.community,
    required this.emergency,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width < 100 || size.height < 70) return;

    const stages = ['Response', 'Arrival', 'Resolution'];
    const left = 34.0;
    const right = 8.0;
    const top = 16.0;
    const bottomPadding = 28.0;
    final bottom = size.height - bottomPadding;
    final plotWidth = size.width - left - right;
    final plotHeight = bottom - top;
    if (plotWidth <= 0 || plotHeight <= 0) return;

    var highestMinutes = 0.0;
    for (final values in [community, emergency]) {
      for (final value in values.values) {
        if (value != null && value.isFinite && value > highestMinutes) {
          highestMinutes = value;
        }
      }
    }
    final axisMaximum = highestMinutes <= 1
        ? 1.0
        : (highestMinutes * 1.15).ceilToDouble();
    final gridPaint = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..strokeWidth = 1;

    for (var tick = 0; tick <= 2; tick++) {
      final ratio = tick / 2;
      final y = bottom - plotHeight * ratio;
      canvas.drawLine(Offset(left, y), Offset(size.width - right, y), gridPaint);
      final tickValue = axisMaximum * ratio;
      final label = tickValue == tickValue.roundToDouble()
          ? tickValue.toInt().toString()
          : tickValue.toStringAsFixed(1);
      _paintChartLabel(
        canvas,
        label,
        Offset(left - 5, y - 6),
        align: TextAlign.right,
      );
    }

    final groupWidth = plotWidth / stages.length;
    final barWidth = groupWidth < 60 ? 11.0 : 16.0;
    final barSpecs = [
      (community, const Color(0xFF0284C7), -1.0),
      (emergency, const Color(0xFFF59E0B), 1.0),
    ];
    for (var stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      final centerX = left + groupWidth * (stageIndex + 0.5);
      for (final (series, color, side) in barSpecs) {
        final value = series[stages[stageIndex]];
        if (value == null || !value.isFinite) continue;
        final barHeight = (value / axisMaximum * plotHeight)
            .clamp(1.5, plotHeight)
            .toDouble();
        final x = centerX + side * (barWidth / 2 + 1.5) - barWidth / 2;
        final rect = Rect.fromLTWH(x, bottom - barHeight, barWidth, barHeight);
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(3)),
          Paint()..color = color,
        );
        _paintChartLabel(
          canvas,
          value.round().toString(),
          Offset(centerX + side * (barWidth / 2 + 1.5), bottom - barHeight - 13),
          align: TextAlign.center,
          fontSize: 9,
          color: const Color(0xFF475569),
        );
      }
      _paintChartLabel(
        canvas,
        stages[stageIndex],
        Offset(centerX, bottom + 7),
        align: TextAlign.center,
        fontSize: 9,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _HandlingTimeChartPainter oldDelegate) => true;
}
