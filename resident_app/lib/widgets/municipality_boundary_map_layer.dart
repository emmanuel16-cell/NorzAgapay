import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

import '../services/norzagaray_boundary.dart';

class MunicipalityBoundaryMapLayer extends StatelessWidget {
  final Color outsideColor;
  const MunicipalityBoundaryMapLayer({super.key, required this.outsideColor});

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<int>(
    valueListenable: NorzagarayBoundary.changes,
    builder: (context, _, _) {
      final polygons = NorzagarayBoundary.mapOverlay(outsideColor);
      return polygons.isEmpty
          ? const SizedBox.shrink()
          : PolygonLayer(polygons: polygons);
    },
  );
}

class MunicipalityBoundaryMarkerLayer extends StatelessWidget {
  final List<Marker> markers;
  const MunicipalityBoundaryMarkerLayer({super.key, required this.markers});

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<int>(
    valueListenable: NorzagarayBoundary.changes,
    builder: (context, _, _) => MarkerLayer(
      markers: markers
          .where((marker) => NorzagarayBoundary.containsPoint(marker.point))
          .toList(growable: false),
    ),
  );
}
