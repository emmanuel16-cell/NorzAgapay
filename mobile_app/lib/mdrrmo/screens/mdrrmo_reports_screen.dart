import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/mdrrmo_report.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import 'mdrrmo_report_detail_screen.dart';

const _mdNavy = Color(0xFF0C243B);
const _mdTeal = Color(0xFF0D9488);
const _mdPage = Color(0xFFF5F6FA);
const _mdMuted = Color(0xFF64748B);

class MdrrmoReportsScreen extends StatefulWidget {
  const MdrrmoReportsScreen({super.key});
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

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    _reportListener = (_) => _load(silent: true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = context.read<AuthProvider>();
      if (auth.token != null && auth.user != null) {
        SocketService.connect(auth.user!.id, auth.user!.role.name, auth.token!);
        SocketService.socket.on('mdrrmo:report_assigned', _reportListener);
        SocketService.socket.on('mdrrmo:report_updated', _reportListener);
      }
      _load();
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    SocketService.socket.off('mdrrmo:report_assigned', _reportListener);
    SocketService.socket.off('mdrrmo:report_updated', _reportListener);
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    if (!silent && mounted)
      setState(() {
        _loading = true;
        _error = null;
      });
    try {
      final reports = await ApiService.getMdrrmoReports(token);
      if (mounted)
        setState(() {
          _reports = reports;
          _error = null;
        });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted && !silent) setState(() => _loading = false);
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
    final color = _color(report);
    final place = [
      report.barangayName,
      report.incidentType?.replaceAll('_', ' '),
      report.severity?.toUpperCase(),
    ].whereType<String>().where((s) => s.trim().isNotEmpty).join(' · ');
    final description = (report.description ?? report.specifics ?? '')
        .replaceAll(RegExp(r'\[SEND_TO:[^\]]+\]'), '')
        .trim();
    final date = report.createdAt?.toLocal();
    return Card(
      color: Colors.white,
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(15),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(15),
        onTap: () => _open(report),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const CircleAvatar(
                    backgroundColor: Color(0xFFE6F6F3),
                    child: Icon(Icons.warning_amber_rounded, color: _mdTeal),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          report.title,
                          style: const TextStyle(
                            color: Color(0xFF0F172A),
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          place,
                          style: const TextStyle(color: _mdMuted, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded, color: _mdMuted),
                ],
              ),
              if (description.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF334155),
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ],
              const SizedBox(height: 11),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: color.withOpacity(.1),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      report.isResolved
                          ? 'RESOLVED'
                          : report.isResponding
                          ? 'RESPONDING'
                          : report.dispatchedAt == null
                          ? 'PENDING REVIEW'
                          : 'PENDING RESPONSE',
                      style: TextStyle(
                        color: color,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const Spacer(),
                  const Icon(Icons.schedule_rounded, size: 13, color: _mdMuted),
                  const SizedBox(width: 4),
                  Text(
                    date == null
                        ? ''
                        : '${date.day}/${date.month}/${date.year} · ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}',
                    style: const TextStyle(color: _mdMuted, fontSize: 11),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

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
    return Scaffold(
      backgroundColor: _mdPage,
      appBar: AppBar(
        backgroundColor: _mdNavy,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
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
        bottom: TabBar(
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
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [_list(0), _list(1), _list(2)],
      ),
    );
  }
}
