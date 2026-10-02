import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';

class AssistanceRequestsScreen extends StatefulWidget {
  const AssistanceRequestsScreen({super.key});

  @override
  State<AssistanceRequestsScreen> createState() => _AssistanceRequestsScreenState();
}

class _AssistanceRequestsScreenState extends State<AssistanceRequestsScreen> {
  List<Map<String, dynamic>> _requests = [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _fetchRequests();
  }

  Future<void> _fetchRequests() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) return;
    try {
      final list = await ApiService.getAssistanceRequests(auth.token!);
      if (mounted) setState(() => _requests = list);
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString());
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
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : _errorMessage != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, color: Colors.red, size: 48),
                      const SizedBox(height: 12),
                      Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 12),
                      ElevatedButton(onPressed: _fetchRequests, child: const Text('Try Again')),
                    ],
                  ),
                )
              : _requests.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.inbox_outlined, size: 64, color: Color(0xFF475569)),
                          SizedBox(height: 12),
                          Text('No assistance requests yet', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 16)),
                          SizedBox(height: 4),
                          Text(
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
                        itemCount: _requests.length,
                        itemBuilder: (context, i) => _buildCard(_requests[i]),
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
              SizedBox(
                width: double.infinity,
                height: 44,
                child: ElevatedButton.icon(
                  onPressed: () => _handleDecide(req),
                  icon: const Icon(Icons.gavel, size: 18),
                  label: const Text('Decide', style: TextStyle(fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0284C7),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
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
