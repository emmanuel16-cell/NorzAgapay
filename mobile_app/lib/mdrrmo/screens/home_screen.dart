import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import 'mdrrmo_evacuation_screen.dart';
import 'mdrrmo_home_screen.dart';
import 'mdrrmo_hotline_screen.dart';
import 'mdrrmo_profile_screen.dart';
import 'mdrrmo_reports_screen.dart';
import '../../services/mdrrmo_responder_push_service.dart';
import '../../services/notification_sound_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;
  StreamSubscription<MdrrmoAssignmentAlert>? _assignmentAlertSubscription;
  StreamSubscription<String>? _openedReportSubscription;

  @override
  void initState() {
    super.initState();
    final pushService = MdrrmoResponderPushService.instance;
    _assignmentAlertSubscription = pushService.assignmentAlerts.listen(
      _showAssignmentAlert,
    );
    _openedReportSubscription = pushService.openedReportIds.listen(
      _showOpenedReport,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      final user = auth.user;
      final token = auth.token;
      if (user != null && token != null && user.role.name == 'responder') {
        unawaited(
          pushService.registerForResponder(
            authToken: token,
            responderId: user.id,
          ),
        );
      }
      final pendingReportId = pushService.takePendingOpenedReportId();
      if (pendingReportId != null) _showOpenedReport(pendingReportId);
    });
  }

  @override
  void dispose() {
    _assignmentAlertSubscription?.cancel();
    _openedReportSubscription?.cancel();
    super.dispose();
  }

  void _showAssignmentAlert(MdrrmoAssignmentAlert alert) {
    if (!mounted) return;
    unawaited(
      NotificationSoundService.play(NotificationSound.mdrrmoDispatch),
    );
    final messenger = ScaffoldMessenger.of(context);
    // Replace an older alert immediately so a new assignment is visible even
    // while the previous red alert is still on screen.
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        backgroundColor: const Color(0xFFE74C3C),
        duration: const Duration(seconds: 6),
        content: Row(
          children: [
            const Icon(Icons.warning_rounded, color: Colors.white),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                alert.title == null || alert.title!.isEmpty
                    ? 'NEW MDRRMO DISPATCH'
                    : 'NEW DISPATCH: ${alert.title}',
              ),
            ),
          ],
        ),
        action: SnackBarAction(
          label: 'VIEW',
          textColor: Colors.white,
          onPressed: () {
            setState(() => _currentIndex = 2);
            MdrrmoResponderPushService.instance.requestOpenReport(
              alert.reportId,
            );
          },
        ),
      ),
    );
  }

  void _showOpenedReport(String reportId) {
    if (!mounted) return;
    setState(() => _currentIndex = 2);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      body: IndexedStack(
        index: _currentIndex,
        children: const [
          MdrrmoHomeScreen(),
          MdrrmoEvacuationScreen(),
          MdrrmoReportsScreen(),
          MdrrmoHotlineScreen(),
          MdrrmoProfileScreen(),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: const Border(top: BorderSide(color: Color(0xFF64D2B4), width: 1.5)),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 10, offset: const Offset(0, -3)),
          ],
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _navItem(0, Icons.home_rounded, 'Home'),
                _navItem(1, Icons.location_on_rounded, 'Evac Station'),
                _navItem(2, Icons.assignment_rounded, 'Reports'),
                _navItem(3, Icons.phone_in_talk_rounded, 'Hotline'),
                _navItem(4, Icons.person_rounded, 'Profile'),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData icon, String label) {
    final selected = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFE6F6F3) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: selected ? const Color(0xFF0D9488) : const Color(0xFF64748B), size: 24),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                color: selected ? const Color(0xFF0D9488) : const Color(0xFF64748B),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
