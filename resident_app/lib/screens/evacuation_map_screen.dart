import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import '../core/constants.dart';
import '../services/norzagaray_boundary.dart';
import '../services/offline_service.dart';
import '../services/resident_gps_service.dart';
import '../widgets/resident_gradient_app_bar.dart';
import '../widgets/municipality_boundary_map_layer.dart';

class EvacuationCentersScreen extends StatefulWidget {
  const EvacuationCentersScreen({super.key});

  @override
  State<EvacuationCentersScreen> createState() =>
      _EvacuationCentersScreenState();
}

class _EvacuationCentersScreenState extends State<EvacuationCentersScreen> {
  static const _townCenter = LatLng(14.9133, 121.0436);
  final MapController _mapController = MapController();
  List<Map<String, dynamic>> _centers = [];
  LatLng? _currentLocation;
  bool _isLoading = true;
  bool _isOffline = false;
  String? _loadError;
  String? _selectedStationId;
  String? _selectedBarangay;

  @override
  void initState() {
    super.initState();
    _loadStations();
  }

  Future<void> _loadStations() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _loadError = null;
      });
    }
    final locationFuture = _getCurrentLocation();
    final cachedAt = OfflineService.getEvacCacheTime();
    late List<Map<String, dynamic>> rows;
    var isOffline = false;
    String? loadError;
    try {
      final uri = Uri.parse(
        '${AppConstants.apiBaseUrl}/evacuation-centers',
      ).replace(queryParameters: const {'verified_only': 'true'});
      final response = await http
          .get(uri, headers: const {'ngrok-skip-browser-warning': 'true'})
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) {
        throw Exception('Could not load stations');
      }
      rows = (jsonDecode(response.body) as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .where((row) => row['is_active'] != false)
          .toList();
      await OfflineService.saveEvacCenters(rows);
    } catch (error) {
      rows = OfflineService.getCachedEvacCenters()
          .where((center) => center['is_active'] != false)
          .toList();
      isOffline = true;
      loadError = rows.isEmpty ? error.toString() : null;
    }

    if (!mounted) return;
    final localRows = _withDistances(rows, _currentLocation);
    setState(() {
      _centers = localRows;
      _isOffline = isOffline;
      _loadError = loadError;
      _isLoading = false;
      _selectedStationId = null;
      if (_selectedBarangay != null &&
          !_barangayNamesFor(localRows).contains(_selectedBarangay)) {
        _selectedBarangay = null;
      }
    });
    _moveMapToLoadedCenter();

    final location = await locationFuture;
    if (!mounted) return;
    setState(() {
      _currentLocation = location;
      _centers = _withDistances(rows, location);
    });
    _moveMapToLoadedCenter();

    if (isOffline && cachedAt != null && rows.isNotEmpty && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Showing saved station locations from $cachedAt'),
        ),
      );
    }
  }

  List<Map<String, dynamic>> _withDistances(
    List<Map<String, dynamic>> centers,
    LatLng? origin,
  ) {
    final rows =
        centers
            .where(_hasCoordinates)
            .where(
              (center) =>
                  NorzagarayBoundary.contains(_lat(center), _lng(center)),
            )
            .map((center) {
              final distance = origin == null
                  ? null
                  : _distanceKm(
                      origin.latitude,
                      origin.longitude,
                      _lat(center),
                      _lng(center),
                    );
              return {
                ...center,
                'distance_km': distance,
                'estimated_travel_minutes': distance == null
                    ? null
                    : math.max(1, (distance * 1.3 / 25 * 60).round()),
              };
            })
            .toList()
          ..sort((a, b) {
            final aDistance = a['distance_km'] as num?;
            final bDistance = b['distance_km'] as num?;
            if (aDistance != null && bDistance != null) {
              return aDistance.compareTo(bDistance);
            }
            return (a['name']?.toString() ?? '').compareTo(
              b['name']?.toString() ?? '',
            );
          });
    return rows;
  }

  List<String> _barangayNamesFor(List<Map<String, dynamic>> centers) =>
      centers.map(_barangayName).whereType<String>().toSet().toList()..sort();

  String? _barangayName(Map<String, dynamic> center) {
    final relation = center['barangays'];
    if (relation is Map) return relation['name']?.toString();
    final name = center['barangay_name'] ?? center['barangayName'];
    return name?.toString();
  }

  List<String> get _barangayNames => _barangayNamesFor(_centers);

  List<Map<String, dynamic>> get _visibleCenters => _centers.where((center) {
    return _selectedBarangay == null ||
        _barangayName(center) == _selectedBarangay;
  }).toList();

  bool _hasCoordinates(Map<String, dynamic> center) =>
      _lat(center) != 0 && _lng(center) != 0;

  double _lat(Map<String, dynamic> center) =>
      (center['latitude'] as num?)?.toDouble() ?? 0;

  double _lng(Map<String, dynamic> center) =>
      (center['longitude'] as num?)?.toDouble() ?? 0;

  double _distanceKm(double lat1, double lon1, double lat2, double lon2) {
    const radius = 6371.0;
    final dLat = (lat2 - lat1) * math.pi / 180;
    final dLon = (lon2 - lon1) * math.pi / 180;
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180) *
            math.cos(lat2 * math.pi / 180) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  Future<LatLng?> _getCurrentLocation() async {
    return ResidentGpsService.scan(requestPermission: true);
  }

  LatLng get _mapCenter =>
      (_currentLocation != null &&
              NorzagarayBoundary.containsPoint(_currentLocation!)
          ? _currentLocation!
          : null) ??
      (_visibleCenters.isNotEmpty
          ? LatLng(_lat(_visibleCenters.first), _lng(_visibleCenters.first))
          : _centers.isNotEmpty
          ? LatLng(_lat(_centers.first), _lng(_centers.first))
          : _townCenter);

  void _moveMapToLoadedCenter() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        if (NorzagarayBoundary.isEnabled) {
          _mapController.fitCamera(
            CameraFit.bounds(
              bounds: NorzagarayBoundary.bounds,
              padding: const EdgeInsets.all(28),
            ),
          );
        } else {
          _mapController.move(_mapCenter, 12.5);
        }
      }
    });
  }

  void _selectStation(Map<String, dynamic> center) {
    setState(() => _selectedStationId = center['id']?.toString());
    final point = LatLng(_lat(center), _lng(center));
    _mapController.move(point, 14);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _StationDetailsSheet(center: center),
    );
  }

  Future<void> _findNearestStation() async {
    if (_visibleCenters.isEmpty) return;
    if (_currentLocation == null) {
      final location = await _getCurrentLocation();
      if (!mounted) return;
      if (location == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Turn on GPS and allow location access to find the nearest station.',
            ),
          ),
        );
        return;
      }
      setState(() {
        _currentLocation = location;
        _centers = _withDistances(_centers, location);
      });
      _moveMapToLoadedCenter();
    }
    final visible = _visibleCenters;
    if (visible.isNotEmpty) _selectStation(visible.first);
  }

  void _selectBarangay(String? barangay) {
    setState(() {
      _selectedBarangay = barangay;
      _selectedStationId = null;
    });
    _moveMapToLoadedCenter();
  }

  @override
  Widget build(BuildContext context) {
    final hasStations = _centers.isNotEmpty;
    final visibleCenters = _visibleCenters;
    final hasVisibleStations = visibleCenters.isNotEmpty;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ResidentGradientAppBar(),
        foregroundColor: Colors.white,
        title: const Text(
          'Evacuation Stations',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          if (_isOffline)
            const Padding(
              padding: EdgeInsets.only(right: 4),
              child: Center(child: Icon(Icons.cloud_off_rounded, size: 19)),
            ),
          IconButton(
            onPressed: _isLoading ? null : _loadStations,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _mapCenter,
              initialZoom: 12.5,
              initialCameraFit: NorzagarayBoundary.isEnabled
                  ? CameraFit.bounds(
                      bounds: NorzagarayBoundary.bounds,
                      padding: const EdgeInsets.all(28),
                    )
                  : null,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'ph.gov.mdrrmo.resident_app',
              ),
              MunicipalityBoundaryMarkerLayer(
                markers: [
                  ...visibleCenters.map(
                    (center) => Marker(
                      point: LatLng(_lat(center), _lng(center)),
                      width: 50,
                      height: 54,
                      alignment: Alignment.bottomCenter,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => _selectStation(center),
                        child: Icon(
                          Icons.location_pin,
                          size: 48,
                          color: center['id']?.toString() == _selectedStationId
                              ? const Color(0xFFEA580C)
                              : const Color(0xFF0D9488),
                        ),
                      ),
                    ),
                  ),
                  if (_currentLocation != null &&
                      NorzagarayBoundary.containsPoint(_currentLocation!))
                    Marker(
                      point: _currentLocation!,
                      width: 30,
                      height: 30,
                      child: Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFF2563EB),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 4),
                          boxShadow: const [
                            BoxShadow(color: Color(0x40000000), blurRadius: 7),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
              const MunicipalityBoundaryMapLayer(
                outsideColor: Colors.white,
              ),
            ],
          ),
          if (_isLoading && !hasStations)
            const Center(child: CircularProgressIndicator())
          else if (!hasStations)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Container(
                  constraints: const BoxConstraints(maxWidth: 420),
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .96),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    boxShadow: const [
                      BoxShadow(color: Color(0x180F172A), blurRadius: 20),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CircleAvatar(
                        radius: 28,
                        backgroundColor: Color(0xFFE0F2FE),
                        child: Icon(
                          Icons.location_off_rounded,
                          color: Color(0xFF0284C7),
                          size: 28,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        _isOffline
                            ? 'No saved evacuation stations'
                            : 'No evacuation stations yet',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _isOffline
                            ? 'Connect to the internet and try again to check for registered stations.'
                            : 'There are no registered evacuation stations to show on the map yet.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          height: 1.4,
                        ),
                      ),
                      if (_loadError != null) ...[
                        const SizedBox(height: 12),
                        TextButton.icon(
                          onPressed: _loadStations,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('Try again'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            )
          else ...[
            Positioned(
              top: 14,
              left: 14,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _BarangayFilter(
                    selectedBarangay: _selectedBarangay,
                    barangays: _barangayNames,
                    onChanged: _selectBarangay,
                  ),
                  const SizedBox(height: 8),
                  _MapBadge(
                    icon: Icons.location_on_rounded,
                    label:
                        '${visibleCenters.length} station${visibleCenters.length == 1 ? '' : 's'}',
                  ),
                  if (_currentLocation == null) ...[
                    const SizedBox(height: 8),
                    const _MapBadge(
                      icon: Icons.my_location_rounded,
                      label: 'Location unavailable',
                    ),
                  ] else if (!NorzagarayBoundary.containsPoint(
                    _currentLocation!,
                  )) ...[
                    const SizedBox(height: 8),
                    const _MapBadge(
                      icon: Icons.location_off_rounded,
                      label: 'Location outside Norzagaray',
                    ),
                  ],
                ],
              ),
            ),
            if (!hasVisibleStations)
              Center(
                child: Container(
                  margin: const EdgeInsets.all(24),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 16,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .96),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    boxShadow: const [
                      BoxShadow(color: Color(0x180F172A), blurRadius: 18),
                    ],
                  ),
                  child: Text(
                    'No evacuation stations are registered in ${_selectedBarangay ?? 'this barangay'}.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF475569),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            if (hasVisibleStations)
              Positioned(
                left: 14,
                right: 14,
                bottom: 16,
                child: SafeArea(
                  top: false,
                  child: FilledButton.icon(
                    onPressed: _findNearestStation,
                    icon: const Icon(Icons.near_me_rounded),
                    label: const Text('Find nearest evacuation station'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF0D9488),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 15),
                      elevation: 5,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(15),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _BarangayFilter extends StatelessWidget {
  final String? selectedBarangay;
  final List<String> barangays;
  final ValueChanged<String?> onChanged;

  const _BarangayFilter({
    required this.selectedBarangay,
    required this.barangays,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) => Container(
    width: 280,
    padding: const EdgeInsets.symmetric(horizontal: 12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      boxShadow: const [BoxShadow(color: Color(0x26000000), blurRadius: 8)],
    ),
    child: Row(
      children: [
        const Icon(
          Icons.filter_list_rounded,
          size: 18,
          color: Color(0xFF0D9488),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String?>(
              value: selectedBarangay,
              hint: const Text('All Barangays'),
              isExpanded: true,
              icon: const Icon(Icons.keyboard_arrow_down_rounded),
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('All Barangays'),
                ),
                ...barangays.map(
                  (barangay) => DropdownMenuItem<String?>(
                    value: barangay,
                    child: Text(barangay, overflow: TextOverflow.ellipsis),
                  ),
                ),
              ],
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    ),
  );
}

class _MapBadge extends StatelessWidget {
  final IconData icon;
  final String label;
  const _MapBadge({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      boxShadow: const [BoxShadow(color: Color(0x26000000), blurRadius: 8)],
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 17, color: const Color(0xFF0D9488)),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: Color(0xFF334155),
          ),
        ),
      ],
    ),
  );
}

class _StationDetailsSheet extends StatelessWidget {
  final Map<String, dynamic> center;
  const _StationDetailsSheet({required this.center});

  @override
  Widget build(BuildContext context) {
    final relation = center['barangays'];
    final barangay = relation is Map ? relation['name']?.toString() : null;
    final distance = (center['distance_km'] as num?)?.toDouble();
    final minutes = (center['estimated_travel_minutes'] as num?)?.round();
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFCBD5E1),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              center['name']?.toString() ?? 'Evacuation Station',
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Color(0xFF0F172A),
              ),
            ),
            if (barangay != null)
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Text(
                  barangay,
                  style: const TextStyle(color: Color(0xFF64748B)),
                ),
              ),
            if ((center['address']?.toString() ?? '').isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Text(
                  center['address'].toString(),
                  style: const TextStyle(color: Color(0xFF64748B)),
                ),
              ),
            const SizedBox(height: 18),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _MetricChip(
                  icon: Icons.straighten_rounded,
                  label: distance == null
                      ? 'Turn on GPS to calculate distance'
                      : '${distance.toStringAsFixed(1)} km from your location',
                ),
                _MetricChip(
                  icon: Icons.schedule_rounded,
                  label: minutes == null
                      ? 'Travel time unavailable'
                      : 'About $minutes min by road',
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'Distance is straight-line; travel time is estimated at an average road speed and may vary with road conditions.',
              style: TextStyle(color: Color(0xFF64748B), fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _MetricChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(
      color: const Color(0xFFF1F5F9),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: const Color(0xFF0369A1)),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: Color(0xFF334155),
          ),
        ),
      ],
    ),
  );
}
