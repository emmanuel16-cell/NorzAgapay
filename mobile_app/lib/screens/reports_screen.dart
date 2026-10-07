import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../models/incident_report.dart';
import '../core/incident_time_format.dart';
import '../widgets/incident_header_gradient.dart';
import '../widgets/resolved_report_card.dart';
import 'report_detail_screen.dart';
import 'barangay_report_incident_screen.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<IncidentReport> _reports = [];
  bool _isLoading = true;
  String? _errorMessage;

  // Assistance requests map keyed by incident_report_id (for Dispatcher & Responder)
  Map<String, Map<String, dynamic>> _assistanceMap = {};
  // Track which cards are expanded for assistance details
  final Set<String> _expandedAssistance = {};
  SocketService? _socketService;
  int _reportFetchSequence = 0;

  void _onSocketStateChanged() {
    if (mounted && _socketService?.isConnected == true) _fetchReports();
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _fetchReports();

    // Listen to real-time incident report notifications & assistance requests
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final socket = Provider.of<SocketService>(context, listen: false);
      _socketService = socket;
      socket.addListener(_onSocketStateChanged);
      final auth = Provider.of<AuthService>(context, listen: false);

      socket.onNewReport((newReport) {
        if (mounted) {
          setState(() {
            _reports.removeWhere((r) => r.id == newReport.id);
            _reports.insert(0, newReport);
          });
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Row(
                children: [
                  const Icon(Icons.warning, color: Colors.white),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('NEW INCIDENT REPORT: ${newReport.title}'),
                  ),
                ],
              ),
              backgroundColor: const Color(0xFFE74C3C),
              duration: const Duration(seconds: 5),
              action: SnackBarAction(
                label: 'VIEW',
                textColor: Colors.white,
                onPressed: () => _openDetail(newReport),
              ),
            ),
          );
        }
      });
      socket.onReportUpdated((data) {
        if (mounted) {
          if (data is Map) {
            try {
              final updated = IncidentReport.fromJson(Map<String, dynamic>.from(data));
              setState(() {
                final idx = _reports.indexWhere((r) => r.id == updated.id);
                if (idx != -1) {
                  _reports[idx] = updated;
                } else {
                  _reports.insert(0, updated);
                }
              });
            } catch (_) {}
          }
          if (auth.token != null) _fetchReports();
        }
      });

      // Real-time socket events for assistance requests
      socket.onAssistanceRequest((_) {
        if (mounted && auth.token != null)
          _fetchAssistanceRequests(auth.token!);
      });
      socket.onAssistanceDecision((_) {
        if (mounted && auth.token != null)
          _fetchAssistanceRequests(auth.token!);
      });
      socket.onAssistanceTeamAction((_) {
        if (mounted && auth.token != null)
          _fetchAssistanceRequests(auth.token!);
      });
    });
  }

  Future<void> _fetchReports() async {
    final requestSequence = ++_reportFetchSequence;
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) return;

    try {
      final reports = await ApiService.getReports(auth.token!);
      if (mounted && requestSequence == _reportFetchSequence) {
        setState(() => _reports = reports);
        if (auth.currentUser?.isDispatcher == true ||
            auth.currentUser?.isResponder == true) {
          _fetchAssistanceRequests(auth.token!);
        }
      }
    } catch (e) {
      if (mounted && requestSequence == _reportFetchSequence)
        setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted && requestSequence == _reportFetchSequence)
        setState(() => _isLoading = false);
    }
  }

  Future<void> _fetchAssistanceRequests(String token) async {
    final auth = Provider.of<AuthService>(context, listen: false);
    final isDispatcher = auth.currentUser?.isDispatcher == true;
    final isResponder = auth.currentUser?.isResponder == true;

    try {
      List<Map<String, dynamic>> list = [];
      if (isDispatcher) {
        list = await ApiService.getAssistanceRequests(token);
      } else if (isResponder) {
        list = await ApiService.getMyAssistanceRequests(token);
      }

      list.sort((a, b) {
        final aCreated =
            DateTime.tryParse(a['created_at']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0);
        final bCreated =
            DateTime.tryParse(b['created_at']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0);
        return bCreated.compareTo(aCreated);
      });

      final Map<String, Map<String, dynamic>> map = {};
      for (final req in list) {
        final incidentId = req['incident_report_id'] as String?;
        if (incidentId != null) {
          map.putIfAbsent(incidentId, () => req);
        }
      }
      if (mounted) setState(() => _assistanceMap = map);
    } catch (_) {}
  }

  void _openDetail(IncidentReport report) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => ReportDetailScreen(report: report)),
    ).then((_) => _fetchReports());
  }

  List<IncidentReport> _filterByStatus(String tab, [AuthService? authService]) {
    final auth =
        authService ?? Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;
    final isDispatcher = user?.isDispatcher == true;
    final isResponder = user?.isResponder == true;

    if (tab == 'pending') {
      if (isDispatcher) {
        // Dispatcher sees all pending reports
        return _reports.where((r) => r.isPending).toList();
      } else if (isResponder) {
        // Responder only sees pending reports dispatched to them (single or multi-dispatch)
        return _reports.where((r) {
          if (!r.isPending) return false;
          return r.isAssignedToUser(user!.id, userFullName: user.fullName);
        }).toList();
      } else {
        // Volunteers cannot see pending reports
        return [];
      }
    } else if (tab == 'responding') {
      return _reports.where((r) => r.isResponding).toList();
    } else {
      return _reports.where((r) => r.isResolved).toList();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        flexibleSpace: const IncidentHeaderGradient(),
        foregroundColor: Colors.white,
        title: const Text(
          'Incident Reports',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchReports),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF64D2B4),
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          tabs: [
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Pending'),
                  const SizedBox(width: 6),
                  _countBadge(
                    _filterByStatus('pending', auth).length,
                    Colors.red,
                  ),
                ],
              ),
            ),
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Responding'),
                  const SizedBox(width: 6),
                  _countBadge(
                    _filterByStatus('responding', auth).length,
                    Colors.orange,
                  ),
                ],
              ),
            ),
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Resolved'),
                  const SizedBox(width: 6),
                  _countBadge(
                    _filterByStatus('resolved', auth).length,
                    Colors.green,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF0D9488)),
            )
          : _errorMessage != null
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    _errorMessage!,
                    style: const TextStyle(color: Colors.red),
                  ),
                  const SizedBox(height: 12),
                  ElevatedButton(
                    onPressed: _fetchReports,
                    child: const Text('Try Again'),
                  ),
                ],
              ),
            )
          : TabBarView(
              controller: _tabController,
              children: [
                _buildReportList(
                  _filterByStatus('pending', auth),
                  auth,
                  'pending',
                ),
                _buildReportList(
                  _filterByStatus('responding', auth),
                  auth,
                  'responding',
                ),
                _buildReportList(
                  _filterByStatus('resolved', auth),
                  auth,
                  'resolved',
                ),
              ],
            ),
      bottomNavigationBar: auth.currentUser?.isResponder == true
          ? SafeArea(
              top: false,
              bottom: false,
              child: SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton.icon(
                  onPressed: () async {
                    final created = await Navigator.push<bool>(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const BarangayReportIncidentScreen(),
                      ),
                    );
                    if (created == true) _fetchReports();
                  },
                  icon: const Icon(Icons.add_a_photo_outlined),
                  label: const Text(
                    'Report Incident',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0D9488),
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: const RoundedRectangleBorder(),
                  ),
                ),
              ),
            )
          : null,
    );
  }

  Widget _countBadge(int count, Color color) {
    if (count == 0) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withOpacity(0.3),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color, width: 0.8),
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
  }

  Widget _buildReportList(
    List<IncidentReport> list,
    AuthService auth, [
    String category = '',
  ]) {
    if (list.isEmpty) {
      String emptyMessage = 'No reports in this category';
      if (category == 'pending') {
        if (auth.currentUser?.isDispatcher == true) {
          emptyMessage = 'No pending incident reports in your barangay';
        } else if (auth.currentUser?.isResponder == true) {
          emptyMessage = 'No pending incidents dispatched to you';
        } else {
          emptyMessage =
              'Only Dispatchers and assigned Responders can view pending reports';
        }
      } else if (category == 'responding') {
        emptyMessage = 'No active responding incidents';
      } else if (category == 'resolved') {
        emptyMessage = 'No resolved incidents recorded';
      }
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.inbox, size: 60, color: Color(0xFF475569)),
            const SizedBox(height: 12),
            Text(
              emptyMessage,
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchReports,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: list.length,
        itemBuilder: (context, index) {
          final report = list[index];
          return _buildReportCard(report, auth);
        },
      ),
    );
  }

  Widget _buildReportCard(IncidentReport report, AuthService auth) {
    final isDispatcher = auth.currentUser?.isDispatcher == true;
    final isResponder = auth.currentUser?.isResponder == true;
    final typeColor = report.isEmergency
        ? const Color(0xFFEF4444)
        : const Color(0xFFF59E0B);
    Color statusColor = const Color(0xFFEF4444);
    String statusLabel = 'PENDING DISPATCH';

    if (report.isResponding) {
      statusColor = const Color(0xFFF59E0B);
      statusLabel = 'RESPONDING';
    } else if (report.isResolved) {
      statusColor = const Color(0xFF10B981);
      statusLabel = 'RESOLVED';
    }

    // Check if there's an assistance request for this report (Dispatcher or Responder)
    final assistanceReq = (isDispatcher || isResponder)
        ? _assistanceMap[report.id]
        : null;
    final hasAssistance = assistanceReq != null;
    final assistanceData = assistanceReq ?? <String, dynamic>{};
    final isExpanded = _expandedAssistance.contains(report.id);
    final description = (report.description ?? '')
        .replaceAll(RegExp(r'\[SEND_TO:[^\]]+\]'), '')
        .trim();
    final specifics = (report.specifics ?? '').trim();

    if (report.isResolved) {
      return ResolvedReportCard(
        reportId: report.id,
        reportType: report.type,
        title: report.title,
        reporterName: report.reporterName,
        reporterEmail: report.reporterEmail,
        reporterPhone: report.reporterPhone,
        classification: [
          specifics,
          report.severity,
        ].whereType<String>().where((value) => value.trim().isNotEmpty).join(' · '),
        receivedAt: report.createdAt,
        incidentOccurredAt: report.incidentOccurredAt,
        incidentTimePrecision: report.incidentTimePrecision,
        resolvedAt: report.resolvedAt,
        loadPdf: () => ApiService.downloadResolutionPdf(auth.token!, report.id),
        onTap: () => _openDetail(report),
        footer: hasAssistance
            ? _buildAssistanceBanner(
                report.id,
                assistanceData,
                isExpanded,
                isDispatcher,
                isResponder,
              )
            : null,
      );
    }

    return Card(
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(
          color: hasAssistance && assistanceData['status'] == 'pending'
              ? const Color(0xFFF59E0B).withOpacity(0.6)
              : report.isEmergency && report.isPending
              ? Colors.red.withOpacity(0.5)
              : const Color(0xFFE2E8F0),
          width: hasAssistance && assistanceData['status'] == 'pending'
              ? 1.5
              : 1.0,
        ),
      ),
      child: Column(
        children: [
          // Main card tap area
          InkWell(
            onTap: () => _openDetail(report),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(14),
              topRight: const Radius.circular(14),
              bottomLeft: hasAssistance
                  ? Radius.zero
                  : const Radius.circular(14),
              bottomRight: hasAssistance
                  ? Radius.zero
                  : const Radius.circular(14),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: typeColor.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: typeColor.withOpacity(0.5)),
                        ),
                        child: Text(
                          report.type.toUpperCase(),
                          style: TextStyle(
                            color: typeColor,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: statusColor.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: statusColor,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    report.title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF0F172A),
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
                  if ((report.address ?? '').trim().isNotEmpty) ...[
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
                            report.address!.trim(),
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
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      if ((report.reporterEmail ?? '').isNotEmpty) ...[
                        const Icon(
                          Icons.email_outlined,
                          size: 14,
                          color: Color(0xFF1B4F72),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            report.reporterEmail!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF1B4F72),
                              fontSize: 12,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                      ],
                      if (report.createdAt != null) ...[
                        const Icon(
                          Icons.access_time,
                          size: 14,
                          color: Color(0xFF64748B),
                        ),
                        const SizedBox(width: 4),
                        Flexible(
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
                    ],
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      const Icon(
                        Icons.history_rounded,
                        size: 14,
                        color: Color(0xFF64748B),
                      ),
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

          // ── Assistance Request banner (Dispatcher or Responder) ──
          if (hasAssistance)
            _buildAssistanceBanner(
              report.id,
              assistanceData,
              isExpanded,
              isDispatcher,
              isResponder,
            ),
        ],
      ),
    );
  }

  Widget _buildAssistanceBanner(
    String reportId,
    Map<String, dynamic> req,
    bool isExpanded,
    bool isDispatcher,
    bool isResponder,
  ) {
    final status = req['status'] as String? ?? 'pending';
    final decision = req['decision'] as String?;
    final teamAcknowledged = req['team_acknowledged'] == true;
    final hasDispatcherResponded = status == 'actioned' || decision != null;

    // Header Badge:
    // Responder: "Pending" (amber) or "Received" (green)
    // Dispatcher: "Pending" (amber) or "Provided" (green)
    Widget headerBadge;
    if (isDispatcher) {
      if (status == 'cancelled') {
        headerBadge = _statusBadge('Cancelled', const Color(0xFF64748B));
      } else if (hasDispatcherResponded) {
        headerBadge = _statusBadge('Provided', const Color(0xFF10B981));
      } else {
        headerBadge = _statusBadge('Pending', const Color(0xFFF59E0B));
      }
    } else {
      // Responder
      if (status == 'cancelled') {
        headerBadge = _statusBadge('Cancelled', const Color(0xFF64748B));
      } else if (teamAcknowledged) {
        headerBadge = _statusBadge('Received', const Color(0xFF10B981));
      } else {
        headerBadge = _statusBadge('Pending', const Color(0xFFF59E0B));
      }
    }

    return GestureDetector(
      onTap: () {
        setState(() {
          if (_expandedAssistance.contains(reportId)) {
            _expandedAssistance.remove(reportId);
          } else {
            _expandedAssistance.add(reportId);
          }
        });
      },
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: const BorderRadius.only(
            bottomLeft: Radius.circular(14),
            bottomRight: Radius.circular(14),
          ),
          border: const Border(top: BorderSide(color: Color(0xFFE2E8F0))),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Banner Header row
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Row(
                children: [
                  const Text(
                    'SOS',
                    style: TextStyle(
                      color: Color(0xFFF59E0B),
                      fontWeight: FontWeight.w900,
                      fontSize: 13,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Text(
                    'Assistance Request',
                    style: TextStyle(
                      color: const Color(0xFF0F172A),
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  headerBadge,
                  const Spacer(),
                  Icon(
                    isExpanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    color: const Color(0xFF94A3B8),
                    size: 20,
                  ),
                ],
              ),
            ),

            // Expanded detail section
            if (isExpanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Divider(color: Color(0xFFE2E8F0), height: 1),
                    const SizedBox(height: 10),

                    // Requester line
                    Text(
                      isResponder
                          ? 'From: You (Responder)'
                          : 'From: ${req['requested_by_user']?['full_name'] ?? 'Responder 1'}',
                      style: const TextStyle(
                        color: Color(0xFF1B4F72),
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),

                    // Need tags
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (req['needs_more_manpower'] == true)
                          _needTag(
                            Icons.people,
                            'Manpower',
                            const Color(0xFF0284C7),
                          ),
                        if (req['needs_resources'] == true)
                          _needTag(
                            Icons.inventory_2,
                            'Resources',
                            const Color(0xFF7C3AED),
                          ),
                        if (req['needs_equipment'] == true)
                          _needTag(
                            Icons.construction,
                            'Equipment',
                            const Color(0xFF059669),
                          ),
                        if (req['beyond_barangay_capability'] == true)
                          _needTag(
                            Icons.escalator_warning,
                            'Needs MDRRMO',
                            const Color(0xFFEF4444),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    // Explanation text
                    Text(
                      req['explanation'] ?? '',
                      style: const TextStyle(
                        color: Color(0xFF475569),
                        fontSize: 13,
                      ),
                    ),

                    // ── DISPATCHER'S RESPONSE BLOCK (Shown if Dispatcher has responded) ──
                    if (hasDispatcherResponded) ...[
                      const SizedBox(height: 12),
                      const Divider(color: Color(0xFFE2E8F0), height: 1),
                      const SizedBox(height: 10),
                      Text(
                        isDispatcher
                            ? 'From: You (Dispatcher)'
                            : 'From: ${req['decided_by_user']?['full_name'] ?? 'Dispatcher'}',
                        style: const TextStyle(
                          color: Color(0xFF1B4F72),
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 6),
                      if (decision == 'provide_barangay_assistance')
                        _decisionBadge(
                          'Provided Assistance',
                          const Color(0xFF10B981),
                        )
                      else if (decision == 'coordinate_mdrrmo')
                        _decisionBadge(
                          'MDRRMO Coordination',
                          const Color(0xFFEF4444),
                        ),
                      if (req['dispatcher_notes'] != null &&
                          (req['dispatcher_notes'] as String).isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          req['dispatcher_notes'],
                          style: const TextStyle(
                            color: Color(0xFF475569),
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ],

                    // ── DISPATCHER ACTION (Decide Now) ──
                    if (isDispatcher && status == 'pending') ...[
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        height: 42,
                        child: ElevatedButton.icon(
                          onPressed: () => _handleDecide(req),
                          icon: const Icon(Icons.gavel, size: 18),
                          label: const Text(
                            'Decide Now',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0284C7),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                        ),
                      ),
                    ],

                    // ── TEAM LEADER ACTIONS (Change & Received) ──
                    if (isResponder &&
                        status != 'cancelled' &&
                        !teamAcknowledged) ...[
                      const SizedBox(height: 12),
                      if (!hasDispatcherResponded) ...[
                        // Dispatcher has NOT decided yet: only show Change button
                        SizedBox(
                          width: double.infinity,
                          height: 42,
                          child: OutlinedButton(
                            onPressed: () => _showTeamChangeOptions(req),
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: Color(0xFFEF4444)),
                              foregroundColor: const Color(0xFFEF4444),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                              ),
                            ),
                            child: const Text(
                              'Change',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ),
                      ] else ...[
                        // Once the dispatcher has responded, only acknowledge receipt.
                        SizedBox(
                          width: double.infinity,
                          height: 42,
                          child: ElevatedButton.icon(
                            onPressed: () =>
                                _handleTeamAction(req, 'acknowledge'),
                            icon: const Icon(
                              Icons.check_circle_outline,
                              size: 18,
                            ),
                            label: const Text(
                              'Received',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF10B981),
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _statusBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.6)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _decisionBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.18),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _needTag(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 11),
          const SizedBox(width: 3),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  // ── Responder: Change options (Edit Request or Cancel Request) ──────────
  void _showTeamChangeOptions(Map<String, dynamic> req) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E293B),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFF475569),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Modify Request',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              ListTile(
                leading: const Icon(Icons.edit, color: Color(0xFF38BDF8)),
                title: const Text(
                  'Edit Request',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: const Text(
                  'Update checkboxes or explanation details',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _openEditRequestDialog(req);
                },
              ),
              const Divider(color: Color(0xFF334155), height: 1),
              ListTile(
                leading: const Icon(Icons.cancel, color: Color(0xFFEF4444)),
                title: const Text(
                  'Cancel Request',
                  style: TextStyle(
                    color: Color(0xFFEF4444),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: const Text(
                  'Withdraw this assistance request completely',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _handleTeamAction(req, 'cancel');
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Responder: Edit Request Dialog (Prefilled with previous data) ───────
  Future<void> _openEditRequestDialog(Map<String, dynamic> req) async {
    bool needsManpower = req['needs_more_manpower'] == true;
    bool needsResources = req['needs_resources'] == true;
    bool needsEquipment = req['needs_equipment'] == true;
    bool beyondCapability = req['beyond_barangay_capability'] == true;
    final explanationController = TextEditingController(
      text: req['explanation'] ?? '',
    );

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(
                Icons.warning_amber_rounded,
                color: Color(0xFFF59E0B),
                size: 22,
              ),
              SizedBox(width: 8),
              Text(
                'Request Assistance',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Request additional support from the Dispatcher or escalate to MDRRMO.',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                ),
                const SizedBox(height: 14),
                const Text(
                  'Quick Actions — What do you need?',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                _checkboxTile(
                  setDialogState: setDialogState,
                  icon: Icons.people,
                  label: 'Need more manpower',
                  value: needsManpower,
                  onChanged: (v) => needsManpower = v ?? false,
                ),
                _checkboxTile(
                  setDialogState: setDialogState,
                  icon: Icons.inventory_2,
                  label: 'Need more resources / supplies',
                  value: needsResources,
                  onChanged: (v) => needsResources = v ?? false,
                ),
                _checkboxTile(
                  setDialogState: setDialogState,
                  icon: Icons.construction,
                  label: 'Need equipment',
                  value: needsEquipment,
                  onChanged: (v) => needsEquipment = v ?? false,
                ),
                _checkboxTile(
                  setDialogState: setDialogState,
                  icon: Icons.escalator_warning,
                  label:
                      'May exceed barangay capability — request MDRRMO review',
                  value: beyondCapability,
                  onChanged: (v) => beyondCapability = v ?? false,
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: explanationController,
                  style: const TextStyle(color: Colors.white),
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Explanation / Details *',
                    labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                    hintText:
                        'e.g., need 3-4 personnel, food for 8 people, digging equipment',
                    hintStyle: TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                    ),
                    filled: true,
                    fillColor: Color(0xFF0F172A),
                    border: OutlineInputBorder(),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Color(0xFF334155)),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFF59E0B),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: const Text(
                'Send Request',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
    );

    if (result == true) {
      final explanation = explanationController.text.trim();
      if (explanation.length < 10) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Please provide an explanation of at least 10 characters.',
              ),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }

      final auth = Provider.of<AuthService>(context, listen: false);
      if (auth.token == null) return;
      try {
        await ApiService.editAssistanceRequest(
          auth.token!,
          req['id'],
          needsMoreManpower: needsManpower,
          needsResources: needsResources,
          needsEquipment: needsEquipment,
          beyondBarangayCapability: beyondCapability,
          explanation: explanation,
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Assistance request updated successfully!'),
              backgroundColor: Color(0xFF10B981),
            ),
          );
          _fetchAssistanceRequests(auth.token!);
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  Widget _checkboxTile({
    required StateSetter setDialogState,
    required IconData icon,
    required String label,
    required bool value,
    required ValueChanged<bool?> onChanged,
  }) {
    return CheckboxListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      value: value,
      activeColor: const Color(0xFFF59E0B),
      checkColor: Colors.white,
      onChanged: (v) => setDialogState(() => onChanged(v)),
      title: Row(
        children: [
          Icon(icon, color: const Color(0xFF94A3B8), size: 16),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  // ── Responder Action Handler (Cancel or Acknowledge/Received) ────────────
  Future<void> _handleTeamAction(
    Map<String, dynamic> request,
    String action,
  ) async {
    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) return;

    if (action == 'cancel') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            'Cancel Request',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
          ),
          content: const Text(
            'Are you sure you want to cancel this assistance request?',
            style: TextStyle(color: Color(0xFFCBD5E1)),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text(
                'No, Keep It',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEF4444),
              ),
              child: const Text(
                'Yes, Cancel',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }

    try {
      await ApiService.teamLeaderRequestAction(
        auth.token!,
        request['id'],
        action: action,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              action == 'cancel'
                  ? 'Assistance request cancelled.'
                  : 'Assistance marked as received.',
            ),
            backgroundColor: action == 'cancel'
                ? const Color(0xFFEF4444)
                : const Color(0xFF10B981),
          ),
        );
        _fetchAssistanceRequests(auth.token!);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // ── Dispatcher Decision Handler ──────────────────────────────────────────────
  Future<void> _handleDecide(Map<String, dynamic> request) async {
    String selectedDecision = 'provide_barangay_assistance';
    final notesController = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            'Respond to Assistance Request',
            style: TextStyle(
              color: Colors.white,
              fontSize: 17,
              fontWeight: FontWeight.bold,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildAssistanceRequestSummary(request),
                const SizedBox(height: 14),
                const Text(
                  'Your Decision:',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                _decisionOption(
                  setDialogState: setDialogState,
                  value: 'provide_barangay_assistance',
                  groupValue: selectedDecision,
                  label: '✅  Provide Barangay Assistance',
                  subtitle: 'Send barangay resources/volunteers',
                  color: const Color(0xFF10B981),
                  onChanged: (v) => selectedDecision = v ?? selectedDecision,
                ),
                const SizedBox(height: 10),
                _decisionOption(
                  setDialogState: setDialogState,
                  value: 'coordinate_mdrrmo',
                  groupValue: selectedDecision,
                  label: '🚨  Recommend MDRRMO coordination',
                  subtitle:
                      'Records this request; the dispatcher must escalate separately',
                  color: const Color(0xFFEF4444),
                  onChanged: (v) => selectedDecision = v ?? selectedDecision,
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: notesController,
                  style: const TextStyle(color: Colors.white),
                  minLines: 3,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Dispatcher\'s Notes (optional)',
                    labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                    hintText:
                        'e.g., Dispatching 6 additional volunteers and rescue gear now.',
                    hintStyle: TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                    ),
                    filled: true,
                    fillColor: Color(0xFF0F172A),
                    border: OutlineInputBorder(),
                    enabledBorder: OutlineInputBorder(
                      borderSide: BorderSide(color: Color(0xFF334155)),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0284C7),
              ),
              child: const Text(
                'Confirm',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true) {
      final auth = Provider.of<AuthService>(context, listen: false);
      try {
        await ApiService.decideAssistanceRequest(
          auth.token!,
          request['id'],
          decision: selectedDecision,
          dispatcherNotes: notesController.text.trim().isEmpty
              ? null
              : notesController.text.trim(),
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Decision recorded successfully!'),
              backgroundColor: Color(0xFF10B981),
            ),
          );
          _fetchAssistanceRequests(auth.token!);
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  Widget _buildAssistanceRequestSummary(Map<String, dynamic> request) {
    final explanation = (request['explanation'] as String? ?? '').trim();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'REQUEST DETAILS',
            style: TextStyle(
              color: Color(0xFF94A3B8),
              fontSize: 10,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.7,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'From: ${request['requested_by_user']?['full_name'] ?? 'Responder'}',
            style: const TextStyle(
              color: Color(0xFF38BDF8),
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
          if (request['incident_title'] != null) ...[
            const SizedBox(height: 3),
            Text(
              'Incident: ${request['incident_title']}',
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (request['needs_more_manpower'] == true)
                _needTag(Icons.people, 'Manpower', const Color(0xFF38BDF8)),
              if (request['needs_resources'] == true)
                _needTag(
                  Icons.inventory_2,
                  'Resources',
                  const Color(0xFFA78BFA),
                ),
              if (request['needs_equipment'] == true)
                _needTag(
                  Icons.construction,
                  'Equipment',
                  const Color(0xFF34D399),
                ),
              if (request['beyond_barangay_capability'] == true)
                _needTag(
                  Icons.escalator_warning,
                  'Needs MDRRMO',
                  const Color(0xFFF87171),
                ),
            ],
          ),
          if (explanation.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              explanation,
              style: const TextStyle(
                color: Color(0xFFCBD5E1),
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _decisionOption({
    required StateSetter setDialogState,
    required String value,
    required String groupValue,
    required String label,
    required String subtitle,
    required Color color,
    required ValueChanged<String?> onChanged,
  }) {
    final selected = value == groupValue;
    return GestureDetector(
      onTap: () => setDialogState(() => onChanged(value)),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.12) : const Color(0xFF0F172A),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? color : const Color(0xFF334155),
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Radio<String>(
              value: value,
              groupValue: groupValue,
              activeColor: color,
              onChanged: (v) => setDialogState(() => onChanged(v)),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: selected ? color : Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Color(0xFF94A3B8),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _socketService?.removeListener(_onSocketStateChanged);
    _tabController.dispose();
    super.dispose();
  }
}
