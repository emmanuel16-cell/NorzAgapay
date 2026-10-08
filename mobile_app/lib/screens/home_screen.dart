import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../core/phone_number_utils.dart';
import '../services/socket_service.dart';
import '../services/api_service.dart';
import '../services/dispatcher_push_service.dart';
import '../models/incident_report.dart';
import 'reports_screen.dart';
import 'report_detail_screen.dart';
import 'evac_centers_screen.dart';
import 'public_alerts_screen.dart';
import 'team_screen.dart';
import 'barangay_account_request_screen.dart';
import 'barangay_hotline_screen.dart';
import 'analytics_screen.dart';
import 'resolved_reports_screen.dart';
import 'assistance_requests_screen.dart';
import '../widgets/legal_dialogs.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  int _currentIndex = 0;
  SocketService? _socketService;
  StreamSubscription<DispatcherReportAlert>? _reportAlertSubscription;
  StreamSubscription<String>? _pushOpenedSubscription;
  final Set<String> _openedPushReportIds = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _currentIndex = 0;
    _reportAlertSubscription = DispatcherPushService.instance.reportAlerts
        .listen(_handleReportAlert);
    _pushOpenedSubscription = DispatcherPushService.instance.openedReportIds
        .listen((reportId) => unawaited(_openReportFromPush(reportId)));
    // Connect to barangay socket room on startup
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthService>(context, listen: false);
      final socket = Provider.of<SocketService>(context, listen: false);
      if (auth.currentUser != null && auth.token != null) {
        _socketService = socket;
        socket.connect(
          auth.currentUser!.barangayId,
          token: auth.token!,
          userId: auth.currentUser!.id,
        );
        socket.onCoordinationAccessChanged(auth.onCoordinationAccessUpdate);
        if (auth.currentUser!.isDispatcher) {
          socket.onNewReport(_handleSocketNewReport);
          unawaited(
            DispatcherPushService.instance.registerForDispatcher(
              authToken: auth.token!,
              userId: auth.currentUser!.id,
              barangayId: auth.currentUser!.barangayId,
            ),
          );
        }
      }

      final pendingReportId = DispatcherPushService.instance
          .takePendingOpenedReportId();
      if (pendingReportId != null) {
        unawaited(_openReportFromPush(pendingReportId));
      }
    });
  }

  void _handleReportAlert(DispatcherReportAlert alert) {
    _showNewReportAlert(alert.reportId, title: alert.title);
  }

  void _handleSocketNewReport(IncidentReport report) {
    _showNewReportAlert(report.id, title: report.title, report: report);
  }

  void _showNewReportAlert(
    String reportId, {
    String? title,
    IncidentReport? report,
  }) {
    if (!mounted || !DispatcherPushService.shouldShowReportAlert(reportId)) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.warning, color: Colors.white),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                title == null || title.isEmpty
                    ? 'NEW INCIDENT REPORT'
                    : 'NEW INCIDENT REPORT: $title',
              ),
            ),
          ],
        ),
        backgroundColor: const Color(0xFFE74C3C),
        duration: const Duration(seconds: 5),
        action: SnackBarAction(
          label: 'VIEW',
          textColor: Colors.white,
          onPressed: () {
            if (report != null) {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => ReportDetailScreen(report: report),
                ),
              );
            } else {
              unawaited(_openReportFromPush(reportId));
            }
          },
        ),
      ),
    );
  }

  Future<void> _openReportFromPush(String reportId) async {
    if (!_openedPushReportIds.add(reportId)) return;
    final auth = Provider.of<AuthService>(context, listen: false);
    if (!mounted ||
        auth.token == null ||
        auth.currentUser?.canViewReports != true) {
      return;
    }

    setState(() => _currentIndex = 2);
    try {
      final reports = await ApiService.getReports(auth.token!);
      IncidentReport? report;
      for (final candidate in reports) {
        if (candidate.id == reportId) {
          report = candidate;
          break;
        }
      }
      if (mounted && report != null) {
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ReportDetailScreen(report: report!),
          ),
        );
      }
    } catch (error) {
      debugPrint('Could not open report from push notification: $error');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      final auth = Provider.of<AuthService>(context, listen: false);
      if (auth.currentUser != null) auth.checkVerificationStatus();
      try {
        final socket = Provider.of<SocketService>(context, listen: false);
        socket.ensureConnected();
      } catch (_) {}
      final token = auth.token;
      final user = auth.currentUser;
      if (token != null && user?.isDispatcher == true) {
        unawaited(
          DispatcherPushService.instance.registerForDispatcher(
            authToken: token,
            userId: user!.id,
            barangayId: user.barangayId,
          ),
        );
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _socketService?.removeNewReportListener(_handleSocketNewReport);
    _reportAlertSubscription?.cancel();
    _pushOpenedSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);
    final user = auth.currentUser;

    // Every role in the barangay is restricted until MDRRMO activates its request.
    if (user != null && !user.coordinationVerified) {
      return const BarangayAccountRequestScreen();
    }

    final items = <_HomeTab>[];
    items.add(
      _HomeTab(
        0,
        'Home',
        Icons.home_outlined,
        Icons.home_rounded,
        const PublicAlertsScreen(),
      ),
    );
    items.add(
      _HomeTab(
        1,
        'Evac Station',
        Icons.location_on_outlined,
        Icons.location_on_rounded,
        const EvacCentersScreen(),
      ),
    );
    if (user?.canViewReports == true) {
      items.add(
        _HomeTab(
          2,
          'Reports',
          Icons.assignment_outlined,
          Icons.assignment_rounded,
          const ReportsScreen(),
        ),
      );
    }
    items.add(
      _HomeTab(
        3,
        'Hotline',
        Icons.phone_in_talk_outlined,
        Icons.phone_in_talk_rounded,
        const BarangayHotlineScreen(),
      ),
    );
    if (user?.isBarangayAdmin == true) {
      items.add(
        _HomeTab(
          5,
          'Analytics',
          Icons.analytics_outlined,
          Icons.analytics_rounded,
          const AnalyticsScreen(),
        ),
      );
    }
    items.add(
      _HomeTab(
        4,
        'Profile',
        Icons.person_outline_rounded,
        Icons.person_rounded,
        _buildAccountScreen(user, auth),
      ),
    );
    final selectedPosition = items.indexWhere(
      (item) => item.index == _currentIndex,
    );
    final safePosition = selectedPosition < 0 ? 0 : selectedPosition;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      body: IndexedStack(
        index: safePosition,
        children: items.map((item) => item.screen).toList(),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFF64D2B4), width: 1.5)),
          boxShadow: [
            BoxShadow(
              color: Color(0x0D000000),
              blurRadius: 10,
              offset: Offset(0, -3),
            ),
          ],
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 62,
            child: Row(
              children: [
                for (final item in items)
                  Expanded(
                    child: _BottomNavButton(
                      index: item.index,
                      label: item.label,
                      icon: item.icon,
                      activeIcon: item.activeIcon,
                      currentIndex: _currentIndex,
                      onTap: (index) => setState(() => _currentIndex = index),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAccountScreen(dynamic user, AuthService auth) {
    String roleLabel = 'Barangay Staff';
    Color roleColor = const Color(0xFF7C3AED);

    if (user?.isDispatcher == true) {
      roleLabel = 'Barangay Dispatcher';
      roleColor = const Color(0xFFF59E0B);
    } else if (user?.isBarangayAdmin == true) {
      roleLabel = 'Barangay Administrator';
      roleColor = const Color(0xFF0284C7);
    } else if (user?.isResponder == true) {
      roleLabel = 'Barangay Responder';
      roleColor = const Color(0xFF10B981);
    } else if (user?.role == 'staff') {
      roleLabel = 'Barangay Staff';
      roleColor = const Color(0xFF7C3AED);
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        flexibleSpace: const _BarangayHeaderGradient(),
        foregroundColor: Colors.white,
        title: const Text('My Account'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            // Avatar
            CircleAvatar(
              radius: 44,
              backgroundColor: roleColor.withValues(alpha: 0.2),
              child: Text(
                user?.fullName.isNotEmpty == true
                    ? user.fullName[0].toUpperCase()
                    : 'B',
                style: TextStyle(
                  color: roleColor,
                  fontSize: 36,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              user?.fullName ?? 'Barangay Officer',
              style: const TextStyle(
                color: Color(0xFF0F172A),
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: roleColor.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: roleColor),
              ),
              child: Text(
                roleLabel,
                style: TextStyle(
                  color: roleColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
            ),
            const SizedBox(height: 28),

            // Details card
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Column(
                children: [
                  _tile(
                    Icons.location_city,
                    'Barangay',
                    user?.barangayName ?? 'Norzagaray',
                  ),
                  const Divider(color: Color(0xFFE2E8F0), height: 1),
                  _tile(Icons.email, 'Email Address', user?.email ?? '-'),
                  const Divider(color: Color(0xFFE2E8F0), height: 1),
                  _tile(
                    Icons.phone,
                    'Contact Number',
                    user?.phone == null
                        ? 'Not set'
                        : PhoneNumberUtils.formatForDisplay(user!.phone),
                  ),
                  const Divider(color: Color(0xFFE2E8F0), height: 1),
                  _tile(Icons.map, 'Municipality', 'Norzagaray, Bulacan'),
                ],
              ),
            ),
            const SizedBox(height: 20),

            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Settings & Policies',
                style: TextStyle(
                  color: Color(0xFF0F172A),
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(height: 10),

            if (user?.isBarangayAdmin == true || user?.isStaff == true) ...[
              _actionTile(
                icon: Icons.task_alt_rounded,
                iconColor: const Color(0xFF0F9D83),
                label: 'Resolved Reports',
                subtitle:
                    'Review resolved reports originating in this barangay',
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const ResolvedReportsScreen(),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            if (user?.isDispatcher == true ||
                user?.isResponder == true ||
                user?.isBarangayAdmin == true) ...[
              _actionTile(
                icon: Icons.support_agent_rounded,
                iconColor: const Color(0xFFF59E0B),
                label: 'Assistance Requests',
                subtitle: user?.isDispatcher == true
                    ? 'Review and decide responder assistance requests'
                    : 'View assistance requests & status',
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const AssistanceRequestsScreen(),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            _actionTile(
              icon: Icons.groups_rounded,
              iconColor: const Color(0xFF10B981),
              label: 'Barangay Management',
              subtitle: user?.canManageTeam == true
                  ? 'View and manage barangay team members'
                  : 'View barangay team members',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const TeamScreen()),
              ),
            ),

            const SizedBox(height: 12),

            _actionTile(
              icon: Icons.manage_accounts_outlined,
              iconColor: const Color(0xFF7C3AED),
              label: 'Edit Information',
              subtitle: 'Update your name and contact number',
              onTap: _showEditInformationDialog,
            ),

            const SizedBox(height: 12),

            _actionTile(
              icon: Icons.lock_reset_rounded,
              iconColor: const Color(0xFFD97706),
              label: 'Change Password',
              subtitle: 'Update your account password securely',
              onTap: () => _showChangePasswordDialog(user?.email ?? ''),
            ),

            const SizedBox(height: 12),

            if (user?.isBarangayAdmin == true) ...[
              _actionTile(
                icon: Icons.account_balance_rounded,
                iconColor: const Color(0xFF0284C7),
                label: 'Barangay Account Request',
                subtitle: 'View your barangay request and activation status',
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const BarangayAccountRequestScreen(),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            const SizedBox(height: 4),
            const Divider(color: Color(0xFFE2E8F0), height: 1),
            const SizedBox(height: 12),

            _actionTile(
              icon: Icons.gavel_rounded,
              iconColor: const Color(0xFF1B4F72),
              label: 'Terms and Conditions',
              subtitle: 'Review the Barangay App terms',
              onTap: () => LegalDialogs.showTermsAndConditions(context),
            ),
            const SizedBox(height: 10),
            _actionTile(
              icon: Icons.privacy_tip_rounded,
              iconColor: const Color(0xFF0D9488),
              label: 'Privacy Policy',
              subtitle: 'How account and incident information is handled',
              onTap: () => LegalDialogs.showPrivacyPolicy(context),
            ),
            const SizedBox(height: 20),

            // Logout
            SizedBox(
              width: double.infinity,
              height: 50,
              child: OutlinedButton.icon(
                onPressed: _handleLogout,
                icon: const Icon(Icons.logout, color: Color(0xFFEF4444)),
                label: const Text(
                  'Sign Out',
                  style: TextStyle(
                    color: Color(0xFFEF4444),
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Color(0xFFEF4444)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _handleLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Sign Out',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        content: const Text(
          'Are you sure you want to sign out of your barangay account?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text(
              'Cancel',
              style: TextStyle(color: Color(0xFF64748B)),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              elevation: 0,
            ),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;
    await DispatcherPushService.instance.unregisterForDispatcher(
      Provider.of<AuthService>(context, listen: false).token ?? '',
    );
    Provider.of<SocketService>(context, listen: false).disconnect();
    await Provider.of<AuthService>(context, listen: false).logout();
  }

  Future<void> _showEditInformationDialog() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;
    if (user == null) return;

    final formKey = GlobalKey<FormState>();
    final nameController = TextEditingController(text: user.fullName);
    final phoneController = TextEditingController(
      text: PhoneNumberUtils.digitsOnly(user.phone),
    );
    var isSaving = false;
    String? errorMessage;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text('Edit Information'),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'You can update your name and contact number.',
                    style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: nameController,
                    textCapitalization: TextCapitalization.words,
                    maxLength: 100,
                    decoration: const InputDecoration(
                      labelText: 'Full Name',
                      prefixIcon: Icon(Icons.person_outline),
                      border: OutlineInputBorder(),
                    ),
                    validator: (value) {
                      final name = value?.trim() ?? '';
                      if (name.length < 2) return 'Enter your name.';
                      if (name.length > 100) return 'Name is too long.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: phoneController,
                    keyboardType: TextInputType.phone,
                    inputFormatters: PhoneNumberUtils.inputFormatters,
                    maxLength: 11,
                    decoration: const InputDecoration(
                      labelText: 'Phone Number',
                      hintText: '09XXXXXXXXX',
                      prefixIcon: Icon(Icons.phone_outlined),
                      border: OutlineInputBorder(),
                    ),
                    validator: (value) {
                      if ((value ?? '').trim().isEmpty) {
                        return 'Enter your Philippine mobile number.';
                      }
                      return PhoneNumberUtils.validationMessage(value);
                    },
                  ),
                  if (errorMessage != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      errorMessage!,
                      style: const TextStyle(
                        color: Color(0xFFDC2626),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: isSaving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: isSaving
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setDialogState(() {
                        isSaving = true;
                        errorMessage = null;
                      });
                      try {
                        final phone = phoneController.text.trim();
                        await auth.updateOwnProfile(
                          fullName: nameController.text.trim(),
                          phone: phone,
                        );
                        if (!dialogContext.mounted) return;
                        Navigator.pop(dialogContext);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Information updated.'),
                              backgroundColor: Color(0xFF16A34A),
                            ),
                          );
                        }
                      } catch (error) {
                        if (dialogContext.mounted) {
                          setDialogState(() {
                            errorMessage = error.toString().replaceFirst(
                              'Exception: ',
                              '',
                            );
                          });
                        }
                      } finally {
                        if (dialogContext.mounted) {
                          setDialogState(() => isSaving = false);
                        }
                      }
                    },
              child: isSaving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save Changes'),
            ),
          ],
        ),
      ),
    );

    nameController.dispose();
    phoneController.dispose();
  }

  Future<void> _showChangePasswordDialog(String email) async {
    final otp = TextEditingController();
    final currentPassword = TextEditingController();
    final newPassword = TextEditingController();
    final confirmPassword = TextEditingController();
    var otpSent = false;
    var sendingOtp = false;
    var updating = false;
    String? error;
    String? success;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Change Password'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Account: $email',
                  style: const TextStyle(
                    color: Color(0xFF1B4F72),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Verify your email and current password to set a new password.',
                ),
                const SizedBox(height: 14),
                if (!otpSent)
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: sendingOtp
                          ? null
                          : () async {
                              setDialogState(() {
                                sendingOtp = true;
                                error = null;
                              });
                              try {
                                await ApiService.sendBarangayPasswordOtp(email);
                                setDialogState(() {
                                  otpSent = true;
                                  success = 'Verification code sent to $email.';
                                });
                              } catch (e) {
                                setDialogState(() => error = e.toString());
                              } finally {
                                setDialogState(() => sendingOtp = false);
                              }
                            },
                      icon: sendingOtp
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.mark_email_read_outlined),
                      label: Text(
                        sendingOtp
                            ? 'Sending code…'
                            : 'Send Email Verification Code',
                      ),
                    ),
                  ),
                if (otpSent) ...[
                  if (success != null) ...[
                    Text(
                      success!,
                      style: const TextStyle(
                        color: Color(0xFF15803D),
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  TextField(
                    controller: otp,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      labelText: '6-digit email code',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: currentPassword,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Current password',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: newPassword,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'New password (6+ characters)',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: confirmPassword,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Confirm new password',
                    ),
                  ),
                ],
                if (error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    error!,
                    style: const TextStyle(
                      color: Color(0xFFDC2626),
                      fontSize: 12,
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: updating ? null : () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            if (otpSent)
              ElevatedButton(
                onPressed: updating
                    ? null
                    : () async {
                        if (otp.text.trim().length != 6) {
                          setDialogState(
                            () => error = 'Enter the 6-digit email code.',
                          );
                          return;
                        }
                        if (newPassword.text.length < 6) {
                          setDialogState(
                            () => error =
                                'New password must be at least 6 characters.',
                          );
                          return;
                        }
                        if (newPassword.text != confirmPassword.text) {
                          setDialogState(
                            () => error = 'New passwords do not match.',
                          );
                          return;
                        }
                        if (currentPassword.text.isEmpty) {
                          setDialogState(
                            () => error = 'Enter your current password.',
                          );
                          return;
                        }
                        setDialogState(() {
                          updating = true;
                          error = null;
                        });
                        try {
                          await ApiService.changeBarangayPassword(
                            email: email,
                            otp: otp.text.trim(),
                            currentPassword: currentPassword.text,
                            newPassword: newPassword.text,
                          );
                          if (dialogContext.mounted)
                            Navigator.pop(dialogContext);
                          if (mounted)
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Password updated successfully.'),
                                backgroundColor: Color(0xFF16A34A),
                              ),
                            );
                        } catch (e) {
                          setDialogState(() {
                            updating = false;
                            error = e.toString();
                          });
                        }
                      },
                child: updating
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Update Password'),
              ),
          ],
        ),
      ),
    );
    otp.dispose();
    currentPassword.dispose();
    newPassword.dispose();
    confirmPassword.dispose();
  }

  Widget _tile(IconData icon, String title, String subtitle) {
    return ListTile(
      leading: Icon(icon, color: const Color(0xFF0D9488)),
      title: Text(
        title,
        style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(
          color: Color(0xFF0F172A),
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _actionTile({
    required IconData icon,
    required Color iconColor,
    required String label,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: iconColor, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      color: const Color(0xFF0F172A),
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              color: Color(0xFF94A3B8),
              size: 22,
            ),
          ],
        ),
      ),
    );
  }
}

class _BarangayHeaderGradient extends StatelessWidget {
  const _BarangayHeaderGradient();

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
  );
}

class _HomeTab {
  final int index;
  final String label;
  final IconData icon;
  final IconData activeIcon;
  final Widget screen;

  const _HomeTab(
    this.index,
    this.label,
    this.icon,
    this.activeIcon,
    this.screen,
  );
}

class _BottomNavButton extends StatelessWidget {
  final int index;
  final String label;
  final IconData icon;
  final IconData activeIcon;
  final int currentIndex;
  final ValueChanged<int> onTap;

  const _BottomNavButton({
    required this.index,
    required this.label,
    required this.icon,
    required this.activeIcon,
    required this.currentIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final selected = currentIndex == index;
    final color = selected ? const Color(0xFF0D9488) : const Color(0xFF94A3B8);
    return InkWell(
      onTap: () => onTap(index),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(selected ? activeIcon : icon, color: color, size: 24),
          const SizedBox(height: 3),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: selected ? FontWeight.bold : FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
