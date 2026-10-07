import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../core/constants.dart';

class ResidentReportPushEvent {
  final String reportId;
  final int? revision;

  const ResidentReportPushEvent({required this.reportId, this.revision});
}

/// Android FCM registration and resident report-status push handling.
class ResidentPushService {
  ResidentPushService._();

  static final ResidentPushService instance = ResidentPushService._();

  final StreamController<ResidentReportPushEvent> _statusEvents =
      StreamController<ResidentReportPushEvent>.broadcast();
  final StreamController<String> _openedReports =
      StreamController<String>.broadcast();

  FirebaseMessaging? _messaging;
  StreamSubscription<RemoteMessage>? _foregroundSubscription;
  StreamSubscription<RemoteMessage>? _openedSubscription;
  StreamSubscription<String>? _tokenRefreshSubscription;
  String? _authToken;
  String? _residentId;
  String? _registeredToken;
  String? _registeredResidentId;
  String? _pendingOpenedReportId;

  Stream<ResidentReportPushEvent> get statusEvents => _statusEvents.stream;
  Stream<String> get openedReports => _openedReports.stream;

  Future<void> initialize() async {
    if (Firebase.apps.isEmpty ||
        defaultTargetPlatform != TargetPlatform.android) {
      return;
    }

    try {
      final messaging = FirebaseMessaging.instance;
      _messaging = messaging;

      // In-app report dialogs present status changes while the resident is
      // active. Android displays Firebase notification payloads in background.
      await messaging.setForegroundNotificationPresentationOptions(
        alert: false,
        badge: false,
        sound: false,
      );
      _foregroundSubscription ??= FirebaseMessaging.onMessage.listen((message) {
        final event = _eventFromMessage(message);
        if (event != null) _statusEvents.add(event);
      });
      _openedSubscription ??= FirebaseMessaging.onMessageOpenedApp.listen(
        _handleOpenedMessage,
      );

      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) _handleOpenedMessage(initialMessage);
    } catch (error) {
      _messaging = null;
      debugPrint('Resident push notifications unavailable: $error');
    }
  }

  Future<bool> registerForResident({
    required String authToken,
    required String residentId,
  }) async {
    final messaging = _messaging;
    if (messaging == null || authToken.isEmpty || residentId.isEmpty) {
      return false;
    }

    _authToken = authToken;
    _residentId = residentId;
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

      final token = await messaging.getToken();
      if (token == null || token.isEmpty) return false;
      await _registerToken(token);

      _tokenRefreshSubscription ??= messaging.onTokenRefresh.listen((token) {
        unawaited(_registerToken(token));
      });
      return _registeredToken == token && _registeredResidentId == residentId;
    } catch (error) {
      debugPrint('Could not register resident push token: $error');
      return false;
    }
  }

  Future<void> _registerToken(String token) async {
    final authToken = _authToken;
    final residentId = _residentId;
    if (authToken == null || residentId == null) return;
    if (_registeredToken == token && _registeredResidentId == residentId) {
      return;
    }

    final response = await http
        .put(
          Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/push-token'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $authToken',
            'ngrok-skip-browser-warning': 'true',
          },
          body: jsonEncode({'fcm_token': token, 'platform': 'android'}),
        )
        .timeout(const Duration(seconds: 12));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        'Push-token registration returned ${response.statusCode}.',
      );
    }
    _registeredToken = token;
    _registeredResidentId = residentId;
  }

  Future<void> unregisterForResident(String authToken) async {
    final messaging = _messaging;
    if (messaging != null && authToken.isNotEmpty) {
      try {
        final token = await messaging.getToken();
        if (token != null && token.isNotEmpty) {
          await http
              .delete(
                Uri.parse(
                  '${AppConstants.apiBaseUrl}/auth/resident/push-token',
                ),
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer $authToken',
                  'ngrok-skip-browser-warning': 'true',
                },
                body: jsonEncode({'fcm_token': token}),
              )
              .timeout(const Duration(seconds: 12));
        }
      } catch (error) {
        debugPrint('Could not remove resident push token: $error');
      }
    }
    await _tokenRefreshSubscription?.cancel();
    _tokenRefreshSubscription = null;
    _authToken = null;
    _residentId = null;
    _registeredToken = null;
    _registeredResidentId = null;
  }

  String? takePendingOpenedReportId() {
    final id = _pendingOpenedReportId;
    _pendingOpenedReportId = null;
    return id;
  }

  ResidentReportPushEvent? _eventFromMessage(RemoteMessage message) {
    if (message.data['type'] != 'resident_report_status') return null;
    final id = message.data['report_id']?.toString().trim();
    if (id == null || id.isEmpty) return null;
    final rawRevision = message.data['revision']?.toString();
    return ResidentReportPushEvent(
      reportId: id,
      revision: rawRevision == null ? null : int.tryParse(rawRevision),
    );
  }

  void _handleOpenedMessage(RemoteMessage message) {
    final event = _eventFromMessage(message);
    if (event == null) return;
    if (_openedReports.hasListener) {
      _openedReports.add(event.reportId);
    } else {
      _pendingOpenedReportId = event.reportId;
    }
  }
}
