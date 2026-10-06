import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/incident_report.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../widgets/resolved_report_card.dart';
import 'report_detail_screen.dart';

class ResolvedReportsScreen extends StatefulWidget {
  final String? initialReportId;

  const ResolvedReportsScreen({super.key, this.initialReportId});

  @override
  State<ResolvedReportsScreen> createState() => _ResolvedReportsScreenState();
}

class _ResolvedReportsScreenState extends State<ResolvedReportsScreen> {
  List<IncidentReport> _reports = [];
  bool _loading = true;
  String? _error;
  bool _openedInitialReport = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final token = context.read<AuthService>().token;
    if (token == null) {
      if (mounted)
        setState(() {
          _loading = false;
          _error = 'Sign in to view resolved reports.';
        });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final reports = await ApiService.getResolvedReports(token);
      if (!mounted) return;
      setState(() {
        _reports = reports;
        _loading = false;
      });
      _openRequestedReportIfNeeded();
    } catch (error) {
      if (mounted)
        setState(() {
          _error = error.toString();
          _loading = false;
        });
    }
  }

  void _openRequestedReportIfNeeded() {
    final id = widget.initialReportId;
    if (_openedInitialReport || id == null) return;
    IncidentReport? report;
    for (final item in _reports) {
      if (item.id == id) {
        report = item;
        break;
      }
    }
    if (report == null) return;
    final selectedReport = report;
    _openedInitialReport = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ReportDetailScreen(report: selectedReport),
        ),
      ).then((_) {
        if (mounted) _load();
      });
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F6FA),
    appBar: AppBar(
      title: const Text('Resolved Reports'),
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
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
        ? Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                'Unable to load resolved reports: $_error',
                textAlign: TextAlign.center,
              ),
            ),
          )
        : _reports.isEmpty
        ? const Center(child: Text('No resolved reports yet.'))
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _reports.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final report = _reports[index];
                final token = context.read<AuthService>().token;
                return ResolvedReportCard(
                  reportId: report.id,
                  reportType: report.type,
                  title: report.title,
                  reporterName: report.reporterName,
                  reporterEmail: report.reporterEmail,
                  reporterPhone: report.reporterPhone,
                  classification: [
                    report.incidentType?.replaceAll('_', ' '),
                    report.severity,
                  ].whereType<String>().where((value) => value.trim().isNotEmpty).join(' · '),
                  receivedAt: report.createdAt,
                  incidentOccurredAt: report.incidentOccurredAt,
                  incidentTimePrecision: report.incidentTimePrecision,
                  resolvedAt: report.resolvedAt,
                  loadPdf: () => ApiService.downloadResolutionPdf(token!, report.id),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ReportDetailScreen(report: report),
                    ),
                  ).then((_) {
                    if (mounted) _load();
                  }),
                );
              },
            ),
          ),
  );
}
