import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'api_service.dart';

class DispatcherReportAlert {
  final String reportId;
  final String? title;

  const DispatcherReportAlert({required this.reportId, this.title});
}

class DispatcherPushService {
  DispatcherPushService._();

  static final DispatcherPushService instance = DispatcherPushService._();
  static const String _settingsBox = 'barangay_settings';
  static const String _handledReportIdsKey =
      'dispatcher_push_handled_report_ids';
  static const String _reportSnapshotIdsKeyPrefix =
      'dispatcher_report_snapshot_ids';
  static final Set<String> _handledReportIds = <String>{};
  static bool _handledReportIdsLoaded = false;

  final StreamController<DispatcherReportAlert> _reportAlerts =
      StreamController<DispatcherReportAlert>.broadcast();
  final StreamController<String> _openedReportIds =
      StreamController<String>.broadcast();

  FirebaseMessaging? _messaging;
  StreamSubscription<RemoteMessage>? _foregroundSubscription;
  StreamSubscription<RemoteMessage>? _openedSubscription;
  StreamSubscription<String>? _tokenRefreshSubscription;
  String? _pendingOpenedReportId;
  String? _authToken;
  String? _userId;
  String? _barangayId;
  String? _registeredFcmToken;
  String? _registeredUserId;

  Stream<DispatcherReportAlert> get reportAlerts => _reportAlerts.stream;
  Stream<String> get openedReportIds => _openedReportIds.stream;
  bool get isConfigured => _messaging != null;

  Future<void> initialize() async {
    if (Firebase.apps.isEmpty) return;

    try {
      final messaging = FirebaseMessaging.instance;
      _messaging = messaging;

      // The app's red in-app alert owns foreground presentation. Suppress a
      // second native banner while the dispatcher is actively using the app.
      await messaging.setForegroundNotificationPresentationOptions(
        alert: false,
        badge: false,
        sound: false,
      );

      _foregroundSubscription ??= FirebaseMessaging.onMessage.listen((message) {
        final reportId = _reportIdFromMessage(message);
        if (reportId != null) {
          announceReport(
            reportId,
            title: message.data['report_title']?.toString(),
          );
        }
      });
      _openedSubscription ??= FirebaseMessaging.onMessageOpenedApp.listen(
        _handleOpenedMessage,
      );

      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) _handleOpenedMessage(initialMessage);
    } catch (error) {
      _messaging = null;
      debugPrint('Dispatcher push notifications unavailable: $error');
    }
  }

  Future<bool> registerForDispatcher({
    required String authToken,
    required String userId,
    required String barangayId,
  }) async {
    final messaging = _messaging;
    if (messaging == null || authToken.isEmpty) return false;
    if (defaultTargetPlatform != TargetPlatform.android) return false;

    _authToken = authToken;
    _userId = userId;
    _barangayId = barangayId;

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
      debugPrint('Could not register dispatcher push token: $error');
      return false;
    }
  }

  Future<void> _registerToken(String fcmToken) async {
    final authToken = _authToken;
    final userId = _userId;
    final barangayId = _barangayId;
    if (authToken == null || userId == null || barangayId == null) return;
    if (_registeredFcmToken == fcmToken && _registeredUserId == userId) return;

    try {
      await ApiService.registerDispatcherPushToken(
        authToken,
        fcmToken,
        platform: 'android',
      );
      _registeredFcmToken = fcmToken;
      _registeredUserId = userId;
    } catch (error) {
      debugPrint('Could not save dispatcher push token: $error');
    }
  }

  Future<void> unregisterForDispatcher(String authToken) async {
    final messaging = _messaging;
    if (messaging != null) {
      try {
        final fcmToken = await messaging.getToken();
        if (fcmToken != null && fcmToken.isNotEmpty) {
          await ApiService.removeDispatcherPushToken(authToken, fcmToken);
        }
      } catch (error) {
        debugPrint('Could not remove dispatcher push token: $error');
      }
    }
    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = null;
    _authToken = null;
    _userId = null;
    _barangayId = null;
    _registeredFcmToken = null;
    _registeredUserId = null;
  }

  String? takePendingOpenedReportId() {
    final reportId = _pendingOpenedReportId;
    _pendingOpenedReportId = null;
    return reportId;
  }

  void announceReport(String reportId, {String? title}) {
    if (reportId.isEmpty) return;
    _reportAlerts.add(DispatcherReportAlert(reportId: reportId, title: title));
  }

  void _handleOpenedMessage(RemoteMessage message) {
    final reportId = _reportIdFromMessage(message);
    if (reportId == null) return;
    markReportAlertHandled(reportId);
    if (_openedReportIds.hasListener) {
      _openedReportIds.add(reportId);
    } else {
      _pendingOpenedReportId = reportId;
    }
  }

  String? _reportIdFromMessage(RemoteMessage message) {
    if (message.data['type'] != 'incident_report') return null;
    final id = message.data['report_id']?.toString().trim();
    return id == null || id.isEmpty ? null : id;
  }

  static bool shouldShowReportAlert(String reportId) {
    if (reportId.isEmpty) return false;
    _loadHandledReportIds();
    if (!_handledReportIds.add(reportId)) return false;
    _trimHandledReportIds();
    _writeStringList(_handledReportIdsKey, _handledReportIds.toList());
    return true;
  }

  static void markReportAlertHandled(String reportId) {
    if (reportId.isEmpty) return;
    _loadHandledReportIds();
    if (!_handledReportIds.add(reportId)) return;
    _trimHandledReportIds();
    _writeStringList(_handledReportIdsKey, _handledReportIds.toList());
  }

  static Set<String>? readReportSnapshotIds({required String scope}) {
    final value = _settings.get('$_reportSnapshotIdsKeyPrefix:$scope');
    if (value is! List) return null;
    return value.map((id) => id.toString()).toSet();
  }

  static Future<void> writeReportSnapshotIds(
    Iterable<String> reportIds, {
    required String scope,
  }) {
    final ids = reportIds.toSet().toList(growable: false);
    return _settings.put('$_reportSnapshotIdsKeyPrefix:$scope', ids);
  }

  static List<String> _readStringList(String key) {
    final value = _settings.get(key);
    return value is List ? value.map((item) => item.toString()).toList() : [];
  }

  static void _loadHandledReportIds() {
    if (_handledReportIdsLoaded) return;
    _handledReportIds.addAll(_readStringList(_handledReportIdsKey));
    _handledReportIdsLoaded = true;
  }

  static void _trimHandledReportIds() {
    while (_handledReportIds.length > 500) {
      _handledReportIds.remove(_handledReportIds.first);
    }
  }

  static void _writeStringList(String key, List<String> values) {
    unawaited(_settings.put(key, values));
  }

  static Box<dynamic> get _settings => Hive.box(_settingsBox);
}
