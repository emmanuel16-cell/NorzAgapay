import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../core/incident_time_format.dart';
import '../services/offline_service.dart';
import '../services/report_updates_service.dart';
import '../models/incident_report.dart';
import '../core/constants.dart';
import '../widgets/resident_gradient_app_bar.dart';
import 'report_detail_screen.dart';
import 'reporting_screen.dart';

class MyReportsScreen extends StatefulWidget {
  final String? guestPhone;
  const MyReportsScreen({super.key, this.guestPhone});

  @override
  State<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends State<MyReportsScreen> {
  List<IncidentReport> _reports = [];
  bool _isLoading = true;
  String? _errorMessage;
  List<Map<String, dynamic>> _drafts = [];
  bool _showDrafts = false;
  String _reportFilter = 'All';

  @override
  void initState() {
    super.initState();
    ResidentReportUpdates.reports.addListener(_applyLiveReportUpdates);
    _fetchReports();
  }

  @override
  void dispose() {
    ResidentReportUpdates.reports.removeListener(_applyLiveReportUpdates);
    super.dispose();
  }

  void _applyLiveReportUpdates() {
    if (!mounted) return;
    setState(() => _reports = ResidentReportUpdates.reports.value);
  }

  Future<void> _fetchReports() async {
    _drafts = OfflineService.getDrafts();
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final profile = OfflineService.getProfile();
    final contactNumber = widget.guestPhone ?? profile?['contact_number']?.toString();
    if (contactNumber == null || contactNumber.isEmpty) {
      setState(() {
        _errorMessage = 'Sign in or submit a report with your mobile number to view reports.';
        _isLoading = false;
      });
      return;
    }

    try {
      final response = await http.get(
        Uri.parse(
          '${AppConstants.apiBaseUrl}/incident-reports/resident',
        ).replace(
          queryParameters: {'contact_number': contactNumber},
        ),
        headers: {'ngrok-skip-browser-warning': 'true'},
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        final reports = data
            .map((json) => IncidentReport.fromJson(json))
            .toList();
        ResidentReportUpdates.publish(reports);
        setState(() {
          _reports = reports;
        });
      } else {
        final errorData = jsonDecode(response.body);
        setState(() {
          _errorMessage = errorData['error'] ?? 'Failed to load reports';
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Error: $e';
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  List<IncidentReport> get _filteredReports => _reports.where((report) {
    switch (_reportFilter) {
      case 'Barangay':
        return report.type != 'community' &&
            report.barangayAssignments.isNotEmpty;
      case 'MDRRMO':
        return report.type != 'community' && report.sendTo == 'mdrrmo';
      case 'Community':
        return report.type == 'community';
      default:
        return true;
    }
  }).toList();

  List<Map<String, dynamic>> get _filteredDrafts =>
      OfflineService.getDrafts().where((draft) {
        final type = draft['type']?.toString();
        final sendTo = draft['send_to']?.toString() ?? 'mdrrmo';
        switch (_reportFilter) {
          case 'Barangay':
            return type != 'community' && sendTo == 'barangay';
          case 'MDRRMO':
            return type != 'community' && sendTo == 'mdrrmo';
          case 'Community':
            return type == 'community';
          default:
            return true;
        }
      }).toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: ResidentGradientAppBar(
        colors: ResidentHeaderGradients.reports,
        title: const Text(
          'My Reports',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
      ),
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: SizedBox(
          width: 60,
          height: 60,
          child: Material(
            color: const Color(0xFF2563EB),
            borderRadius: BorderRadius.circular(18),
            elevation: 4,
            shadowColor: const Color(0xFF2563EB).withValues(alpha: 0.4),
            child: InkWell(
              onTap: _openReportFilterSheet,
              borderRadius: BorderRadius.circular(18),
              child: const Icon(
                Icons.format_list_bulleted_rounded,
                color: Colors.white,
                size: 30,
              ),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Row(
              children: [
                _sectionButton(
                  'Submitted',
                  Icons.format_list_bulleted,
                  !_showDrafts,
                  () => setState(() => _showDrafts = false),
                ),
                const SizedBox(width: 10),
                _sectionButton(
                  'Drafts',
                  Icons.drafts_outlined,
                  _showDrafts,
                  () => setState(() {
                    _showDrafts = true;
                    _drafts = OfflineService.getDrafts();
                  }),
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _fetchReports,
              color: const Color(0xFF6366F1),
              child: _showDrafts ? _buildDraftList() : _buildSubmittedList(),
            ),
          ),
        ],
      ),
    );
  }

  void _openReportFilterSheet() {
    const options = [
      (
        'All',
        'Show all submitted reports and drafts',
        Icons.apps_rounded,
        Color(0xFF64748B),
      ),
      (
        'Barangay',
        'Reports sent to your Barangay',
        Icons.location_city_rounded,
        Color(0xFF2563EB),
      ),
      (
        'MDRRMO',
        'Reports sent to MDRRMO',
        Icons.emergency_rounded,
        Color(0xFFDC2626),
      ),
      (
        'Community',
        'Community incident reports',
        Icons.groups_rounded,
        Color(0xFF0D9488),
      ),
    ];
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => SizedBox(
        height: MediaQuery.sizeOf(sheetContext).height * 0.86,
        child: Container(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 16),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2563EB).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(
                        Icons.format_list_bulleted_rounded,
                        color: Color(0xFF2563EB),
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Filter My Reports',
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                          Text(
                            'Choose a destination or report type',
                            style: TextStyle(
                              fontSize: 12,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(sheetContext),
                      icon: const Icon(Icons.close, color: Colors.grey),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                const Divider(height: 1),
                const SizedBox(height: 14),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.only(bottom: 8),
                    itemCount: options.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 9),
                    itemBuilder: (_, index) {
                      final (filter, description, icon, color) = options[index];
                      final selected = _reportFilter == filter;
                      return Material(
                        color: selected
                            ? const Color(0xFFF1F5F9)
                            : Colors.white,
                        borderRadius: BorderRadius.circular(15),
                        child: InkWell(
                          onTap: () {
                            setState(() => _reportFilter = filter);
                            Navigator.pop(sheetContext);
                          },
                          borderRadius: BorderRadius.circular(15),
                          child: Container(
                            constraints: const BoxConstraints(minHeight: 82),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 12,
                            ),
                            decoration: BoxDecoration(
                              border: Border.all(
                                color: selected
                                    ? const Color(0xFF475569)
                                    : color.withValues(alpha: 0.28),
                                width: selected ? 2 : 1,
                              ),
                              borderRadius: BorderRadius.circular(15),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 48,
                                  height: 48,
                                  decoration: BoxDecoration(
                                    color: color.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Icon(icon, color: color, size: 23),
                                ),
                                const SizedBox(width: 15),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        filter,
                                        style: const TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.w700,
                                          color: Color(0xFF1E293B),
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        description,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: Colors.grey.shade600,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Icon(
                                  selected
                                      ? Icons.check_circle_rounded
                                      : Icons.chevron_right_rounded,
                                  color: selected
                                      ? const Color(0xFF475569)
                                      : Colors.grey.shade400,
                                  size: 22,
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _sectionButton(
    String label,
    IconData icon,
    bool selected,
    VoidCallback onTap,
  ) => Expanded(
    child: OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        backgroundColor: selected
            ? const Color(0xFF16496A)
            : Colors.transparent,
        foregroundColor: selected ? Colors.white : const Color(0xFF16496A),
        side: BorderSide(
          color: selected ? const Color(0xFF16496A) : Colors.grey.shade400,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 18),
          const SizedBox(width: 7),
          Text(label, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    ),
  );

  Widget _buildSubmittedList() {
    if (_isLoading)
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF6366F1)),
      );
    if (_errorMessage != null && _reports.isEmpty) {
      return ListView(
        children: [
          SizedBox(
            height: 220,
            child: Center(
              child: Text(_errorMessage!, textAlign: TextAlign.center),
            ),
          ),
        ],
      );
    }
    final reports = _filteredReports;
    if (reports.isEmpty) {
      return ListView(
        children: [
          SizedBox(
            height: 360,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.report_off, size: 80, color: Colors.grey.shade300),
                  const SizedBox(height: 20),
                  Text(
                    _reportFilter == 'All'
                        ? 'No reports submitted yet'
                        : 'No $_reportFilter reports yet',
                    style: const TextStyle(
                      color: Colors.grey,
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Pull down to refresh',
                    style: TextStyle(color: Colors.grey, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      itemCount: reports.length,
      itemBuilder: (context, index) => _buildReportCard(reports[index]),
    );
  }

  Widget _buildDraftList() {
    final drafts = _filteredDrafts;
    if (drafts.isEmpty) {
      return ListView(
        children: [
          SizedBox(
            height: 360,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.drafts_outlined,
                    size: 72,
                    color: Colors.grey.shade300,
                  ),
                  const SizedBox(height: 18),
                  Text(
                    _reportFilter == 'All'
                        ? 'No drafts yet'
                        : 'No $_reportFilter drafts',
                    style: const TextStyle(color: Colors.grey, fontSize: 16),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: drafts.length,
      itemBuilder: (context, index) {
        final draft = drafts[index];
        final id = draft['draft_id'].toString();
        final proofCount = (draft['proof_paths'] as List?)?.length ?? 0;
        final firstSubmitAttempt = DateTime.tryParse(
          draft['client_submitted_at']?.toString() ?? '',
        );
        final occurredAt = DateTime.tryParse(
          draft['incident_occurred_at']?.toString() ?? '',
        );
        final precision = draft['incident_time_precision']?.toString();
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: const Icon(Icons.edit_note, color: Color(0xFF16496A)),
            title: Text((draft['title'] ?? 'Incident Report').toString()),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${draft['type'] == 'community' ? 'Community' : 'Emergency'} · $proofCount proof file(s)',
                ),
                if ((draft['description'] ?? '').toString().isNotEmpty)
                  Text(draft['description'].toString()),
                IncidentOccurrenceText(
                  occurredAt: occurredAt,
                  precision: precision == 'exact' || precision == 'approximate'
                      ? precision!
                      : 'unknown',
                  style: const TextStyle(fontSize: 12),
                ),
                if (firstSubmitAttempt != null)
                  Text(
                    'First submit attempt: ${formatIncidentDateTime(firstSubmitAttempt)}',
                    style: const TextStyle(fontSize: 12),
                  ),
              ],
            ),
            isThreeLine: true,
            trailing: IconButton(
              tooltip: 'Delete draft',
              icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
              onPressed: () async {
                await OfflineService.deleteDraft(id);
                if (mounted)
                  setState(() => _drafts = OfflineService.getDrafts());
              },
            ),
            onTap: () =>
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ReportingScreen(
                      reportType: draft['type'].toString(),
                      initialDraft: draft,
                    ),
                  ),
                ).then((_) {
                  if (mounted)
                    setState(() => _drafts = OfflineService.getDrafts());
                }),
          ),
        );
      },
    );
  }

  Widget _buildReportCard(IncidentReport report) {
    // ── Type pill ─────────────────────────────────────────────────────────────
    final bool isEmergency = report.type == 'emergency';
    final Color typeColor = isEmergency
        ? const Color(0xFFE74C3C)
        : const Color(0xFFF39C12);

    // ── Status pill ───────────────────────────────────────────────────────────
    final String status = report.displayStatus;
    Color statusColor;
    String statusLabel;
    switch (status) {
      case 'resolved':
        statusColor = const Color(0xFF27AE60);
        statusLabel = 'RESOLVED';
        break;
      case 'responding':
        statusColor = const Color(0xFF1E88E5);
        statusLabel = 'RESPONDING';
        break;
      case 'inconclusive':
        statusColor = const Color(0xFFF97316);
        statusLabel = 'INCONCLUSIVE';
        break;
      case 'false_report':
        statusColor = const Color(0xFFDC2626);
        statusLabel = 'FALSE REPORT';
        break;
      case 'pending':
      default:
        statusColor = const Color(0xFFF39C12);
        statusLabel = 'PENDING';
        break;
    }

    // ── Submitted date ────────────────────────────────────────────────────────
    String submittedText = '';
    final submittedAt = report.createdAt;
    if (submittedAt != null) {
      submittedText = formatIncidentDateTime(submittedAt);
    }

    // ── Description preview ───────────────────────────────────────────────────
    final String? descPreview = report.description?.trim().isNotEmpty == true
        ? report.description
        : report.specifics;

    return GestureDetector(
      onTap: () => _openDetail(report),
      child: Container(
        margin: const EdgeInsets.only(bottom: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Top row: type pill + status pill ────────────────────────────
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _PillBadge(
                    label: report.type.toUpperCase(),
                    color: typeColor,
                  ),
                  _PillBadge(label: statusLabel, color: statusColor),
                ],
              ),

              const SizedBox(height: 12),

              // ── Title ────────────────────────────────────────────────────────
              Text(
                report.title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF1A1A2E),
                  height: 1.2,
                ),
              ),

              if (report.evidenceStatus == 'pending' ||
                  report.evidenceStatus == 'failed') ...[
                const SizedBox(height: 7),
                Row(
                  children: [
                    Icon(
                      report.evidenceStatus == 'pending'
                          ? Icons.cloud_upload_outlined
                          : Icons.warning_amber_rounded,
                      size: 15,
                      color: report.evidenceStatus == 'pending'
                          ? const Color(0xFF2563EB)
                          : const Color(0xFFDC2626),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      report.evidenceStatus == 'pending'
                          ? 'Proof upload in progress'
                          : 'Proof upload failed',
                      style: TextStyle(
                        fontSize: 12,
                        color: report.evidenceStatus == 'pending'
                            ? const Color(0xFF2563EB)
                            : const Color(0xFFDC2626),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],

              // ── Truncated description ─────────────────────────────────────
              if (descPreview != null && descPreview.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  descPreview,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xFF6B7280),
                    height: 1.5,
                  ),
                ),
              ],

              const SizedBox(height: 12),
              const Divider(height: 1, color: Color(0xFFF0F0F0)),
              const SizedBox(height: 10),

              // ── Bottom row: receipt time, occurrence time, and View link ──
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  if (submittedText.isNotEmpty)
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Report received: $submittedText',
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF374151),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 3),
                          IncidentOccurrenceText(
                            occurredAt: report.incidentOccurredAt,
                            receivedAt: report.createdAt,
                            resolvedAt: report.resolvedAt,
                            precision: report.incidentTimePrecision,
                            isResolved: report.displayStatus == 'resolved',
                            style: const TextStyle(
                              fontSize: 11,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        ],
                      ),
                    ),
                  GestureDetector(
                    onTap: () => _openDetail(report),
                    child: const Text(
                      'View',
                      style: TextStyle(
                        fontSize: 13,
                        color: Color(0xFF3B82F6),
                        fontWeight: FontWeight.w600,
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

  void _openDetail(IncidentReport report) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => ReportDetailScreen(report: report)),
    ).then((_) => _fetchReports());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pill badge helper widget
// ─────────────────────────────────────────────────────────────────────────────
class _PillBadge extends StatelessWidget {
  final String label;
  final Color color;

  const _PillBadge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 1),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
