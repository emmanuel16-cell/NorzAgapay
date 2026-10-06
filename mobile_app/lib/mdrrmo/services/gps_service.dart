import 'package:location/location.dart';
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'socket_service.dart';

class GpsService extends ChangeNotifier {
  static final GpsService _instance = GpsService._internal();
  factory GpsService() => _instance;
  GpsService._internal();

  final Location _location = Location();
  StreamSubscription<LocationData>? _subscription;
  Timer? _syncTimer;
  LocationData? _lastLocation;
  String? _userId;
  void Function(dynamic)? _connectListener;
  dynamic _trackingSocket;
  bool _isStarting = false;
  int _trackingSession = 0;

  LocationData? get lastLocation => _lastLocation;

  Future<void> startTracking(String userId, String token) async {
    if (_userId == userId && (_isStarting || _subscription != null)) return;
    stopTracking();
    final session = _trackingSession;
    _userId = userId;
    _isStarting = true;
    try {
      SocketService.connect(userId, 'responder', token);
      _trackingSocket = SocketService.socket;
      _connectListener = (_) => _emitLatestLocation();
      _trackingSocket.on('connect', _connectListener);

      bool serviceEnabled = await _location.serviceEnabled();
      if (session != _trackingSession) return;
      if (!serviceEnabled) {
        serviceEnabled = await _location.requestService();
        if (session != _trackingSession) return;
        if (!serviceEnabled) return;
      }

      // Web specific permission handling or try-catch for the known PermissionDescriptor error
      PermissionStatus permissionGranted;
      try {
        permissionGranted = await _location.hasPermission();
        if (session != _trackingSession) return;
        if (permissionGranted == PermissionStatus.denied) {
          permissionGranted = await _location.requestPermission();
          if (session != _trackingSession) return;
          if (permissionGranted != PermissionStatus.granted) return;
        }
      } catch (e) {
        debugPrint('Permission check error (expected on some browsers): $e');
        // On web, if the Permissions API query fails, we might still be able to get location
        // if the user previously granted it or if the browser prompts on getLocation()
      }
      if (session != _trackingSession) return;

      // Configure location settings
      if (!kIsWeb) {
        await _location.changeSettings(
          accuracy: LocationAccuracy.high,
          interval: 1000,
          distanceFilter: 1,
        );

        try {
          await _location.enableBackgroundMode(enable: true);
        } catch (e) {
          debugPrint('Background mode not enabled: $e');
        }
      }

      // Get initial location immediately and sync
      try {
        final initialLocation = await _location.getLocation();
        if (session != _trackingSession) return;
        _lastLocation = initialLocation;
        notifyListeners();
        _emitLatestLocation();
      } catch (e) {
        debugPrint('Initial responder location read error: $e');
      }

      // Update location locally whenever it changes
      _subscription = _location.onLocationChanged.listen((
        LocationData current,
      ) {
        _lastLocation = current;
        notifyListeners();
        _emitLatestLocation();
      });

      // Live GPS fixes are sent as they arrive; this heartbeat keeps the server
      // location fresh if the platform pauses location callbacks temporarily.
      _syncTimer = Timer.periodic(
        const Duration(seconds: 15),
        (_) => _emitLatestLocation(),
      );
    } catch (globalError) {
      debugPrint('GpsService startTracking Global Error: $globalError');
    } finally {
      if (session == _trackingSession) {
        _isStarting = false;
        if (_subscription == null) {
          _userId = null;
          if (_connectListener != null)
            _trackingSocket?.off('connect', _connectListener);
          _connectListener = null;
          _trackingSocket = null;
        }
      }
    }
  }

  void _emitLatestLocation() {
    final location = _lastLocation;
    final userId = _userId;
    final latitude = location?.latitude;
    final longitude = location?.longitude;
    if (latitude == null || longitude == null || userId == null) return;
    final socket = _trackingSocket;
    if (socket == null || !socket.connected) return;
    socket.emit('gps:update', {
      'userId': userId,
      'latitude': latitude,
      'longitude': longitude,
    });
  }

  void stopTracking() {
    _trackingSession += 1;
    _subscription?.cancel();
    _subscription = null;
    _syncTimer?.cancel();
    _syncTimer = null;
    if (_connectListener != null) {
      _trackingSocket?.off('connect', _connectListener);
      _connectListener = null;
    }
    _trackingSocket = null;
    _userId = null;
    _lastLocation = null;
    _isStarting = false;
  }
}
