import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'dart:async';
import '../../core/incident_time_format.dart';
import '../../widgets/incident_header_gradient.dart';
import '../../widgets/resolved_report_card.dart';
import '../models/mdrrmo_report.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/gps_service.dart';
import '../services/socket_service.dart';
import 'mdrrmo_report_detail_screen.dart';

const _mdNavy = Color(0xFF0C243B);
const _mdTeal = Color(0xFF0D9488);
const _mdPage = Color(0xFFF5F6FA);
const _mdMuted = Color(0xFF64748B);

class MdrrmoReportsScreen extends StatefulWidget {
  final bool embedded;
  const MdrrmoReportsScreen({super.key, this.embedded = false});
  @override
  State<MdrrmoReportsScreen> createState() => _MdrrmoReportsScreenState();
}

class _MdrrmoReportsScreenState extends State<MdrrmoReportsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  List<MdrrmoReport> _reports = [];
  bool _loading = true;
  String? _error;
  late final void Function(dynamic) _reportListener;
  late final void Function(dynamic) _connectListener;
  int _loadSequence = 0;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    _reportListener = (_) => _load(silent: true);
    _connectListener = (_) => _load(silent: true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.token != null && auth.user != null) {
        SocketService.connect(auth.user!.id, auth.user!.role.name, auth.token!);
        SocketService.socket.on('connect', _connectListener);
        SocketService.socket.on('mdrrmo:report_assigned', _reportListener);
        SocketService.socket.on('mdrrmo:report_updated', _reportListener);
        SocketService.socket.on('incident:lifecycle', _reportListener);
      }
      _load();
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    context.read<GpsService>().stopTracking();
    SocketService.socket.off('connect', _connectListener);
    SocketService.socket.off('mdrrmo:report_assigned', _reportListener);
    SocketService.socket.off('mdrrmo:report_updated', _reportListener);
    SocketService.socket.off('incident:lifecycle', _reportListener);
    SocketService.disconnect();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    final loadSequence = ++_loadSequence;
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    if (!silent && mounted)
      setState(() {
        _loading = true;
        _error = null;
      });
    try {
      final reports = await ApiService.getMdrrmoReports(token);
      if (mounted && loadSequence == _loadSequence) {
        _syncResponderGpsTracking(reports);
        setState(() {
          _reports = reports;
          _error = null;
        });
      }
    } catch (error) {
      if (mounted && loadSequence == _loadSequence)
        setState(() => _error = error.toString());
    } finally {
      if (mounted && loadSequence == _loadSequence && !silent)
        setState(() => _loading = false);
    }
  }

  void _syncResponderGpsTracking(List<MdrrmoReport> reports) {
    final auth = context.read<AuthProvider>();
    final user = auth.user;
    final token = auth.token;
    final gps = context.read<GpsService>();
    if (user == null || token == null || user.role.name != 'responder') {
      gps.stopTracking();
      return;
    }

    final hasActiveDispatch = reports.any((report) => report.assignments.any((assignment) {
      final assignedResponderId = assignment['responder_id']?.toString();
      final status = assignment['status']?.toString();
      return assignedResponderId == user.id &&
          (status == 'assigned' || status == 'responding') &&
          assignment['arrived_at'] == null;
    }));

    if (hasActiveDispatch) {
      unawaited(gps.startTracking(user.id, token));
    } else {
      gps.stopTracking();
    }
  }

  List<MdrrmoReport> _forTab(int index) => _reports
      .where(
        (report) => index == 0
            ? report.isPending
            : index == 1
            ? report.isResponding
            : report.isResolved,
      )
      .toList();

  Future<void> _open(MdrrmoReport report) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => MdrrmoReportDetailScreen(report: report),
      ),
    );
    _load(silent: true);
  }

  Color _color(MdrrmoReport report) => report.isResolved
      ? const Color(0xFF10B981)
      : report.isResponding
      ? const Color(0xFFF59E0B)
      : const Color(0xFFEF4444);

  Widget _badge(int count, Color color) => count == 0
      ? const SizedBox.shrink()
      : Container(
          margin: const EdgeInsets.only(left: 6),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          decoration: BoxDecoration(
            color: color.withOpacity(.2),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: color),
          ),
          child: Text(
            '$count',
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
          ),
        );

  Widget _card(MdrrmoReport report) {
    final typeColor = report.type.toLowerCase().contains('emergency')
        ? const Color(0xFFEF4444)
        : const Color(0xFFF59E0B);
    final statusColor = _color(report);
    final statusLabel = report.isResolved
        ? 'RESOLVED'
        : report.isResponding
        ? 'RESPONDING'
        : report.dispatchedAt == null
        ? 'PENDING DISPATCH'
        : 'PENDING RESPONSE';
    final specifics = (report.specifics ?? '').trim();
    final place = [
      report.barangayName,
      report.incidentType?.replaceAll('_', ' '),
      report.severity?.toUpperCase(),
    ].whereType<String>().where((s) => s.trim().isNotEmpty).join(' · ');
    final description = (report.description ?? report.specifics ?? '')
        .replaceAll(RegExp(r'\[SEND_TO:[^\]]+\]'), '')
        .trim();
    final address = (report.address ?? '').trim();
    if (report.isResolved) {
      final token = context.read<AuthProvider>().token;
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
        onTap: () => _open(report),
      );
    }
    return Card(
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(
          color: report.isEscalated
              ? const Color(0xFF38BDF8).withOpacity(.6)
              : report.isPending && typeColor == const Color(0xFFEF4444)
              ? Colors.red.withOpacity(.5)
              : const Color(0xFFE2E8F0),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _open(report),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _cardBadge(report.type.toUpperCase(), typeColor),
                  _cardBadge(statusLabel, statusColor),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                report.title,
                style: const TextStyle(
                  color: Color(0xFF0F172A),
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              if ((report.reporterName ?? '').trim().isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  'Reported by ${report.reporterName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF475569),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              if (specifics.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  specifics,
                  style: const TextStyle(
                    color: Color(0xFF64748B),
                    fontSize: 13,
                  ),
                ),
              ],
              if (description.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF64748B),
                    fontSize: 12,
                  ),
                ),
              ],
              if (address.isNotEmpty || place.isNotEmpty) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(
                      Icons.location_on_outlined,
                      size: 14,
                      color: Color(0xFF64748B),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        address.isNotEmpty ? address : place,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              if (address.isNotEmpty && place.isNotEmpty) ...[
                const SizedBox(height: 4),
                Padding(
                  padding: const EdgeInsets.only(left: 18),
                  child: Text(
                    place,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 10),
              if (report.createdAt != null)
                Row(
                  children: [
                    const Icon(
                      Icons.access_time,
                      size: 14,
                      color: Color(0xFF64748B),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        'Report received: ${formatIncidentDateTime(report.createdAt!)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
              const SizedBox(height: 5),
              Row(
                children: [
                  const Icon(Icons.history_rounded, size: 13, color: _mdMuted),
                  const SizedBox(width: 4),
                  Expanded(
                    child: IncidentOccurrenceText(
                      occurredAt: report.incidentOccurredAt,
                      receivedAt: report.createdAt,
                      resolvedAt: report.resolvedAt,
                      precision: report.incidentTimePrecision,
                      isResolved: report.isResolved,
                      style: const TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _cardBadge(String label, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withOpacity(.2),
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: color.withOpacity(.5)),
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold),
    ),
  );

  Widget _list(int index) {
    if (_loading)
      return const Center(child: CircularProgressIndicator(color: _mdTeal));
    if (_error != null && _reports.isEmpty)
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: _mdMuted),
              ),
              const SizedBox(height: 12),
              ElevatedButton(onPressed: _load, child: const Text('Try again')),
            ],
          ),
        ),
      );
    final rows = _forTab(index);
    if (rows.isEmpty)
      return RefreshIndicator(
        color: _mdTeal,
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.sizeOf(context).height * .25),
            const Icon(Icons.inbox_rounded, color: Color(0xFF94A3B8), size: 58),
            const SizedBox(height: 12),
            Center(
              child: Text(
                [
                  'No pending MDRRMO reports',
                  'No active MDRRMO responses',
                  'No resolved MDRRMO reports',
                ][index],
                style: const TextStyle(color: _mdMuted),
              ),
            ),
          ],
        ),
      );
    return RefreshIndicator(
      color: _mdTeal,
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: rows.length,
        itemBuilder: (_, i) => _card(rows[i]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final statusTabs = TabBar(
      controller: _tabs,
      indicatorColor: const Color(0xFF64D2B4),
      labelColor: Colors.white,
      unselectedLabelColor: Colors.white70,
      tabs: [
        Tab(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Pending'),
              _badge(_forTab(0).length, const Color(0xFFEF4444)),
            ],
          ),
        ),
        Tab(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Responding'),
              _badge(_forTab(1).length, const Color(0xFFF59E0B)),
            ],
          ),
        ),
        Tab(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Resolved'),
              _badge(_forTab(2).length, const Color(0xFF10B981)),
            ],
          ),
        ),
      ],
    );
    final reportTabs = TabBarView(
      controller: _tabs,
      children: [_list(0), _list(1), _list(2)],
    );
    return Scaffold(
      backgroundColor: _mdPage,
      appBar: widget.embedded
          ? null
          : AppBar(
              backgroundColor: _mdNavy,
              foregroundColor: Colors.white,
              surfaceTintColor: Colors.transparent,
              flexibleSpace: const IncidentHeaderGradient(),
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Incident Reports',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                  ),
                  Text(
                    user?.role.name == 'dispatcher'
                        ? 'MDRRMO Dispatcher'
                        : 'MDRRMO Responder',
                    style: const TextStyle(fontSize: 11, color: Colors.white70),
                  ),
                ],
              ),
              actions: [
                IconButton(
                  onPressed: _load,
                  tooltip: 'Refresh',
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
              bottom: statusTabs,
            ),
      body: widget.embedded
          ? Column(
              children: [
                IncidentHeaderGradient(child: statusTabs),
                Expanded(child: reportTabs),
              ],
            )
          : reportTabs,
    );
  }
}
