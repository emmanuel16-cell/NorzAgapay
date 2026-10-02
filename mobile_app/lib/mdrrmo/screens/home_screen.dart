import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../providers/auth_provider.dart';
import '../providers/task_provider.dart';
import '../core/constants.dart';
import '../models/task.dart';
import 'task_detail_screen.dart';
import 'profile_screen.dart';
import '../services/socket_service.dart';
import '../services/gps_service.dart';
import 'dart:async';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  int _currentIndex = 0;
  late TabController _dispatchTabController;

  // Unit data
  List<Map<String, dynamic>> _availableOfficers = [];
  bool _loadingOfficers = false;

  @override
  void initState() {
    super.initState();
    _dispatchTabController = TabController(length: 3, vsync: this);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final taskProvider = Provider.of<TaskProvider>(context, listen: false);
      final gpsService = Provider.of<GpsService>(context, listen: false);

      taskProvider.fetchTasks(auth.token!);
      auth.fetchMyUnit();

      if (auth.user != null) {
        gpsService.startTracking(auth.user!.id, auth.token!);
        SocketService.connect(auth.user!.id, auth.user!.role.name);
      }

      // Real-time dispatch notification
      SocketService.socket.on('task:new', (data) {
        debugPrint('New dispatch received!');
        taskProvider.fetchTasks(auth.token!);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Row(
                children: [
                  Icon(Icons.notifications_active, color: Colors.white),
                  SizedBox(width: 12),
                  Expanded(child: Text('🚨 New dispatch received! Check your Dispatches tab.', style: TextStyle(fontWeight: FontWeight.bold))),
                ],
              ),
              backgroundColor: const Color(AppColors.danger),
              duration: const Duration(seconds: 6),
              behavior: SnackBarBehavior.floating,
              action: SnackBarAction(
                label: 'View',
                textColor: Colors.white,
                onPressed: () => setState(() => _currentIndex = 0),
              ),
            ),
          );
        }
      });
    });
  }

  @override
  void dispose() {
    _dispatchTabController.dispose();
    SocketService.disconnect();
    try {
      Provider.of<GpsService>(context, listen: false).stopTracking();
    } catch (e) {
      debugPrint('Error stopping tracking: $e');
    }
    super.dispose();
  }

  Future<void> _fetchAvailableOfficers() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    setState(() => _loadingOfficers = true);
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/officers'),
        headers: {
          'Authorization': 'Bearer ${auth.token}',
          'ngrok-skip-browser-warning': 'true',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          _availableOfficers = (data['officers'] as List? ?? [])
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        });
      }
    } catch (e) {
      debugPrint('Fetch officers error: $e');
    } finally {
      setState(() => _loadingOfficers = false);
    }
  }

  Future<void> _addMembersToUnit(List<String> officerIds) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final unitId = auth.myUnit?['id'];
    if (unitId == null) return;

    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/respond-units/$unitId/members'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${auth.token}',
          'ngrok-skip-browser-warning': 'true',
        },
        body: json.encode({'officer_ids': officerIds}),
      );
      if (response.statusCode == 200) {
        await auth.fetchMyUnit();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Members added to unit successfully!'),
              backgroundColor: Color(AppColors.success),
            ),
          );
        }
      } else {
        final data = json.decode(response.body);
        throw data['error'] ?? 'Failed to add members';
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: const Color(AppColors.danger)),
        );
      }
    }
  }

  void _showAddMembersModal({String? taskId}) {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final currentMemberIds = auth.unitMembers.map((m) => m['id'].toString()).toList();
    final selected = <String>{};

    _fetchAvailableOfficers();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(AppColors.bgSecondary),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            final available = _availableOfficers
                .where((o) => !currentMemberIds.contains(o['id'].toString()))
                .toList();
            return DraggableScrollableSheet(
              expand: false,
              initialChildSize: 0.7,
              maxChildSize: 0.92,
              minChildSize: 0.4,
              builder: (_, controller) => Column(
                children: [
                  // Handle
                  Container(
                    margin: const EdgeInsets.symmetric(vertical: 12),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Row(
                      children: [
                        const Icon(Icons.group_add, color: Color(AppColors.accent)),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Text(
                            'Add Members on the Move',
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                        ),
                        TextButton(
                          onPressed: selected.isEmpty ? null : () async {
                            Navigator.pop(ctx);
                            if (taskId != null) {
                              await _addMembersToDispatch(taskId, selected.toList());
                            } else {
                              await _addMembersToUnit(selected.toList());
                            }
                          },
                          child: Text(
                            'Add (${selected.length})',
                            style: TextStyle(
                              color: selected.isEmpty ? Colors.grey : const Color(AppColors.success),
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(color: Colors.white10),
                  Expanded(
                    child: _loadingOfficers
                        ? const Center(child: CircularProgressIndicator())
                        : available.isEmpty
                            ? const Center(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(Icons.people_outline, size: 48, color: Colors.grey),
                                    SizedBox(height: 12),
                                    Text('No other available officers', style: TextStyle(color: Colors.grey)),
                                  ],
                                ),
                              )
                            : ListView.builder(
                                controller: controller,
                                padding: const EdgeInsets.symmetric(horizontal: 16),
                                itemCount: available.length,
                                itemBuilder: (_, i) {
                                  final officer = available[i];
                                  final officerId = officer['id'].toString();
                                  final isSelected = selected.contains(officerId);
                                  return ListTile(
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                                    leading: CircleAvatar(
                                      backgroundColor: isSelected
                                          ? const Color(AppColors.success)
                                          : const Color(AppColors.bgSecondary),
                                      child: isSelected
                                          ? const Icon(Icons.check, color: Colors.white, size: 18)
                                          : Text(
                                              (officer['name'] as String? ?? 'O')[0].toUpperCase(),
                                              style: const TextStyle(fontWeight: FontWeight.bold),
                                            ),
                                    ),
                                    title: Text(
                                      officer['name'] ?? 'Officer',
                                      style: const TextStyle(fontWeight: FontWeight.w600),
                                    ),
                                     subtitle: (officer['specialization'] as String? ?? '').trim().isNotEmpty
                                         ? Padding(
                                             padding: const EdgeInsets.only(top: 4),
                                             child: Wrap(
                                               spacing: 4,
                                               runSpacing: 4,
                                               children: (officer['specialization'] as String)
                                                   .split(',')
                                                   .map((s) => s.trim())
                                                   .where((s) => s.isNotEmpty)
                                                   .map((s) => Container(
                                                         padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                         decoration: BoxDecoration(
                                                           color: const Color(AppColors.accent).withValues(alpha: 0.12),
                                                           borderRadius: BorderRadius.circular(4),
                                                           border: Border.all(color: const Color(AppColors.accent).withValues(alpha: 0.25)),
                                                         ),
                                                         child: Text(
                                                           s,
                                                           style: const TextStyle(fontSize: 10, color: Color(AppColors.accent), fontWeight: FontWeight.w600),
                                                         ),
                                                       ))
                                                   .toList(),
                                             ),
                                           )
                                         : null,
                                    trailing: Icon(
                                      isSelected ? Icons.remove_circle : Icons.add_circle_outline,
                                      color: isSelected ? const Color(AppColors.danger) : const Color(AppColors.accent),
                                    ),
                                    onTap: () {
                                      setModalState(() {
                                        if (isSelected) {
                                          selected.remove(officerId);
                                        } else {
                                          selected.add(officerId);
                                        }
                                      });
                                    },
                                  );
                                },
                              ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _addMembersToDispatch(String taskId, List<String> officerIds) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/tasks/$taskId/members'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${auth.token}',
          'ngrok-skip-browser-warning': 'true',
        },
        body: json.encode({'officer_ids': officerIds}),
      );
      if (response.statusCode == 200 || response.statusCode == 201) {
        await auth.fetchMyUnit();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Members added to dispatch!'),
              backgroundColor: Color(AppColors.success),
            ),
          );
        }
      } else {
        // Fallback: add to unit
        await _addMembersToUnit(officerIds);
      }
    } catch (e) {
      await _addMembersToUnit(officerIds);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(AppColors.bgPrimary),
      body: IndexedStack(
        index: _currentIndex,
        children: [
          _buildDispatchesTab(),
          _buildMyUnitTab(),
          _buildAccountTab(),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: const Color(AppColors.bgSecondary),
          border: const Border(top: BorderSide(color: Color(AppColors.border))),
          boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.3), blurRadius: 12)],
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildNavItem(0, Icons.assignment_rounded, 'Dispatches'),
                _buildNavItem(1, Icons.groups_rounded, 'My Unit'),
                _buildNavItem(2, Icons.person_rounded, 'Account'),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(int index, IconData icon, String label) {
    final isActive = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? const Color(AppColors.accent).withOpacity(0.15) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              color: isActive ? const Color(AppColors.accent) : Colors.grey,
              size: 24,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                color: isActive ? const Color(AppColors.accent) : Colors.grey,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ─────────────────────── TAB 1: DISPATCHES ───────────────────────

  Widget _buildDispatchesTab() {
    return Consumer<TaskProvider>(
      builder: (context, taskProvider, _) {
        final pending = taskProvider.tasks.where((t) => t.status == TaskStatus.pending).toList();
        final responding = taskProvider.tasks.where((t) =>
          t.status == TaskStatus.accepted || t.status == TaskStatus.in_progress).toList();
        final resolved = taskProvider.tasks.where((t) =>
          t.status == TaskStatus.completed || t.status == TaskStatus.cancelled).toList();

        return NestedScrollView(
          headerSliverBuilder: (context, _) => [
            SliverAppBar(
              backgroundColor: const Color(AppColors.bgSecondary),
              floating: true,
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Dispatches', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                  Text(
                    '${pending.length} pending alert${pending.length == 1 ? '' : 's'}',
                    style: TextStyle(
                      fontSize: 12,
                      color: pending.isNotEmpty ? const Color(AppColors.danger) : Colors.grey,
                      fontWeight: pending.isNotEmpty ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                ],
              ),
              actions: [
                IconButton(
                  icon: const Icon(Icons.refresh_rounded),
                  onPressed: () {
                    final auth = Provider.of<AuthProvider>(context, listen: false);
                    taskProvider.fetchTasks(auth.token!);
                  },
                ),
              ],
              bottom: TabBar(
                controller: _dispatchTabController,
                indicatorColor: const Color(AppColors.accent),
                labelColor: const Color(AppColors.accent),
                unselectedLabelColor: Colors.grey,
                labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                tabs: [
                  Tab(text: 'Pending (${pending.length})'),
                  Tab(text: 'Responding (${responding.length})'),
                  Tab(text: 'Resolved (${resolved.length})'),
                ],
              ),
            ),
          ],
          body: taskProvider.isLoading
              ? const Center(child: CircularProgressIndicator())
              : TabBarView(
                  controller: _dispatchTabController,
                  children: [
                    _buildDispatchList(pending, emptyLabel: 'No pending dispatches', emptyIcon: Icons.check_circle_outline),
                    _buildDispatchList(responding, emptyLabel: 'No active responses', emptyIcon: Icons.hourglass_empty),
                    _buildDispatchList(resolved, emptyLabel: 'No resolved responses yet', emptyIcon: Icons.history_toggle_off),
                  ],
                ),
        );
      },
    );
  }

  Widget _buildDispatchList(List<Task> tasks, {required String emptyLabel, required IconData emptyIcon}) {
    if (tasks.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(emptyIcon, size: 64, color: Colors.grey.withOpacity(0.5)),
            const SizedBox(height: 16),
            Text(emptyLabel, style: const TextStyle(color: Colors.grey, fontSize: 16)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () async {
        final auth = Provider.of<AuthProvider>(context, listen: false);
        final taskProvider = Provider.of<TaskProvider>(context, listen: false);
        await taskProvider.fetchTasks(auth.token!);
      },
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: tasks.length,
        itemBuilder: (_, i) => _buildDispatchCard(tasks[i]),
      ),
    );
  }

  Widget _buildDispatchCard(Task task) {
    Color priorityColor;
    String priorityLabel;
    IconData incidentIcon;

    switch (task.status) {
      case TaskStatus.pending:
        priorityColor = const Color(AppColors.danger);
        priorityLabel = '🚨 ALERT';
        incidentIcon = Icons.warning_amber_rounded;
        break;
      case TaskStatus.accepted:
        priorityColor = const Color(AppColors.warning);
        priorityLabel = '🚗 EN ROUTE';
        incidentIcon = Icons.directions_run_rounded;
        break;
      case TaskStatus.in_progress:
        priorityColor = const Color(AppColors.success);
        priorityLabel = '⚡ ON SCENE';
        incidentIcon = Icons.local_fire_department_rounded;
        break;
      default:
        priorityColor = Colors.grey;
        priorityLabel = task.status.name.toUpperCase();
        incidentIcon = Icons.check_circle_rounded;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(AppColors.bgSecondary),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: priorityColor.withOpacity(0.3)),
        boxShadow: [BoxShadow(color: priorityColor.withOpacity(0.08), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => TaskDetailScreen(task: task)),
          ),
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: priorityColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: priorityColor.withOpacity(0.4)),
                      ),
                      child: Text(
                        priorityLabel,
                        style: TextStyle(color: priorityColor, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 0.5),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '${task.createdAt.hour.toString().padLeft(2, '0')}:${task.createdAt.minute.toString().padLeft(2, '0')}',
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: priorityColor.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(incidentIcon, color: priorityColor, size: 22),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            task.title,
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (task.incidentTitle != null)
                            Text(
                              task.incidentTitle!,
                              style: const TextStyle(fontSize: 12, color: Colors.grey),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: Colors.grey),
                  ],
                ),
                if (task.address != null) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      const Icon(Icons.location_on_rounded, size: 14, color: Colors.grey),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          task.address!,
                          style: const TextStyle(fontSize: 12, color: Colors.grey),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ─────────────────────── TAB 2: MY UNIT ───────────────────────

  Widget _buildMyUnitTab() {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final unit = auth.myUnit;
        final members = auth.unitMembers;
        final isTeamLeader = auth.isTeamLeader;

        return CustomScrollView(
          slivers: [
            SliverAppBar(
              backgroundColor: const Color(AppColors.bgSecondary),
              floating: true,
              title: const Text('My Unit / Team', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              actions: [
                if (isTeamLeader)
                  IconButton(
                    icon: const Icon(Icons.group_add_rounded, color: Color(AppColors.success)),
                    tooltip: 'Add Members',
                    onPressed: _showAddMembersModal,
                  ),
                IconButton(
                  icon: const Icon(Icons.refresh_rounded),
                  onPressed: () => auth.fetchMyUnit(),
                ),
              ],
            ),
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  if (unit == null)
                    _buildNoUnitCard()
                  else ...[
                    _buildUnitCard(unit, isTeamLeader),
                    const SizedBox(height: 16),
                    if (isTeamLeader) _buildTeamLeaderBanner(),
                    const SizedBox(height: 16),
                    _buildMembersSection(members, auth.myUnit),
                    const SizedBox(height: 24),
                  ],
                ]),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildNoUnitCard() {
    return Container(
      margin: const EdgeInsets.only(top: 40),
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: const Color(AppColors.bgSecondary),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(AppColors.border)),
      ),
      child: Column(
        children: [
          const Icon(Icons.shield_outlined, size: 64, color: Colors.grey),
          const SizedBox(height: 16),
          const Text('Not Assigned to a Unit', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(
            'You have not been assigned to a respond unit yet. Contact your MDRRMO administrator.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey[400], fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildUnitCard(Map<String, dynamic> unit, bool isTeamLeader) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(AppColors.primary).withOpacity(0.3),
            const Color(AppColors.bgSecondary),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(AppColors.primary).withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(AppColors.primary).withOpacity(0.2),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(Icons.shield_rounded, color: Color(AppColors.accent), size: 32),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  unit['unit_name'] ?? 'Respond Unit',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                if ((unit['specialization'] as String? ?? '').trim().isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: (unit['specialization'] as String)
                        .split(',')
                        .map((s) => s.trim())
                        .where((s) => s.isNotEmpty)
                        .map((s) => Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: const Color(AppColors.accent).withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: const Color(AppColors.accent).withValues(alpha: 0.25)),
                              ),
                              child: Text(
                                s,
                                style: const TextStyle(fontSize: 11, color: Color(AppColors.accent), fontWeight: FontWeight.w600),
                              ),
                            ))
                        .toList(),
                  ),
                ],
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: unit['status'] == 'available'
                        ? const Color(AppColors.success).withOpacity(0.15)
                        : const Color(AppColors.warning).withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    (unit['status'] as String? ?? 'available').toUpperCase(),
                    style: TextStyle(
                      color: unit['status'] == 'available'
                          ? const Color(AppColors.success)
                          : const Color(AppColors.warning),
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTeamLeaderBanner() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF064E3B), Color(0xFF065F46)],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(AppColors.success).withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(AppColors.success).withOpacity(0.2),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.star_rounded, color: Color(AppColors.success), size: 24),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('You are the Team Leader', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(AppColors.success))),
                SizedBox(height: 2),
                Text('You can add members and manage dispatches on the move.', style: TextStyle(fontSize: 12, color: Colors.white60)),
              ],
            ),
          ),
          ElevatedButton.icon(
            onPressed: _showAddMembersModal,
            icon: const Icon(Icons.group_add, size: 16),
            label: const Text('Add', style: TextStyle(fontSize: 12)),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(AppColors.success),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMembersSection(List<Map<String, dynamic>> members, Map<String, dynamic>? unit) {
    final teamLeaderId = unit?['team_leader_id'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('TEAM MEMBERS', style: TextStyle(fontSize: 11, color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const Spacer(),
            Text('${members.length} officer${members.length == 1 ? '' : 's'}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ],
        ),
        const SizedBox(height: 12),
        if (members.isEmpty)
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(AppColors.bgSecondary),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(AppColors.border)),
            ),
            child: const Center(child: Text('No members assigned yet', style: TextStyle(color: Colors.grey))),
          )
        else
          ...members.map((m) {
            final isLeader = m['id'] == teamLeaderId;
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(AppColors.bgSecondary),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isLeader
                      ? const Color(AppColors.success).withOpacity(0.4)
                      : const Color(AppColors.border),
                ),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: isLeader
                        ? const Color(AppColors.success).withOpacity(0.2)
                        : const Color(AppColors.primary).withOpacity(0.2),
                    child: isLeader
                        ? const Icon(Icons.star_rounded, color: Color(AppColors.success), size: 20)
                        : Text(
                            (m['name'] as String? ?? 'O')[0].toUpperCase(),
                            style: const TextStyle(color: Color(AppColors.accent), fontWeight: FontWeight.bold),
                          ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              m['name'] ?? 'Officer',
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                            ),
                            if (isLeader) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(AppColors.success).withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text('LEADER', style: TextStyle(color: Color(AppColors.success), fontSize: 9, fontWeight: FontWeight.bold)),
                              ),
                            ],
                          ],
                        ),
                        if ((m['specialization'] as String? ?? '').trim().isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Wrap(
                            spacing: 4,
                            runSpacing: 4,
                            children: (m['specialization'] as String)
                                .split(',')
                                .map((s) => s.trim())
                                .where((s) => s.isNotEmpty)
                                .map((s) => Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: const Color(AppColors.accent).withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(4),
                                        border: Border.all(color: const Color(AppColors.accent).withValues(alpha: 0.25)),
                                      ),
                                      child: Text(
                                        s,
                                        style: const TextStyle(fontSize: 10, color: Color(AppColors.accent), fontWeight: FontWeight.w600),
                                      ),
                                    ))
                                .toList(),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (m['phone'] != null)
                    Icon(Icons.phone_rounded, size: 18, color: Colors.grey[600]),
                ],
              ),
            );
          }),
      ],
    );
  }

  // ─────────────────────── TAB 3: EVACUATION ───────────────────────

  // ─────────────────────── TAB 4: ACCOUNT ───────────────────────

  Widget _buildAccountTab() {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final user = auth.user!;
        return CustomScrollView(
          slivers: [
            SliverAppBar(
              backgroundColor: const Color(AppColors.bgSecondary),
              floating: true,
              title: const Text('Account', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ),
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  // Profile card
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF0F2744), Color(0xFF1E3A5F)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(AppColors.primary).withOpacity(0.3)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            color: const Color(AppColors.primary).withOpacity(0.3),
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(AppColors.accent), width: 2),
                          ),
                          child: Center(
                            child: Text(
                              user.fullName.isNotEmpty ? user.fullName[0].toUpperCase() : 'O',
                              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Color(AppColors.accent)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(user.fullName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 4),
                              Text(user.email, style: const TextStyle(fontSize: 13, color: Colors.grey)),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  if (auth.isTeamLeader)
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      margin: const EdgeInsets.only(right: 6),
                                      decoration: BoxDecoration(
                                        color: const Color(AppColors.success).withOpacity(0.2),
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(color: const Color(AppColors.success).withOpacity(0.4)),
                                      ),
                                      child: const Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Icon(Icons.star_rounded, size: 12, color: Color(AppColors.success)),
                                          SizedBox(width: 4),
                                          Text('Team Leader', style: TextStyle(color: Color(AppColors.success), fontSize: 10, fontWeight: FontWeight.bold)),
                                        ],
                                      ),
                                    ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: const Color(AppColors.primary).withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: const Text('MDRRMO Officer', style: TextStyle(color: Color(AppColors.accent), fontSize: 10, fontWeight: FontWeight.bold)),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Unit info
                  if (auth.myUnit != null) ...[
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(AppColors.bgSecondary),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(AppColors.border)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('UNIT ASSIGNMENT', style: TextStyle(fontSize: 10, color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              const Icon(Icons.shield_rounded, color: Color(AppColors.accent), size: 20),
                              const SizedBox(width: 10),
                              Text(auth.myUnit!['unit_name'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                            ],
                          ),
                          if ((auth.myUnit!['specialization'] as String? ?? '').trim().isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 8, left: 30),
                              child: Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: (auth.myUnit!['specialization'] as String)
                                    .split(',')
                                    .map((s) => s.trim())
                                    .where((s) => s.isNotEmpty)
                                    .map((s) => Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                          decoration: BoxDecoration(
                                            color: const Color(AppColors.accent).withValues(alpha: 0.12),
                                            borderRadius: BorderRadius.circular(6),
                                            border: Border.all(color: const Color(AppColors.accent).withValues(alpha: 0.25)),
                                          ),
                                          child: Text(
                                            s,
                                            style: const TextStyle(fontSize: 11, color: Color(AppColors.accent), fontWeight: FontWeight.w600),
                                          ),
                                        ))
                                    .toList(),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Specialization
                  if (user.specializations.isNotEmpty) ...[
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(AppColors.bgSecondary),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(AppColors.border)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Icon(Icons.badge_rounded, color: Color(AppColors.accent), size: 20),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  user.specializations.length > 1 ? 'SPECIALIZATIONS' : 'SPECIALIZATION',
                                  style: const TextStyle(fontSize: 10, color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5),
                                ),
                                const SizedBox(height: 6),
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: user.specializations.map((spec) => Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: const Color(AppColors.accent).withValues(alpha: 0.15),
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(color: const Color(AppColors.accent).withValues(alpha: 0.3)),
                                    ),
                                    child: Text(
                                      spec,
                                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Colors.white),
                                    ),
                                  )).toList(),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                  ],

                  // Sign out button
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        final shouldLogout = await showDialog<bool>(
                          context: context,
                          builder: (ctx) => AlertDialog(
                            backgroundColor: const Color(AppColors.bgSecondary),
                            title: const Text('Sign Out'),
                            content: const Text('Are you sure you want to sign out?'),
                            actions: [
                              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                              ElevatedButton(
                                onPressed: () => Navigator.pop(ctx, true),
                                style: ElevatedButton.styleFrom(backgroundColor: const Color(AppColors.danger)),
                                child: const Text('Sign Out'),
                              ),
                            ],
                          ),
                        );
                        if (shouldLogout == true && context.mounted) {
                          Provider.of<AuthProvider>(context, listen: false).logout();
                        }
                      },
                      icon: const Icon(Icons.logout_rounded),
                      label: const Text('Sign Out'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(AppColors.danger),
                        side: BorderSide(color: const Color(AppColors.danger).withOpacity(0.5)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 40),
                ]),
              ),
            ),
          ],
        );
      },
    );
  }
}
