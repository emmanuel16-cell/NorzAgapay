import 'package:latlong2/latlong.dart';
import 'package:location/location.dart';

class ResidentGpsService {
  ResidentGpsService._();

  static final Location _location = Location();
  static Future<LatLng?>? _activeScan;

  static Future<LatLng?> scan({bool requestPermission = false}) {
    if (_activeScan != null) return _activeScan!;
    final scan = _readLocation(requestPermission: requestPermission);
    _activeScan = scan;
    return scan.whenComplete(() {
      if (identical(_activeScan, scan)) _activeScan = null;
    });
  }

  static Future<LatLng?> _readLocation({
    required bool requestPermission,
  }) async {
    try {
      var enabled = await _location.serviceEnabled();
      if (!enabled && requestPermission) {
        enabled = await _location.requestService();
      }
      if (!enabled) return null;

      var permission = await _location.hasPermission();
      if (permission == PermissionStatus.denied && requestPermission) {
        permission = await _location.requestPermission();
      }
      if (permission != PermissionStatus.granted) return null;

      final location = await _location.getLocation().timeout(
        const Duration(seconds: 15),
      );
      if (location.latitude == null || location.longitude == null) return null;
      return LatLng(location.latitude!, location.longitude!);
    } catch (_) {
      return null;
    }
  }
}
