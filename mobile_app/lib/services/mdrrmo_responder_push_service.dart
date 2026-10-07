import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_service.dart';

class MdrrmoAssignmentAlert {
  final String reportId;
  final String? assignmentId;
  final String? title;

  const MdrrmoAssignmentAlert({
    required this.reportId,
    this.assignmentId,
    this.title,
  });
}

class MdrrmoResponderPushService {
  MdrrmoResponderPushService._();

  static final MdrrmoResponderPushService instance =
      MdrrmoResponderPushService._();
  static const _handledReportIdsKey =
      'mdrrmo_responder_handled_assignment_report_ids';

  final _assignmentAlerts =
      StreamController<MdrrmoAssignmentAlert>.broadcast();
  final _openedReportIds = StreamController<String>.broadcast();
  final _reportOpenRequests = StreamController<String>.broadcast();
  final Set<String> _handledReportIds = <String>{};

  FirebaseMessaging? _messaging;
  StreamSubscription<RemoteMessage>? _foregroundSubscription;
  StreamSubscription<RemoteMessage>? _openedSubscription;
  StreamSubscription<String>? _tokenRefreshSubscription;
  String? _pendingOpenedReportId;
  String? _pendingReportOpenId;
  String? _authToken;
  String? _responderId;
  String? _registeredFcmToken;
  String? _registeredResponderId;
  bool _initialized = false;

  Stream<MdrrmoAssignmentAlert> get assignmentAlerts =>
      _assignmentAlerts.stream;
  Stream<String> get openedReportIds => _openedReportIds.stream;
  Stream<String> get reportOpenRequests => _reportOpenRequests.stream;

  Future<void> initialize() async {
    if (_initialized || Firebase.apps.isEmpty) return;
    _initialized = true;

    try {
      final preferences = await SharedPreferences.getInstance();
      _handledReportIds.addAll(
        preferences.getStringList(_handledReportIdsKey) ?? const <String>[],
      );

      final messaging = FirebaseMessaging.instance;
      _messaging = messaging;
      await messaging.setForegroundNotificationPresentationOptions(
        alert: false,
        badge: false,
        sound: false,
      );
      _foregroundSubscription ??= FirebaseMessaging.onMessage.listen((message) {
        final assignment = _assignmentFromMessage(message);
        if (assignment == null ||
            assignment.responderId != null &&
                assignment.responderId != _responderId) {
          return;
        }
        unawaited(
          announceAssignment(
            reportId: assignment.reportId,
            assignmentId: assignment.assignmentId,
            title: assignment.title,
          ),
        );
      });
      _openedSubscription ??= FirebaseMessaging.onMessageOpenedApp.listen(
        _handleOpenedMessage,
      );

      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) _handleOpenedMessage(initialMessage);
    } catch (error) {
      _messaging = null;
      debugPrint('MDRRMO responder push notifications unavailable: $error');
    }
  }

  Future<bool> registerForResponder({
    required String authToken,
    required String responderId,
  }) async {
    final messaging = _messaging;
    if (messaging == null || authToken.isEmpty) return false;
    if (defaultTargetPlatform != TargetPlatform.android) return false;

    _authToken = authToken;
    _responderId = responderId;

    try {
      var settings = await messaging.getNotificationSettings();
      if (settings.authorizationStatus == AuthorizationStatus.notDetermined) {
        settings = await messaging.requestPermission(
          alert: true,
          badge: false,
          sound: true,
        );
      }
      if (settings.authorizationStatus != AuthorizationStatus.authorized &&
          settings.authorizationStatus != AuthorizationStatus.provisional) {
        return false;
      }

      final fcmToken = await messaging.getToken();
      if (fcmToken == null || fcmToken.isEmpty) return false;
      await _registerToken(fcmToken);
      _tokenRefreshSubscription ??= messaging.onTokenRefresh.listen((token) {
        unawaited(_registerToken(token));
      });
      return true;
    } catch (error) {
      debugPrint('Could not register MDRRMO responder push token: $error');
      return false;
    }
  }

  Future<void> _registerToken(String fcmToken) async {
    final authToken = _authToken;
    final responderId = _responderId;
    if (authToken == null || responderId == null) return;
    if (_registeredFcmToken == fcmToken &&
        _registeredResponderId == responderId) {
      return;
    }

    try {
      await ApiService.registerMdrrmoResponderPushToken(
        authToken,
        fcmToken,
        platform: 'android',
      );
      _registeredFcmToken = fcmToken;
      _registeredResponderId = responderId;
    } catch (error) {
      debugPrint('Could not save MDRRMO responder push token: $error');
    }
  }

  Future<void> unregisterForResponder(String authToken) async {
    final messaging = _messaging;
    if (messaging != null) {
      try {
        final fcmToken = await messaging.getToken();
        if (fcmToken != null && fcmToken.isNotEmpty) {
          await ApiService.removeMdrrmoResponderPushToken(authToken, fcmToken);
        }
      } catch (error) {
        debugPrint('Could not remove MDRRMO responder push token: $error');
      }
    }
    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = null;
    _authToken = null;
    _responderId = null;
    _registeredFcmToken = null;
    _registeredResponderId = null;
  }

  Future<bool> announceAssignment({
    required String reportId,
    String? assignmentId,
    String? title,
  }) async {
    final normalizedId = reportId.trim();
    if (normalizedId.isEmpty || !_handledReportIds.add(normalizedId)) {
      return false;
    }
    while (_handledReportIds.length > 500) {
      _handledReportIds.remove(_handledReportIds.first);
    }
    unawaited(_persistHandledReports());
    _assignmentAlerts.add(
      MdrrmoAssignmentAlert(
        reportId: normalizedId,
        assignmentId: assignmentId,
        title: title,
      ),
    );
    return true;
  }

  void requestOpenReport(String reportId) {
    if (reportId.isEmpty) return;
    if (_reportOpenRequests.hasListener) {
      _reportOpenRequests.add(reportId);
    } else {
      _pendingReportOpenId = reportId;
    }
  }

  String? takePendingOpenedReportId() {
    final reportId = _pendingOpenedReportId;
    _pendingOpenedReportId = null;
    return reportId;
  }

  String? takePendingReportOpenId() {
    final reportId = _pendingReportOpenId;
    _pendingReportOpenId = null;
    return reportId;
  }

  void _handleOpenedMessage(RemoteMessage message) {
    final assignment = _assignmentFromMessage(message);
    if (assignment == null) return;
    unawaited(_markReportHandled(assignment.reportId));
    if (_openedReportIds.hasListener) {
      _openedReportIds.add(assignment.reportId);
    } else {
      _pendingOpenedReportId = assignment.reportId;
    }
    requestOpenReport(assignment.reportId);
  }

  ({String reportId, String? assignmentId, String? responderId, String? title})?
  _assignmentFromMessage(RemoteMessage message) {
    if (message.data['type'] != 'mdrrmo_report_assignment') return null;
    final reportId = message.data['report_id']?.toString().trim();
    if (reportId == null || reportId.isEmpty) return null;
    return (
      reportId: reportId,
      assignmentId: message.data['assignment_id']?.toString(),
      responderId: message.data['responder_id']?.toString(),
      title: message.data['report_title']?.toString(),
    );
  }

  Future<void> _markReportHandled(String reportId) async {
    if (reportId.isEmpty) return;
    _handledReportIds.add(reportId);
    await _persistHandledReports();
  }

  Future<void> _persistHandledReports() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setStringList(
        _handledReportIdsKey,
        _handledReportIds.toList(growable: false),
      );
    } catch (error) {
      debugPrint('Could not persist handled MDRRMO push alerts: $error');
    }
  }
}
