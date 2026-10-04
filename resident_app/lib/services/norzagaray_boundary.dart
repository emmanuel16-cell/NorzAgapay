import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import '../core/constants.dart';
import 'offline_service.dart';

/// Shared optional municipality geometry used by resident maps and report checks.
class NorzagarayBoundary {
  NorzagarayBoundary._();

  static const LatLng townCenter = LatLng(14.9133, 121.0436);
  static const List<LatLng> _worldRing = [
    LatLng(-85, -180),
    LatLng(-85, 180),
    LatLng(85, 180),
    LatLng(85, -180),
    LatLng(-85, -180),
  ];
  static final ValueNotifier<int> changes = ValueNotifier<int>(0);
  static List<_BoundaryPolygon> _polygons = const [];
  static LatLngBounds _bounds = LatLngBounds(
    const LatLng(14.6, 120.8),
    const LatLng(15.3, 121.5),
  );
  static bool _loaded = false;
  static bool _enabled = false;
  static int revision = 0;
  static bool get isEnabled => _enabled && _polygons.isNotEmpty;

  static Future<void> load() async {
    if (_loaded) return;
    final raw = await rootBundle.loadString(
      'assets/maps/norzagaray_boundary.geojson',
    );
    final feature = jsonDecode(raw) as Map<String, dynamic>;
    _setGeometry(feature['geometry'], enabled: false, notify: false);
    _loaded = true;

    final cached = OfflineService.getMunicipalityBoundaryConfig();
    if (cached != null) _applyConfiguration(cached, notify: false);
  }

  static Future<void> refresh() async {
    try {
      final response = await http
          .get(
            Uri.parse('${AppConstants.apiBaseUrl}/municipality-boundary'),
            headers: const {'ngrok-skip-browser-warning': 'true'},
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return;
      final config = jsonDecode(response.body) as Map<String, dynamic>;
      _applyConfiguration(config);
      await OfflineService.saveMunicipalityBoundaryConfig(config);
    } catch (_) {
      // Keep the last downloaded configuration; if none exists, maps are unrestricted.
    }
  }

  static void _applyConfiguration(
    Map<String, dynamic> config, {
    bool notify = true,
  }) {
    final geometryValue = config['geometry'];
    final geometry = geometryValue is Map && geometryValue['type'] == 'Feature'
        ? geometryValue['geometry']
        : geometryValue;
    _setGeometry(geometry, enabled: config['enabled'] == true, notify: notify);
    revision = (config['revision'] as num?)?.toInt() ?? 0;
  }

  static void _setGeometry(
    dynamic geometry, {
    required bool enabled,
    bool notify = true,
  }) {
    final polygons = <_BoundaryPolygon>[];
    if (geometry is Map &&
        geometry['type'] == 'Polygon' &&
        geometry['coordinates'] is List) {
      polygons.add(_parsePolygon(geometry['coordinates'] as List));
    } else if (geometry is Map &&
        geometry['type'] == 'MultiPolygon' &&
        geometry['coordinates'] is List) {
      for (final polygon in geometry['coordinates'] as List) {
        if (polygon is List) polygons.add(_parsePolygon(polygon));
      }
    }
    _polygons = polygons
        .where((polygon) => polygon.outer.length >= 4)
        .toList(growable: false);
    final allPoints = _polygons.expand((polygon) => polygon.outer).toList();
    if (allPoints.isNotEmpty) _bounds = LatLngBounds.fromPoints(allPoints);
    _enabled = enabled && _polygons.isNotEmpty;
    _loaded = true;
    if (notify) changes.value++;
  }

  static _BoundaryPolygon _parsePolygon(List<dynamic> rings) {
    final parsedRings = rings
        .whereType<List>()
        .map((ring) {
          return ring
              .whereType<List>()
              .where((coordinate) => coordinate.length >= 2)
              .map((coordinate) {
                return LatLng(
                  (coordinate[1] as num).toDouble(),
                  (coordinate[0] as num).toDouble(),
                );
              })
              .toList(growable: false);
        })
        .toList(growable: false);
    if (parsedRings.isEmpty)
      return const _BoundaryPolygon(outer: [], holes: []);
    return _BoundaryPolygon(
      outer: parsedRings.first,
      holes: parsedRings.skip(1).toList(growable: false),
    );
  }

  static bool contains(double latitude, double longitude) =>
      containsPoint(LatLng(latitude, longitude));

  static bool containsPoint(LatLng point) {
    if (!isEnabled) return true;
    for (final polygon in _polygons) {
      if (_containsInRing(point, polygon.outer) &&
          !polygon.holes.any((hole) => _containsInRing(point, hole))) {
        return true;
      }
    }
    return false;
  }

  static bool _containsInRing(LatLng point, List<LatLng> ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      final a = ring[i];
      final b = ring[j];
      if ((a.latitude > point.latitude) == (b.latitude > point.latitude))
        continue;
      final crossingLongitude =
          (b.longitude - a.longitude) *
              (point.latitude - a.latitude) /
              (b.latitude - a.latitude) +
          a.longitude;
      if (point.longitude < crossingLongitude) inside = !inside;
    }
    return inside;
  }

  static LatLngBounds get bounds => _bounds;

  static LatLngBounds get cameraBounds => LatLngBounds(
    LatLng(_bounds.south - 0.04, _bounds.west - 0.04),
    LatLng(_bounds.north + 0.04, _bounds.east + 0.04),
  );

  static List<Polygon<Object>> get outlinePolygons {
    if (!isEnabled) return const [];
    return _polygons
        .map(
          (polygon) => Polygon<Object>(
            points: polygon.outer,
            holePointsList: polygon.holes,
            color: Colors.transparent,
            borderColor: const Color(0xFF263238),
            borderStrokeWidth: 1.5,
          ),
        )
        .toList(growable: false);
  }

  /// Paints over tiles and markers outside the enabled polygon while leaving
  /// its interior transparent. A disabled or missing boundary paints nothing.
  static List<Polygon<Object>> mapOverlay(Color outsideColor) {
    if (!isEnabled) return const [];
    final polygons = <Polygon<Object>>[
      Polygon<Object>(
        points: _worldRing,
        holePointsList: _polygons
            .map((polygon) => polygon.outer)
            .toList(growable: false),
        color: outsideColor,
        disableHolesBorder: true,
      ),
    ];
    for (final polygon in _polygons) {
      for (final hole in polygon.holes) {
        polygons.add(Polygon<Object>(points: hole, color: outsideColor));
      }
    }
    polygons.addAll(outlinePolygons);
    return polygons;
  }
}

class _BoundaryPolygon {
  final List<LatLng> outer;
  final List<List<LatLng>> holes;

  const _BoundaryPolygon({required this.outer, required this.holes});
}
