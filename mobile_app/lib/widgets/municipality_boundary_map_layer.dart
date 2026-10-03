import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

import '../services/municipality_boundary_service.dart';

class MunicipalityBoundaryMapLayer extends StatelessWidget {
  final Color outsideColor;
  const MunicipalityBoundaryMapLayer({super.key, required this.outsideColor});

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: MunicipalityBoundaryService.instance,
    builder: (context, _) {
      final polygons = MunicipalityBoundaryService.instance.mapOverlay(
        outsideColor,
      );
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
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: MunicipalityBoundaryService.instance,
    builder: (context, _) => MarkerLayer(
      markers: markers
          .where(
            (marker) =>
                MunicipalityBoundaryService.instance.contains(marker.point),
          )
          .toList(growable: false),
    ),
  );
}
