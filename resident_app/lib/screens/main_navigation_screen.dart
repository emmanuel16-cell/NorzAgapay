import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../core/constants.dart';
import '../models/incident_report.dart';
import '../services/norzagaray_boundary.dart';
import '../services/offline_service.dart';
import '../services/report_updates_service.dart';
import '../services/incident_socket_service.dart';
import '../services/evidence_upload_service.dart';
import '../services/resident_gps_service.dart';
import '../services/resident_push_service.dart';
import '../services/notification_sound_service.dart';
import 'evacuation_map_screen.dart';
import 'feed_screen.dart';
import 'hotlines_screen.dart';
import 'profile_screen.dart';
import 'report_hub_screen.dart';
import 'my_reports_screen.dart';

enum _ResidentTab { home, evacuation, report, hotline, profile }

class _ResidentReportNotice {
  final IncidentReport report;
  final bool isReview;
  final int milestone;
  final bool handlerChanged;

  const _ResidentReportNotice({
    required this.report,
    required this.isReview,
    this.milestone = 0,
    this.handlerChanged = false,
  });
}

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
  final IncidentSocketService _incidentSocket = IncidentSocketService();
  bool _hasLoadedReportSnapshot = false;
  bool _isLoadingResidentReports = false;
  bool _residentReportRefreshQueued = false;
  bool _drainingReportNotices = false;
  final Queue<_ResidentReportNotice> _reportNoticeQueue =
      Queue<_ResidentReportNotice>();
  final Set<String> _queuedOrShownReportNoticeKeys = <String>{};
  final Map<String, int> _reportMilestones = {};
  final Map<String, String> _reportHandlers = {};
  StreamSubscription<ResidentReportPushEvent>? _residentPushSubscription;
  StreamSubscription<String>? _openedResidentPushSubscription;

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
    _residentPushSubscription = ResidentPushService.instance.statusEvents
        .listen((event) {
          if (_isLoggedIn) {
            unawaited(_refreshResidentReportById(event.reportId));
          }
        });
    _openedResidentPushSubscription = ResidentPushService.instance.openedReports
        .listen((_) => _openMyReportsFromPush());
    if (ResidentPushService.instance.takePendingOpenedReportId() != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _openMyReportsFromPush();
      });
    }
    if (_isLoggedIn) {
      unawaited(_refreshLocation(requestPermission: true));
      unawaited(_loadResidentReportSnapshot());
      _connectResidentRealtime();
      _registerResidentPushToken();
    }
  }

  @override
  void dispose() {
    NorzagarayBoundary.changes.removeListener(_onBoundaryChanged);
    unawaited(_residentPushSubscription?.cancel());
    unawaited(_openedResidentPushSubscription?.cancel());
    _reportNoticeQueue.clear();
    _incidentSocket.disconnect();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(NorzagarayBoundary.refresh());
      if (_isLoggedIn) {
        unawaited(_refreshLocation(requestPermission: false));
        unawaited(_loadResidentReportSnapshot());
        _connectResidentRealtime();
      }
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
    if (!mounted) return;
    if (isLoggedIn == _isLoggedIn) {
      // Rebuild barangay-scoped screens even when the resident remains signed in.
      setState(() {});
      if (isLoggedIn) _registerResidentPushToken();
      return;
    }
    setState(() {
      _isLoggedIn = isLoggedIn;
      if (!_visibleTabs.contains(_currentTab)) _currentTab = _ResidentTab.home;
    });
    if (isLoggedIn) {
      unawaited(_refreshLocation(requestPermission: true));
      _hasLoadedReportSnapshot = false;
      _reportMilestones.clear();
      _reportHandlers.clear();
      unawaited(_loadResidentReportSnapshot());
      _connectResidentRealtime();
      _registerResidentPushToken();
    } else {
      _incidentSocket.disconnect();
      _hasLoadedReportSnapshot = false;
      _reportMilestones.clear();
      _reportHandlers.clear();
      ResidentReportUpdates.publish(const []);
    }
  }

  void _registerResidentPushToken() {
    final profile = OfflineService.getProfile();
    final token = profile?['token']?.toString();
    final residentId = profile?['user_id']?.toString();
    if (!_isLoggedIn || token == null || token.isEmpty ||
        residentId == null || residentId.isEmpty) {
      return;
    }
    unawaited(ResidentPushService.instance.registerForResident(
      authToken: token,
      residentId: residentId,
    ));
  }

  void _openMyReportsFromPush() {
    if (!mounted || !_isLoggedIn) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_isLoggedIn) return;
      Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const MyReportsScreen()),
      );
    });
  }

  void _connectResidentRealtime() {
    final profile = OfflineService.getProfile();
    final token = profile?['token']?.toString();
    final userId = profile?['user_id']?.toString();
    if (token == null || token.isEmpty || userId == null || userId.isEmpty) {
      return;
    }
    unawaited(EvidenceUploadService.retryPending());
    _incidentSocket.connect(
      url: AppConstants.socketUrl,
      token: token,
      userId: userId,
      onConnected: _refreshResidentReportStatus,
      onReportLifecycle: _refreshResidentReportById,
    );
  }

  Future<void> _refreshResidentReportById(String reportId) async {
    final profile = OfflineService.getProfile();
    final token = profile?['token']?.toString();
    final contactNumber = profile?['contact_number']?.toString();
    try {
      final uri = Uri.parse(
        '${AppConstants.apiBaseUrl}/incident-reports/resident/$reportId',
      ).replace(
        queryParameters: token == null || token.isEmpty
            ? {'contact_number': contactNumber ?? ''}
            : null,
      );
      final response = await http
          .get(
            uri,
            headers: {
              'ngrok-skip-browser-warning': 'true',
              if (token != null && token.isNotEmpty)
                'Authorization': 'Bearer $token',
            },
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200 || !mounted) return;
      final report = IncidentReport.fromJson(
        Map<String, dynamic>.from(jsonDecode(response.body) as Map),
      );
      final reports = List<IncidentReport>.from(ResidentReportUpdates.reports.value);
      final index = reports.indexWhere((item) => item.id == report.id);
      if (index >= 0 && reports[index].lifecycleRevision > report.lifecycleRevision) {
        return;
      }
      if (index == -1) {
        reports.insert(0, report);
      } else {
        reports[index] = report;
      }
      ResidentReportUpdates.publish(reports);

      final id = report.id;
      if (id == null) return;
      if ((report.displayStatus == 'inconclusive' ||
              report.displayStatus == 'false_report') &&
          !OfflineService.hasSeenReviewNotice(id)) {
        _queueReviewNotice(report);
        return;
      }
      if (!_hasLoadedReportSnapshot) {
        _reportMilestones[id] = _reportMilestone(report);
        _reportHandlers[id] = _reportHandler(report);
        return;
      }
      final milestone = _reportMilestone(report);
      final previousMilestone = _reportMilestones[id] ?? 0;
      final handler = _reportHandler(report);
      final previousHandler = _reportHandlers[id];
      final isHandoffToMdrrmo = previousHandler != null &&
          previousHandler != handler && handler == 'mdrrmo';
      _reportMilestones[id] = milestone;
      _reportHandlers[id] = handler;
      if (milestone > previousMilestone || isHandoffToMdrrmo) {
        _queueReportUpdateNotice(
          report,
          milestone,
          handlerChanged: isHandoffToMdrrmo,
        );
      }
    } catch (error) {
      debugPrint('Resident lifecycle refresh failed for $reportId: $error');
    }
  }

  void _refreshResidentReportStatus() {
    if (_isLoadingResidentReports) {
      _residentReportRefreshQueued = true;
      return;
    }
    unawaited(_loadResidentReportSnapshot());
  }

  Future<void> _loadResidentReportSnapshot() async {
    if (!_isLoggedIn || _isLoadingResidentReports) return;
    final profile = OfflineService.getProfile();
    final contactNumber = profile?['contact_number']?.toString();
    final token = profile?['token']?.toString();
    final hasContact = contactNumber != null && contactNumber.trim().isNotEmpty;
    final hasToken = token != null && token.isNotEmpty;
    if (!hasContact && !hasToken) return;

    _isLoadingResidentReports = true;
    try {
      final response = await http
          .get(
            Uri.parse('${AppConstants.apiBaseUrl}/incident-reports/resident')
                .replace(queryParameters: hasContact ? {'contact_number': contactNumber} : null),
            headers: {
              'ngrok-skip-browser-warning': 'true',
              if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
            },
          )
          .timeout(const Duration(seconds: 12));
      if (response.statusCode == 403 && hasToken && mounted) {
        await ResidentPushService.instance.unregisterForResident(token);
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

      final serverReports = (jsonDecode(response.body) as List)
          .map(
            (item) =>
                IncidentReport.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList();
      final existing = ResidentReportUpdates.reports.value;
      final existingById = <String, IncidentReport>{
        for (final report in existing)
          if (report.id != null) report.id!: report,
      };
      final incomingIds = serverReports.map((report) => report.id).whereType<String>().toSet();
      final mergedReports = serverReports.map((report) {
        final previous = report.id == null ? null : existingById[report.id];
        return previous != null && previous.lifecycleRevision > report.lifecycleRevision
            ? previous
            : report;
      }).toList();
      // Keep an event-fetched report that arrived after this full snapshot began.
      mergedReports.insertAll(
        0,
        existing.where((report) => report.id != null && !incomingIds.contains(report.id)),
      );
      ResidentReportUpdates.publish(mergedReports);
      final reports = mergedReports;
      for (final report in reports) {
        final id = report.id;
        if (id == null ||
            (report.displayStatus != 'inconclusive' &&
                report.displayStatus != 'false_report') ||
            OfflineService.hasSeenReviewNotice(id)) {
          continue;
        }
        _queueReviewNotice(report);
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
        final isReviewOutcome = report.displayStatus == 'inconclusive' ||
            report.displayStatus == 'false_report';
        if (!isReviewOutcome &&
            (milestone > previous || isHandoffToMdrrmo)) {
          _queueReportUpdateNotice(
            report,
            milestone,
            handlerChanged: isHandoffToMdrrmo,
          );
        }
        _reportMilestones[id] = milestone;
        _reportHandlers[id] = handler;
      }
    } catch (_) {
      // Initial load, lifecycle events, and reconnect catch-up retry failures.
    } finally {
      _isLoadingResidentReports = false;
      if (_residentReportRefreshQueued) {
        _residentReportRefreshQueued = false;
        scheduleMicrotask(_refreshResidentReportStatus);
      }
    }
  }

  void _queueReviewNotice(IncidentReport report) {
    final id = report.id;
    if (id == null) return;
    final key = 'review:$id:${report.displayStatus}';
    if (!_queuedOrShownReportNoticeKeys.add(key)) return;
    _reportNoticeQueue.add(
      _ResidentReportNotice(report: report, isReview: true),
    );
    _scheduleReportNoticeDrain();
  }

  void _queueReportUpdateNotice(
    IncidentReport report,
    int milestone, {
    bool handlerChanged = false,
  }) {
    final id = report.id;
    if (id == null) return;
    final key = 'status:$id:$milestone:${_reportHandler(report)}';
    if (!_queuedOrShownReportNoticeKeys.add(key)) return;
    _reportNoticeQueue.add(
      _ResidentReportNotice(
        report: report,
        isReview: false,
        milestone: milestone,
        handlerChanged: handlerChanged,
      ),
    );
    _scheduleReportNoticeDrain();
  }

  void _scheduleReportNoticeDrain() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_drainReportNoticeQueue());
    });
  }

  Future<void> _drainReportNoticeQueue() async {
    if (!mounted || _drainingReportNotices) return;
    _drainingReportNotices = true;
    try {
      while (mounted && _reportNoticeQueue.isNotEmpty) {
        final notice = _reportNoticeQueue.removeFirst();
        if (notice.isReview) {
          await _presentReviewNotice(notice.report);
        } else {
          await _presentReportUpdatePopup(
            notice.report,
            notice.milestone,
            handlerChanged: notice.handlerChanged,
          );
        }
      }
    } finally {
      _drainingReportNotices = false;
      if (mounted && _reportNoticeQueue.isNotEmpty) {
        _scheduleReportNoticeDrain();
      }
    }
  }

  Future<void> _presentReviewNotice(IncidentReport report) async {
    if (!mounted) return;
    final id = report.id;
    if (id == null) return;
    unawaited(NotificationSoundService.play(ResidentNotificationSound.review));
    final isInconclusive = report.displayStatus == 'inconclusive';
    final reason = report.reviewReason?.trim();
    final message = isInconclusive
        ? 'MDRRMO could not confirm your report, so it has been marked inconclusive.${reason?.isNotEmpty == true ? '\n\nReason: $reason' : ''}'
        : 'MDRRMO marked this report as a false report. It will not be dispatched.';

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
  }

  int _reportMilestone(IncidentReport report) {
    if (report.resolvedAt != null || report.displayStatus == 'resolved') {
      return 5;
    }
    if (report.arrivedAt != null) {
      return 4;
    }
    if (report.acceptedAt != null) {
      return 3;
    }
    if (report.dispatchedAt != null) {
      return 2;
    }
    if (report.dispatcherReviewedAt != null) {
      return 1;
    }
    return 0;
  }

  String _reportHandler(IncidentReport report) =>
      report.isMdrrmoHandled ? 'mdrrmo' : 'barangay';

  Future<void> _presentReportUpdatePopup(
    IncidentReport report,
    int milestone, {
    bool handlerChanged = false,
  }) async {
    if (!mounted) {
      return;
    }
    final sound = handlerChanged
        ? ResidentNotificationSound.dispatch
        : switch (milestone) {
            1 => ResidentNotificationSound.review,
            2 || 3 => ResidentNotificationSound.dispatch,
            4 => ResidentNotificationSound.arrival,
            _ => ResidentNotificationSound.resolved,
          };
    unawaited(NotificationSoundService.play(sound));
    final responder = report.activeResponderName;
    final String title;
    final String message;
    if (handlerChanged && milestone < 5) {
      title = 'MDRRMO is responding';
      message =
          'Your report has been routed or escalated to MDRRMO. MDRRMO is now handling the response.${_expectedText('response and acceptance', report.expectedResponseSeconds)}';
    } else {
      switch (milestone) {
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

  Widget _screenFor(_ResidentTab tab, String barangayScope) {
    final screen = switch (tab) {
      _ResidentTab.home => FeedScreen(
        key: ValueKey('feed-$barangayScope'),
        onNavigateToHotlines: switchToHotlines,
        onRefreshLocation: () => _refreshLocation(showResult: true),
      ),
      _ResidentTab.evacuation => EvacuationCentersScreen(
        key: ValueKey('evacuation-$barangayScope'),
      ),
      _ResidentTab.report => ReportHubScreen(
        key: ValueKey('report-$barangayScope'),
        onNavigateToHotlines: switchToHotlines,
      ),
      _ResidentTab.hotline => HotlinesScreen(
        key: ValueKey('hotline-$barangayScope'),
      ),
      _ResidentTab.profile => ProfileScreen(
        key: const ValueKey('profile'),
        onAuthStateChanged: _checkAuthState,
      ),
    };
    final screenKey = tab == _ResidentTab.profile
        ? tab.name
        : '${tab.name}-$barangayScope';
    return KeyedSubtree(key: ValueKey(screenKey), child: screen);
  }

  @override
  Widget build(BuildContext context) {
    final profile = OfflineService.getProfile();
    final profileBarangay = profile?['barangay_name'] as String? ?? 'Poblacion';
    final barangayScope = profile?['barangay_id']?.toString().trim().isNotEmpty == true
        ? profile!['barangay_id'].toString()
        : profileBarangay;
    final tabs = _visibleTabs;
    final selectedIndex = tabs.indexOf(_currentTab).clamp(0, tabs.length - 1);
    final screens = tabs
        .map((tab) => _screenFor(tab, barangayScope))
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
