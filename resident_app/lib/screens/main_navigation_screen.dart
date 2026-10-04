import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../core/constants.dart';
import '../models/incident_report.dart';
import '../services/norzagaray_boundary.dart';
import '../services/offline_service.dart';
import '../services/report_updates_service.dart';
import '../services/resident_gps_service.dart';
import 'evacuation_map_screen.dart';
import 'feed_screen.dart';
import 'hotlines_screen.dart';
import 'profile_screen.dart';
import 'report_hub_screen.dart';

enum _ResidentTab { home, evacuation, report, hotline, profile }

class MainNavigationScreen extends StatefulWidget {
  final int initialIndex;

  const MainNavigationScreen({super.key, this.initialIndex = 0});

  @override
  State<MainNavigationScreen> createState() => MainNavigationScreenState();
}

class MainNavigationScreenState extends State<MainNavigationScreen>
    with WidgetsBindingObserver {
  late bool _isLoggedIn;
  late _ResidentTab _currentTab;
  bool _isInsideNorzagaray = false;
  bool _isCheckingLocation = false;
  Timer? _reportStatusTimer;
  bool _hasLoadedReportSnapshot = false;
  bool _isPollingReportStatus = false;
  bool _showingReportUpdate = false;
  final Map<String, int> _reportMilestones = {};
  final Map<String, String> _reportHandlers = {};

  @override
  void initState() {
    super.initState();
    _isLoggedIn = OfflineService.isLoggedIn();
    _isInsideNorzagaray = !NorzagarayBoundary.isEnabled;
    final initialTabs = _tabsFor(_isLoggedIn, includeReport: true);
    _currentTab =
        initialTabs[widget.initialIndex.clamp(0, initialTabs.length - 1)];
    WidgetsBinding.instance.addObserver(this);
    NorzagarayBoundary.changes.addListener(_onBoundaryChanged);
    if (_isLoggedIn) {
      unawaited(_refreshLocation(requestPermission: true));
      unawaited(_pollResidentReportStatus());
      _startReportStatusPolling();
    }
  }

  @override
  void dispose() {
    NorzagarayBoundary.changes.removeListener(_onBoundaryChanged);
    _reportStatusTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(NorzagarayBoundary.refresh());
      if (_isLoggedIn) {
        unawaited(_refreshLocation(requestPermission: false));
        unawaited(_pollResidentReportStatus());
        _startReportStatusPolling();
      }
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _reportStatusTimer?.cancel();
      _reportStatusTimer = null;
    }
  }

  void _onBoundaryChanged() {
    if (mounted && _isLoggedIn) {
      unawaited(_refreshLocation(requestPermission: false));
    }
    if (mounted) setState(() {});
  }

  static List<_ResidentTab> _tabsFor(
    bool isLoggedIn, {
    required bool includeReport,
  }) => [
    _ResidentTab.home,
    _ResidentTab.evacuation,
    if (isLoggedIn && includeReport) _ResidentTab.report,
    _ResidentTab.hotline,
    _ResidentTab.profile,
  ];

  List<_ResidentTab> get _visibleTabs =>
      _tabsFor(_isLoggedIn, includeReport: _isInsideNorzagaray);

  void _checkAuthState() {
    final isLoggedIn = OfflineService.isLoggedIn();
    if (!mounted || isLoggedIn == _isLoggedIn) return;
    setState(() {
      _isLoggedIn = isLoggedIn;
      if (!_visibleTabs.contains(_currentTab)) _currentTab = _ResidentTab.home;
    });
    if (isLoggedIn) {
      unawaited(_refreshLocation(requestPermission: true));
      _hasLoadedReportSnapshot = false;
      _reportMilestones.clear();
      _reportHandlers.clear();
      unawaited(_pollResidentReportStatus());
      _startReportStatusPolling();
    } else {
      _reportStatusTimer?.cancel();
      _reportStatusTimer = null;
      _hasLoadedReportSnapshot = false;
      _reportMilestones.clear();
      _reportHandlers.clear();
      ResidentReportUpdates.publish(const []);
    }
  }

  void _startReportStatusPolling() {
    _reportStatusTimer?.cancel();
    _reportStatusTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      unawaited(_pollResidentReportStatus());
    });
  }

  Future<void> _pollResidentReportStatus() async {
    if (!_isLoggedIn || _isPollingReportStatus) return;
    final profile = OfflineService.getProfile();
    final contactNumber = profile?['contact_number']?.toString();
    final token = profile?['token']?.toString();
    final hasContact = contactNumber != null && contactNumber.trim().isNotEmpty;
    final hasToken = token != null && token.isNotEmpty;
    if (!hasContact && !hasToken) return;

    _isPollingReportStatus = true;
    try {
      final response = await http
          .get(
            Uri.parse('${AppConstants.apiBaseUrl}/incident-reports/resident')
                .replace(queryParameters: hasContact ? {'contact_number': contactNumber!} : null),
            headers: {
              'ngrok-skip-browser-warning': 'true',
              if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
            },
          )
          .timeout(const Duration(seconds: 12));
      if (response.statusCode == 403 && hasToken && mounted) {
        await OfflineService.logout();
        _checkAuthState();
        if (mounted) {
          await showDialog<void>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('Resident account deactivated'),
              content: const Text(
                'Your account has been deactivated after three false-reporter marks. Contact the Norzagaray MDRRMO office for assistance.',
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('OK')),
              ],
            ),
          );
        }
        return;
      }
      if (response.statusCode != 200 || !mounted) return;

      final reports = (jsonDecode(response.body) as List)
          .map(
            (item) =>
                IncidentReport.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList();
      ResidentReportUpdates.publish(reports);
      IncidentReport? reviewNotice;
      for (final report in reports) {
        final id = report.id;
        if (id == null ||
            (report.displayStatus != 'inconclusive' &&
                report.displayStatus != 'false_report') ||
            OfflineService.hasSeenReviewNotice(id)) {
          continue;
        }
        reviewNotice = report;
        break;
      }
      if (reviewNotice != null) {
        unawaited(_showReviewNotice(reviewNotice));
        return;
      }
      if (!_hasLoadedReportSnapshot) {
        _reportMilestones
          ..clear()
          ..addEntries(
            reports
                .where((report) => report.id != null)
                .map(
                  (report) => MapEntry(report.id!, _reportMilestone(report)),
                ),
          );
        _reportHandlers
          ..clear()
          ..addEntries(
            reports.where((report) => report.id != null).map(
                  (report) => MapEntry(report.id!, _reportHandler(report)),
                ),
          );
        _hasLoadedReportSnapshot = true;
        return;
      }

      IncidentReport? changedReport;
      var changedMilestone = 0;
      var handlerChanged = false;
      for (final report in reports) {
        final id = report.id;
        if (id == null) continue;
        final milestone = _reportMilestone(report);
        final previous = _reportMilestones[id] ?? 0;
        final handler = _reportHandler(report);
        final previousHandler = _reportHandlers[id];
        final isHandoffToMdrrmo = previousHandler != null &&
            previousHandler != handler &&
            handler == 'mdrrmo';
        if ((milestone > previous || isHandoffToMdrrmo) &&
            (milestone > changedMilestone ||
                (isHandoffToMdrrmo && milestone == changedMilestone))) {
          changedReport = report;
          changedMilestone = milestone;
          handlerChanged = isHandoffToMdrrmo;
        }
        _reportMilestones[id] = milestone;
        _reportHandlers[id] = handler;
      }
      if (changedReport != null)
        _showReportUpdatePopup(
          changedReport,
          changedMilestone,
          handlerChanged: handlerChanged,
        );
    } catch (_) {
      // A later polling cycle retries transient connectivity or server errors.
    } finally {
      _isPollingReportStatus = false;
    }
  }

  Future<void> _showReviewNotice(IncidentReport report) async {
    if (!mounted || _showingReportUpdate) return;
    final id = report.id;
    if (id == null) return;
    _showingReportUpdate = true;
    final isInconclusive = report.displayStatus == 'inconclusive';
    final reason = report.reviewReason?.trim();
    final message = isInconclusive
        ? 'MDRRMO could not confirm your report, so it has been marked inconclusive.${reason?.isNotEmpty == true ? '\n\nReason: $reason' : ''}'
        : 'MDRRMO marked this report as a false report. It will not be dispatched.';

    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          title: Text(
            isInconclusive ? 'Report marked inconclusive' : 'Report review update',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20),
          ),
          content: Text(message, style: const TextStyle(fontSize: 16, height: 1.4)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('OK')),
          ],
        ),
      );
      await OfflineService.markReviewNoticeSeen(id);
    } finally {
      _showingReportUpdate = false;
    }
  }

  int _reportMilestone(IncidentReport report) {
    if (report.resolvedAt != null || report.displayStatus == 'resolved')
      return 5;
    if (report.arrivedAt != null) return 4;
    if (report.acceptedAt != null) return 3;
    if (report.dispatchedAt != null) return 2;
    if (report.dispatcherReviewedAt != null) return 1;
    return 0;
  }

  String _reportHandler(IncidentReport report) =>
      report.isMdrrmoHandled ? 'mdrrmo' : 'barangay';

  void _showReportUpdatePopup(
    IncidentReport report,
    int milestone, {
    bool handlerChanged = false,
  }) {
    if (!mounted || _showingReportUpdate) return;
    _showingReportUpdate = true;
    final responder = report.activeResponderName;
    final String title;
    final String message;
    if (handlerChanged && milestone < 5) {
      title = 'MDRRMO is responding';
      message =
          'Your report has been routed or escalated to MDRRMO. MDRRMO is now handling the response.${_expectedText('response and acceptance', report.expectedResponseSeconds)}';
    } else switch (milestone) {
      case 1:
        title = 'Report under review';
        message =
            'Your report is being reviewed by ${report.handlingUnitName}.${_expectedText('response and acceptance', report.expectedResponseSeconds)}';
        break;
      case 2:
        title = 'Responder dispatched';
        message =
            '${report.handlingUnitName} dispatched ${responder ?? 'a responder'} to your location.';
        break;
      case 3:
        title = 'Responder accepted';
        message =
            '${responder ?? 'A responder'} accepted your report.${_expectedText('arrival', report.expectedArrivalSeconds)}';
        break;
      case 4:
        title = 'Responder arrived';
        message =
            '${responder ?? 'The responder'} arrived in the incident area and is resolving your report.${_expectedText('resolution', report.expectedResolutionSeconds)}';
        break;
      default:
        title = 'Report resolved';
        message = 'Your incident report has been marked resolved.';
    }

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        _showingReportUpdate = false;
        return;
      }
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          title: Text(
            title,
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 22,
            ),
          ),
          content: Text(
            message,
            style: const TextStyle(fontSize: 18, height: 1.4),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      _showingReportUpdate = false;
    });
  }

  String _expectedText(String milestone, double? seconds) {
    if (seconds == null || seconds < 0) return '';
    final totalSeconds = seconds.round();
    final hours = totalSeconds ~/ 3600;
    final minutes = (totalSeconds % 3600) ~/ 60;
    final String text;
    if (hours > 0) {
      final hourLabel = hours == 1 ? 'hour' : 'hours';
      final minuteLabel = minutes == 1 ? 'minute' : 'minutes';
      text = '$hours $hourLabel${minutes == 0 ? '' : ' $minutes $minuteLabel'}';
    } else if (minutes > 0) {
      text = '$minutes ${minutes == 1 ? 'minute' : 'minutes'}';
    } else {
      text = '$totalSeconds ${totalSeconds == 1 ? 'second' : 'seconds'}';
    }
    return '\nExpected $milestone time: $text.';
  }

  Future<void> _refreshLocation({
    bool requestPermission = true,
    bool showResult = false,
  }) async {
    if (_isCheckingLocation) return;
    setState(() => _isCheckingLocation = true);
    final location = await ResidentGpsService.scan(
      requestPermission: requestPermission,
    );
    if (!mounted) return;
    final isInside =
        !NorzagarayBoundary.isEnabled ||
        (location != null && NorzagarayBoundary.containsPoint(location));
    setState(() {
      _isCheckingLocation = false;
      _isInsideNorzagaray = isInside;
      if (!isInside && _currentTab == _ResidentTab.report) {
        _currentTab = _ResidentTab.home;
      }
    });

    if (showResult && !isInside) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            location == null
                ? 'Location unavailable. Enable GPS and refresh to check report access.'
                : 'Reporting is available only inside the active municipality boundary.',
          ),
        ),
      );
    }
  }

  void setTab(int index) {
    final tabs = _visibleTabs;
    if (index < 0 || index >= tabs.length) return;
    setState(() => _currentTab = tabs[index]);
  }

  void switchToHotlines() {
    setState(() => _currentTab = _ResidentTab.hotline);
  }

  Widget _screenFor(_ResidentTab tab, String profileBarangay) {
    final screen = switch (tab) {
      _ResidentTab.home => FeedScreen(
        key: ValueKey('feed-$profileBarangay'),
        onNavigateToHotlines: switchToHotlines,
        onRefreshLocation: () => _refreshLocation(showResult: true),
      ),
      _ResidentTab.evacuation => const EvacuationCentersScreen(),
      _ResidentTab.report => ReportHubScreen(
        onNavigateToHotlines: switchToHotlines,
      ),
      _ResidentTab.hotline => const HotlinesScreen(),
      _ResidentTab.profile => ProfileScreen(
        onAuthStateChanged: _checkAuthState,
      ),
    };
    return KeyedSubtree(key: ValueKey(tab), child: screen);
  }

  @override
  Widget build(BuildContext context) {
    final profileBarangay =
        OfflineService.getProfile()?['barangay_name'] as String? ?? 'Poblacion';
    final tabs = _visibleTabs;
    final selectedIndex = tabs.indexOf(_currentTab).clamp(0, tabs.length - 1);
    final screens = tabs
        .map((tab) => _screenFor(tab, profileBarangay))
        .toList();

    return Scaffold(
      body: IndexedStack(index: selectedIndex, children: screens),
      bottomNavigationBar: _buildBottomBar(tabs),
    );
  }

  Widget _buildBottomBar(List<_ResidentTab> tabs) {
    return Container(
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
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (var index = 0; index < tabs.length; index++)
                _buildNavItem(index: index, tab: tabs[index]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem({required int index, required _ResidentTab tab}) {
    final (label, icon, activeIcon) = switch (tab) {
      _ResidentTab.home => ('Home', Icons.home_outlined, Icons.home_rounded),
      _ResidentTab.evacuation => (
        'Evac Station',
        Icons.location_on_outlined,
        Icons.location_on_rounded,
      ),
      _ResidentTab.report => (
        'Report',
        Icons.add_alert_outlined,
        Icons.add_alert_rounded,
      ),
      _ResidentTab.hotline => (
        'Hotline',
        Icons.phone_in_talk_outlined,
        Icons.phone_in_talk_rounded,
      ),
      _ResidentTab.profile => (
        'Profile',
        Icons.person_outline_rounded,
        Icons.person_rounded,
      ),
    };
    final isSelected = _currentTab == tab;
    const activeColor = Color(0xFF0D9488);
    const inactiveColor = Color(0xFF94A3B8);

    return Expanded(
      child: InkWell(
        onTap: () => setTab(index),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isSelected ? activeIcon : icon,
              color: isSelected ? activeColor : inactiveColor,
              size: 24,
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                color: isSelected ? activeColor : inactiveColor,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
