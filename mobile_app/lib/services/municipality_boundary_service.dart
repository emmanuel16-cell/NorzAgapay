import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../mdrrmo/core/constants.dart';

class MunicipalityBoundaryService extends ChangeNotifier {
  MunicipalityBoundaryService._();
  static final MunicipalityBoundaryService instance =
      MunicipalityBoundaryService._();
  static const _cacheKey = 'municipality_boundary_config';
  static const _worldRing = <LatLng>[
    LatLng(-85, -180),
    LatLng(-85, 180),
    LatLng(85, 180),
    LatLng(85, -180),
    LatLng(-85, -180),
  ];

  List<List<List<LatLng>>> _polygons = const [];
  bool enabled = false;
  int revision = 0;
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;
    final preferences = await SharedPreferences.getInstance();
    final cached = preferences.getString(_cacheKey);
    if (cached != null) {
      try {
        _apply(jsonDecode(cached), notify: false);
      } catch (_) {}
    }
    unawaited(refresh());
  }

  Future<void> refresh() async {
    try {
      final response = await http
          .get(
            Uri.parse('${AppConstants.apiBaseUrl}/municipality-boundary'),
            headers: const {'ngrok-skip-browser-warning': 'true'},
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return;
      final decoded = jsonDecode(response.body);
      _apply(decoded);
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString(_cacheKey, response.body);
    } catch (_) {
      // Keep the most recently cached configuration. With no cache, the full
      // map remains visible and unrestricted.
    }
  }

  void _apply(dynamic value, {bool notify = true}) {
    if (value is! Map) return;
    final geometryValue = value['geometry'];
    final geometry = geometryValue is Map && geometryValue['type'] == 'Feature'
        ? geometryValue['geometry']
        : geometryValue;
    final parsed = <List<List<LatLng>>>[];
    if (geometry is Map &&
        geometry['type'] == 'Polygon' &&
        geometry['coordinates'] is List) {
      parsed.add(_parsePolygon(geometry['coordinates'] as List));
    } else if (geometry is Map &&
        geometry['type'] == 'MultiPolygon' &&
        geometry['coordinates'] is List) {
      for (final polygon in geometry['coordinates'] as List) {
        if (polygon is List) parsed.add(_parsePolygon(polygon));
      }
    }
    _polygons = parsed;
    enabled = value['enabled'] == true && parsed.isNotEmpty;
    revision = (value['revision'] as num?)?.toInt() ?? 0;
    if (notify) notifyListeners();
  }

  List<List<LatLng>> _parsePolygon(List rings) => rings
      .whereType<List>()
      .map(
        (ring) => ring
            .whereType<List>()
            .where((coordinate) => coordinate.length >= 2)
            .map((coordinate) {
              return LatLng(
                (coordinate[1] as num).toDouble(),
                (coordinate[0] as num).toDouble(),
              );
            })
            .toList(growable: false),
      )
      .where((ring) => ring.length >= 4)
      .toList(growable: false);

  bool contains(LatLng point) {
    if (!enabled || _polygons.isEmpty) return true;
    return _polygons.any(
      (rings) =>
          rings.isNotEmpty &&
          _containsInRing(point, rings.first) &&
          !rings.skip(1).any((ring) => _containsInRing(point, ring)),
    );
  }

  List<Polygon<Object>> mapOverlay(Color outsideColor) {
    if (!enabled || _polygons.isEmpty) return const [];
    final maskHoles = _polygons
        .map((rings) => rings.first)
        .toList(growable: false);
    final overlays = <Polygon<Object>>[
      Polygon<Object>(
        points: _worldRing,
        holePointsList: maskHoles,
        color: outsideColor,
        disableHolesBorder: true,
      ),
    ];
    for (final rings in _polygons) {
      for (final hole in rings.skip(1)) {
        overlays.add(Polygon<Object>(points: hole, color: outsideColor));
      }
    }
    overlays.addAll(
      _polygons.map(
        (rings) => Polygon<Object>(
          points: rings.first,
          holePointsList: rings.skip(1).toList(growable: false),
          color: Colors.transparent,
          borderColor: const Color(0xFF263238),
          borderStrokeWidth: 1.5,
        ),
      ),
    );
    return overlays;
  }

  bool _containsInRing(LatLng point, List<LatLng> ring) {
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
}
