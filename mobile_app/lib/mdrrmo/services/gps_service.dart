import 'package:location/location.dart';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../core/constants.dart';
import 'socket_service.dart';

class GpsService extends ChangeNotifier {
  static final GpsService _instance = GpsService._internal();
  factory GpsService() => _instance;
  GpsService._internal();

  final Location _location = Location();
  StreamSubscription<LocationData>? _subscription;
  Timer? _syncTimer;
  LocationData? _lastLocation;

  LocationData? get lastLocation => _lastLocation;

  Future<void> startTracking(String userId, String token) async {
    try {
      bool serviceEnabled = await _location.serviceEnabled();
      if (!serviceEnabled) {
        serviceEnabled = await _location.requestService();
        if (!serviceEnabled) return;
      }

      // Web specific permission handling or try-catch for the known PermissionDescriptor error
      PermissionStatus permissionGranted;
      try {
        permissionGranted = await _location.hasPermission();
        if (permissionGranted == PermissionStatus.denied) {
          permissionGranted = await _location.requestPermission();
          if (permissionGranted != PermissionStatus.granted) return;
        }
      } catch (e) {
        debugPrint('Permission check error (expected on some browsers): $e');
        // On web, if the Permissions API query fails, we might still be able to get location
        // if the user previously granted it or if the browser prompts on getLocation()
      }

      // Configure location settings
      if (!kIsWeb) {
        await _location.changeSettings(
          accuracy: LocationAccuracy.high,
          interval: 5000,
          distanceFilter: 10,
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
        _lastLocation = initialLocation;
        notifyListeners();
        
        // Initial REST sync
        await http.post(
          Uri.parse('${AppConstants.apiBaseUrl}/users/$userId/update-location'),
          body: json.encode({
            'latitude': _lastLocation!.latitude,
            'longitude': _lastLocation!.longitude,
          }),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
            'ngrok-skip-browser-warning': 'true',
          },
        );
      } catch (e) {
        debugPrint('Initial GPS sync error: $e');
      }

      // Update location locally whenever it changes
      _subscription = _location.onLocationChanged.listen((LocationData current) {
        _lastLocation = current;
        notifyListeners();
        
        if (SocketService.socket.connected && _lastLocation != null) {
          SocketService.socket.emit('gps:update', {
            'userId': userId,
            'latitude': _lastLocation!.latitude,
            'longitude': _lastLocation!.longitude,
          });
        }
      });

      // Persistent sync to server
      _syncTimer = Timer.periodic(const Duration(seconds: 15), (timer) async {
        if (_lastLocation != null) {
          try {
            await http.post(
              Uri.parse('${AppConstants.apiBaseUrl}/users/$userId/update-location'),
              body: json.encode({
                'latitude': _lastLocation!.latitude,
                'longitude': _lastLocation!.longitude,
              }),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $token',
                'ngrok-skip-browser-warning': 'true',
              },
            );
          } catch (e) {
            debugPrint('GPS REST Sync Error: $e');
          }
        }
      });
    } catch (globalError) {
      debugPrint('GpsService startTracking Global Error: $globalError');
    }
  }

  void stopTracking() {
    _subscription?.cancel();
    _syncTimer?.cancel();
  }
}
