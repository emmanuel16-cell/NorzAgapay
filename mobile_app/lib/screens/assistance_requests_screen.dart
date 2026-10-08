import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';

class AssistanceRequestsScreen extends StatefulWidget {
  const AssistanceRequestsScreen({super.key});

  @override
  State<AssistanceRequestsScreen> createState() => _AssistanceRequestsScreenState();
}

class _AssistanceRequestsScreenState extends State<AssistanceRequestsScreen> {
  List<Map<String, dynamic>> _requests = [];
  bool _isLoading = true;
  String? _errorMessage;
  String _filter = 'all'; // 'all', 'pending', 'actioned'

  @override
  void initState() {
    super.initState();
    _fetchRequests();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final socket = Provider.of<SocketService>(context, listen: false);
      socket.onAssistanceRequest((_) {
        if (mounted) _fetchRequests(silent: true);
      });
      socket.onAssistanceDecision((_) {
        if (mounted) _fetchRequests(silent: true);
      });
    });
  }

  Future<void> _fetchRequests({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }
    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }
    final isStaffOrDispatcher =
        auth.currentUser?.isDispatcher == true || auth.currentUser?.isBarangayAdmin == true;
    try {
      final list = isStaffOrDispatcher
          ? await ApiService.getAssistanceRequests(auth.token!)
          : await ApiService.getMyAssistanceRequests(auth.token!);
      if (mounted) {
        setState(() {
          _requests = list;
          _errorMessage = null;
        });
      }
    } catch (e) {
      if (mounted && !silent) setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handleDecide(Map<String, dynamic> request) async {
    String selectedDecision = 'provide_barangay_assistance';
    final notesController = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text(
            'Respond to Request',
            style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'From: ${request['requested_by_user']?['full_name'] ?? 'Responder'}',
                  style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 13, fontWeight: FontWeight.bold),
                ),
                if (request['incident_title'] != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Incident: ${request['incident_title']}',
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                  ),
                ],
                const SizedBox(height: 12),
                const Text('Your Decision:', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                _decisionTile(
                  setDialogState: setDialogState,
                  value: 'provide_barangay_assistance',
                  groupValue: selectedDecision,
                  label: '✅ Provide Barangay Assistance',
                  subtitle: 'Send barangay resources/volunteers to support',
                  color: const Color(0xFF10B981),
                  onChanged: (v) => selectedDecision = v ?? selectedDecision,
                ),
                const SizedBox(height: 8),
                _decisionTile(
                  setDialogState: setDialogState,
                  value: 'coordinate_mdrrmo',
                  groupValue: selectedDecision,
                  label: '🚨 Recommend MDRRMO coordination',
                  subtitle: 'Records this request; the dispatcher must escalate separately',
                  color: const Color(0xFFEF4444),
                  onChanged: (v) => selectedDecision = v ?? selectedDecision,
                ),
                const SizedBox(height: 8),
                _decisionTile(
                  setDialogState: setDialogState,
                  value: 'dismissed',
                  groupValue: selectedDecision,
                  label: '✖ Dismiss Request',
                  subtitle: 'No action needed at this time',
                  color: const Color(0xFF94A3B8),
                  onChanged: (v) => selectedDecision = v ?? selectedDecision,
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: notesController,
                  style: const TextStyle(color: Colors.white),
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Dispatcher\'s Notes (optional)',
                    labelStyle: TextStyle(color: Color(0xFF94A3B8)),
                    hintText: 'e.g., Dispatching 6 additional volunteers now.',
                    hintStyle: TextStyle(color: Color(0xFF64748B), fontSize: 12),
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
              child: const Text('Cancel', style: TextStyle(color: Color(0xFF94A3B8))),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0284C7)),
              child: const Text('Confirm Decision', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
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
          dispatcherNotes: notesController.text.trim().isEmpty ? null : notesController.text.trim(),
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(_decisionLabel(selectedDecision)),
              backgroundColor: const Color(0xFF10B981),
            ),
          );
          _fetchRequests();
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

  String _decisionLabel(String decision) {
    switch (decision) {
      case 'provide_barangay_assistance':
        return 'Decision recorded: Providing barangay assistance';
      case 'coordinate_mdrrmo':
        return 'Decision recorded: Coordinating with MDRRMO';
      case 'dismissed':
        return 'Request dismissed';
      default:
        return 'Decision recorded';
    }
  }

  Widget _decisionTile({
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
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.15) : const Color(0xFF0F172A),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: selected ? color : const Color(0xFF334155), width: selected ? 1.5 : 1),
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
                  Text(label, style: TextStyle(color: selected ? color : Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                  Text(subtitle, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pendingCount = _requests.where((r) => r['status'] == 'pending').length;
    final actionedCount = _requests.where((r) => r['status'] == 'actioned').length;

    final filtered = _requests.where((r) {
      if (_filter == 'pending') return r['status'] == 'pending';
      if (_filter == 'actioned') return r['status'] == 'actioned';
      return true;
    }).toList();

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Assistance Requests', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            Text(
              pendingCount > 0 ? '$pendingCount pending • ${_requests.length} total' : '${_requests.length} requests',
              style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
            ),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchRequests),
        ],
      ),
      body: Column(
        children: [
          // Filter tabs
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            color: const Color(0xFF1E293B),
            child: Row(
              children: [
                _filterChip('all', 'All (${_requests.length})'),
                const SizedBox(width: 8),
                _filterChip('pending', 'Pending ($pendingCount)', badgeColor: const Color(0xFFF59E0B)),
                const SizedBox(width: 8),
                _filterChip('actioned', 'Actioned ($actionedCount)', badgeColor: const Color(0xFF10B981)),
              ],
            ),
          ),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
                : _errorMessage != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.error_outline, color: Colors.red, size: 48),
                              const SizedBox(height: 12),
                              Text(_errorMessage!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
                              const SizedBox(height: 12),
                              ElevatedButton(onPressed: _fetchRequests, child: const Text('Try Again')),
                            ],
                          ),
                        ),
                      )
                    : filtered.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.inbox_outlined, size: 64, color: Color(0xFF475569)),
                                const SizedBox(height: 12),
                                Text(
                                  _filter == 'pending' ? 'No pending assistance requests' : 'No assistance requests found',
                                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 16),
                                ),
                                const SizedBox(height: 4),
                                const Text(
                                  'Responders can request help from incident detail pages.',
                                  style: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _fetchRequests,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(16),
                              itemCount: filtered.length,
                              itemBuilder: (context, i) => _buildCard(filtered[i]),
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(String filterKey, String label, {Color? badgeColor}) {
    final isSelected = _filter == filterKey;
    return GestureDetector(
      onTap: () => setState(() => _filter = filterKey),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected
              ? (badgeColor ?? const Color(0xFF38BDF8)).withOpacity(0.2)
              : const Color(0xFF0F172A),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? (badgeColor ?? const Color(0xFF38BDF8)) : const Color(0xFF334155),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? (badgeColor ?? const Color(0xFF38BDF8)) : const Color(0xFF94A3B8),
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            fontSize: 12,
          ),
        ),
      ),
    );
  }

  Widget _buildCard(Map<String, dynamic> req) {
    final status = req['status'] as String? ?? 'pending';
    final isPending = status == 'pending';
    final requesterName = req['requested_by_user']?['full_name'] as String? ?? 'Responder';
    final incidentTitle = req['incident_title'] as String?;
    final explanation = req['explanation'] as String? ?? '';
    final needsManpower = req['needs_more_manpower'] == true;
    final needsResources = req['needs_resources'] == true;
    final needsEquipment = req['needs_equipment'] == true;
    final beyondCapability = req['beyond_barangay_capability'] == true;
    final dispatcherNotes = req['dispatcher_notes'] as String?;
    final decision = req['decision'] as String?;
    final createdAt = req['created_at'] as String?;

    Color statusColor;
    String statusLabel;
    IconData statusIcon;

    switch (status) {
      case 'actioned':
        statusColor = const Color(0xFF10B981);
        statusLabel = _actionedLabel(decision);
        statusIcon = Icons.check_circle;
        break;
      case 'dismissed':
        statusColor = const Color(0xFF94A3B8);
        statusLabel = 'DISMISSED';
        statusIcon = Icons.cancel;
        break;
      default:
        statusColor = const Color(0xFFF59E0B);
        statusLabel = 'PENDING';
        statusIcon = Icons.pending;
    }

    return Card(
      color: const Color(0xFF1E293B),
      margin: const EdgeInsets.only(bottom: 14),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: isPending ? const Color(0xFFF59E0B).withOpacity(0.5) : const Color(0xFF334155)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Icon(statusIcon, color: statusColor, size: 18),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: statusColor.withOpacity(0.5)),
                  ),
                  child: Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold)),
                ),
                const Spacer(),
                if (createdAt != null)
                  Text(
                    _formatDate(createdAt),
                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                  ),
              ],
            ),
            const SizedBox(height: 10),

            // Requester
            Row(
              children: [
                const Icon(Icons.person, color: Color(0xFF38BDF8), size: 16),
                const SizedBox(width: 6),
                Text(requesterName, style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF10B981).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text('TEAM LEADER', style: TextStyle(color: Color(0xFF10B981), fontSize: 9, fontWeight: FontWeight.bold)),
                ),
              ],
            ),

            if (incidentTitle != null) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.report_problem, color: Color(0xFFEF4444), size: 14),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Incident: $incidentTitle',
                      style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ],

            // Needs tags
            if (needsManpower || needsResources || needsEquipment || beyondCapability) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  if (needsManpower) _tag(Icons.people, 'Manpower', const Color(0xFF0284C7)),
                  if (needsResources) _tag(Icons.inventory_2, 'Resources', const Color(0xFF7C3AED)),
                  if (needsEquipment) _tag(Icons.construction, 'Equipment', const Color(0xFF059669)),
                  if (beyondCapability) _tag(Icons.escalator_warning, 'Needs MDRRMO', const Color(0xFFEF4444)),
                ],
              ),
            ],

            // Explanation
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFF0F172A),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                explanation,
                style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 13),
              ),
            ),

            // Dispatcher notes if actioned
            if (dispatcherNotes != null && dispatcherNotes.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF10B981).withOpacity(0.3)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.admin_panel_settings, color: Color(0xFF10B981), size: 14),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Dispatcher: $dispatcherNotes',
                        style: const TextStyle(color: Color(0xFF10B981), fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // Action button for pending requests
            if (isPending) ...[
              const SizedBox(height: 12),
              Builder(builder: (context) {
                final auth = Provider.of<AuthService>(context, listen: false);
                final canDecide = auth.currentUser?.isDispatcher == true ||
                    auth.currentUser?.isBarangayAdmin == true;
                if (canDecide) {
                  return SizedBox(
                    width: double.infinity,
                    height: 44,
                    child: ElevatedButton.icon(
                      onPressed: () => _handleDecide(req),
                      icon: const Icon(Icons.gavel, size: 18),
                      label: const Text('Decide / Respond',
                          style: TextStyle(fontWeight: FontWeight.bold)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0284C7),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  );
                } else {
                  return Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF59E0B).withOpacity(0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.3)),
                    ),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Color(0xFFF59E0B),
                          ),
                        ),
                        SizedBox(width: 8),
                        Text(
                          'Waiting for Dispatcher to respond...',
                          style: TextStyle(
                            color: Color(0xFFF59E0B),
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  );
                }
              }),
            ],
          ],
        ),
      ),
    );
  }

  String _actionedLabel(String? decision) {
    switch (decision) {
      case 'provide_barangay_assistance':
        return 'BARANGAY ASSISTANCE';
      case 'coordinate_mdrrmo':
        return 'MDRRMO COORDINATED';
      default:
        return 'ACTIONED';
    }
  }

  Widget _tag(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 12),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  String _formatDate(String isoString) {
    try {
      final dt = DateTime.parse(isoString).toLocal();
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      return '${dt.month}/${dt.day} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '';
    }
  }
}
