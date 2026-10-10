import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:location/location.dart';

import 'socket_service.dart';

class BarangayResponderGpsService {
  final Location _location = Location();
  StreamSubscription<LocationData>? _subscription;
  Timer? _heartbeat;
  LocationData? _latest;
  SocketService? _socket;
  String? _userId;
  bool _starting = false;
  int _session = 0;

  Future<void> start(SocketService socket, String userId) async {
    if (_userId == userId && (_starting || _subscription != null)) return;
    stop();
    final session = _session;
    _socket = socket;
    _userId = userId;
    _starting = true;
    socket.addListener(_emitLatest);
    try {
      var serviceEnabled = await _location.serviceEnabled();
      if (session != _session) return;
      if (!serviceEnabled) {
        serviceEnabled = await _location.requestService();
        if (session != _session || !serviceEnabled) return;
      }

      var permission = await _location.hasPermission();
      if (session != _session) return;
      if (permission == PermissionStatus.denied) {
        permission = await _location.requestPermission();
      }
      if (session != _session || permission != PermissionStatus.granted) return;

      if (!kIsWeb) {
        await _location.changeSettings(
          accuracy: LocationAccuracy.high,
          interval: 5000,
          distanceFilter: 5,
        );
      }

      try {
        _latest = await _location.getLocation();
        if (session != _session) return;
        _emitLatest();
      } catch (error) {
        debugPrint('Could not read barangay responder location: $error');
      }

      _subscription = _location.onLocationChanged.listen((location) {
        _latest = location;
        _emitLatest();
      }, onError: (Object error) {
        debugPrint('Barangay responder location stream error: $error');
      });
      _heartbeat = Timer.periodic(const Duration(seconds: 15), (_) => _emitLatest());
    } catch (error) {
      debugPrint('Could not start barangay responder GPS: $error');
    } finally {
      if (session == _session) _starting = false;
    }
  }

  void _emitLatest() {
    final location = _latest;
    final userId = _userId;
    final latitude = location?.latitude;
    final longitude = location?.longitude;
    if (userId == null || latitude == null || longitude == null) return;
    _socket?.emitBarangayResponderLocation(
      userId: userId,
      latitude: latitude,
      longitude: longitude,
      accuracyM: location?.accuracy,
    );
  }

  void stop() {
    _session += 1;
    _subscription?.cancel();
    _subscription = null;
    _heartbeat?.cancel();
    _heartbeat = null;
    _socket?.removeListener(_emitLatest);
    _socket = null;
    _latest = null;
    _userId = null;
    _starting = false;
  }
}
