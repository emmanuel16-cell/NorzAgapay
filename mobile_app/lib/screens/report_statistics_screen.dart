import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/incident_report.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import 'resolved_reports_screen.dart';

class ReportStatisticsScreen extends StatefulWidget {
  const ReportStatisticsScreen({super.key});

  @override
  State<ReportStatisticsScreen> createState() => _ReportStatisticsScreenState();
}

class _ReportStatisticsScreenState extends State<ReportStatisticsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  List<IncidentReport> _reports = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final token = context.read<AuthService>().token;
    if (token == null) {
      if (mounted)
        setState(() {
          _loading = false;
          _error = 'Sign in to view report statistics.';
        });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await ApiService.getReportStatistics(token);
      final data = result['reports'] as List? ?? const [];
      if (!mounted) return;
      setState(() {
        _reports = data
            .whereType<Map>()
            .map(
              (item) =>
                  IncidentReport.fromJson(Map<String, dynamic>.from(item)),
            )
            .toList();
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

  List<IncidentReport> _reportsFor(String type) =>
      _reports.where((report) => report.type == type).toList();

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F6FA),
    appBar: AppBar(
      title: const Text('Report Statistics'),
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
      actions: [
        IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded)),
      ],
      bottom: TabBar(
        controller: _tabController,
        indicatorColor: const Color(0xFF64D2B4),
        labelColor: Colors.white,
        unselectedLabelColor: const Color(0xFFB9C5D5),
        tabs: const [
          Tab(text: 'Community'),
          Tab(text: 'Emergency'),
        ],
      ),
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                'Unable to load report statistics: $_error',
                textAlign: TextAlign.center,
              ),
            ),
          )
        : TabBarView(
            controller: _tabController,
            children: [
              _buildReportList('community'),
              _buildReportList('emergency'),
            ],
          ),
  );

  Widget _buildReportList(String type) {
    final reports = _reportsFor(type);
    if (reports.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: [
            SizedBox(
              height: 320,
              child: Center(
                child: Text(
                  'No resolved ${type == 'community' ? 'Community' : 'Emergency'} reports yet.',
                ),
              ),
            ),
          ],
        ),
      );
    }

    final responseDurations = reports
        .map((report) => _elapsedSeconds(report.createdAt, report.acceptedAt))
        .whereType<double>()
        .toList();
    final arrivalDurations = reports
        .map((report) => _elapsedSeconds(report.acceptedAt, report.arrivedAt))
        .whereType<double>()
        .toList();
    final resolutionDurations = reports
        .map((report) => _elapsedSeconds(report.arrivedAt, report.resolvedAt))
        .whereType<double>()
        .toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${type == 'community' ? 'Community' : 'Emergency'} averages',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  _averageLine('Average response time', responseDurations),
                  _averageLine('Average arrival time', arrivalDurations),
                  _averageLine('Average resolution time', resolutionDurations),
                  const SizedBox(height: 6),
                  Text(
                    '${reports.length} resolved report${reports.length == 1 ? '' : 's'} included',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF64748B),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          for (final report in reports) _reportCard(report),
        ],
      ),
    );
  }

  Widget _averageLine(String label, List<double> values) {
    final average = values.isEmpty
        ? null
        : values.reduce((a, b) => a + b) / values.length;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: Color(0xFF475569)),
            ),
          ),
          Text(
            average == null ? '—' : _formatDuration(average),
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  Widget _reportCard(IncidentReport report) {
    final response = _elapsedSeconds(report.createdAt, report.acceptedAt);
    final arrival = _elapsedSeconds(report.acceptedAt, report.arrivedAt);
    final resolution = _elapsedSeconds(report.arrivedAt, report.resolvedAt);
    return Card(
      margin: const EdgeInsets.only(top: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              report.title,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.bold,
                color: Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${report.type == 'community' ? 'Community' : 'Emergency'} · ${report.severity ?? 'Unclassified'}',
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
            const Divider(height: 20),
            _durationLine(
              'Response time',
              response == null ? null : _formatDuration(response),
            ),
            _durationLine(
              'Arrival time',
              arrival == null ? null : _formatDuration(arrival),
            ),
            _durationLine(
              'Resolution time',
              resolution == null ? null : _formatDuration(resolution),
            ),
            if (report.travelDistanceM != null)
              _durationLine(
                'Travel distance',
                report.travelDistanceM! >= 1000
                    ? '${(report.travelDistanceM! / 1000).toStringAsFixed(report.travelDistanceM! >= 10000 ? 1 : 2)} km'
                    : '${report.travelDistanceM!.round()} m',
              ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) =>
                        ResolvedReportsScreen(initialReportId: report.id),
                  ),
                ),
                icon: const Icon(Icons.visibility_outlined, size: 18),
                label: const Text('View'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _durationLine(String label, String? value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontSize: 13, color: Color(0xFF475569)),
          ),
        ),
        Text(
          value ?? '—',
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );

  double? _elapsedSeconds(DateTime? start, DateTime? end) {
    if (start == null || end == null || end.isBefore(start)) return null;
    return end.difference(start).inSeconds.toDouble();
  }

  String _formatDuration(double seconds) {
    final minutes = seconds.round() ~/ 60;
    if (minutes < 1) return '${seconds.round()} sec';
    final hours = minutes ~/ 60;
    final remainingMinutes = minutes % 60;
    if (hours > 0) return '${hours}h ${remainingMinutes}m';
    return '${minutes}m';
  }
}
