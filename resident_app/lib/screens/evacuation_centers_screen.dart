import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../core/constants.dart';
import '../services/norzagaray_boundary.dart';
import '../services/offline_service.dart';
import '../services/resident_gps_service.dart';
import '../widgets/resident_gradient_app_bar.dart';

class EvacuationCentersScreen extends StatefulWidget {
  const EvacuationCentersScreen({super.key});

  @override
  State<EvacuationCentersScreen> createState() =>
      _EvacuationCentersScreenState();
}

class _EvacuationCentersScreenState extends State<EvacuationCentersScreen> {
  List<Map<String, dynamic>> _centers = [];
  bool _isLoading = true;
  bool _isOffline = false;
  String? _locationLabel;

  @override
  void initState() {
    super.initState();
    _loadNearestStations();
  }

  Future<void> _loadNearestStations() async {
    if (mounted) setState(() => _isLoading = true);
    var latitude = 14.9133;
    var longitude = 121.0436;
    var locationLabel = 'Norzagaray town center';

    try {
      final location = await ResidentGpsService.scan(requestPermission: true);
      if (location != null) {
        latitude = location.latitude;
        longitude = location.longitude;
        locationLabel = 'your current location';
      }
    } catch (_) {}

    final cachedAt = OfflineService.getEvacCacheTime();
    try {
      final uri = Uri.parse(
        '${AppConstants.apiBaseUrl}/evacuation-centers',
      ).replace(queryParameters: const {'verified_only': 'true'});
      final response = await http
          .get(uri, headers: {'ngrok-skip-browser-warning': 'true'})
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200)
        throw Exception('Could not load stations');
      final stationRows = (jsonDecode(response.body) as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .where(
            (center) => NorzagarayBoundary.contains(
              (center['latitude'] as num?)?.toDouble() ?? 0,
              (center['longitude'] as num?)?.toDouble() ?? 0,
            ),
          )
          .toList();
      final rows =
          stationRows.map((center) {
            final distance = _distanceKm(
              latitude,
              longitude,
              (center['latitude'] as num).toDouble(),
              (center['longitude'] as num).toDouble(),
            );
            return {
              ...center,
              'distance_km': distance,
              'estimated_travel_minutes': (distance * 1.3 / 25 * 60)
                  .round()
                  .clamp(1, 9999),
            };
          }).toList()..sort(
            (a, b) =>
                (a['distance_km'] as num).compareTo(b['distance_km'] as num),
          );
      await OfflineService.saveEvacCenters(stationRows);
      if (mounted) {
        setState(() {
          _centers = rows;
          _isOffline = false;
          _locationLabel = locationLabel;
        });
      }
    } catch (_) {
      final cached =
          OfflineService.getCachedEvacCenters()
              .where((center) => center['is_active'] != false)
              .where(
                (center) => NorzagarayBoundary.contains(
                  (center['latitude'] as num?)?.toDouble() ?? 0,
                  (center['longitude'] as num?)?.toDouble() ?? 0,
                ),
              )
              .map((center) {
                final distance = _distanceKm(
                  latitude,
                  longitude,
                  (center['latitude'] as num?)?.toDouble() ?? latitude,
                  (center['longitude'] as num?)?.toDouble() ?? longitude,
                );
                return {
                  ...center,
                  'distance_km': distance,
                  'estimated_travel_minutes': (distance * 1.3 / 25 * 60)
                      .round()
                      .clamp(1, 9999),
                };
              })
              .toList()
            ..sort(
              (a, b) =>
                  (a['distance_km'] as num).compareTo(b['distance_km'] as num),
            );
      if (mounted) {
        setState(() {
          _centers = cached.take(10).toList();
          _isOffline = true;
          _locationLabel = locationLabel;
        });
      }
      if (cachedAt != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Showing saved station locations from $cachedAt'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3F6FA),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ResidentGradientAppBar(),
        foregroundColor: Colors.white,
        title: const Text(
          'Nearest Evacuation Stations',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            onPressed: _loadNearestStations,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadNearestStations,
              child: ListView(
                padding: const EdgeInsets.all(18),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF123B5D), Color(0xFF087E8B)],
                      ),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.my_location_rounded,
                          color: Colors.white,
                          size: 24,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Stations near',
                                style: TextStyle(
                                  color: Colors.white70,
                                  fontSize: 12,
                                ),
                              ),
                              Text(
                                _locationLabel ?? 'your location',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (_isOffline)
                          const Chip(
                            label: Text('Saved'),
                            visualDensity: VisualDensity.compact,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (_centers.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 64),
                      child: Column(
                        children: [
                          Icon(
                            Icons.location_off_rounded,
                            size: 54,
                            color: Color(0xFF94A3B8),
                          ),
                          SizedBox(height: 12),
                          Text(
                            'No evacuation stations are available yet.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Color(0xFF64748B)),
                          ),
                        ],
                      ),
                    )
                  else
                    ..._centers.asMap().entries.map(
                      (entry) => _stationCard(entry.key, entry.value),
                    ),
                  const SizedBox(height: 12),
                  const Text(
                    'Travel times are estimates based on average road speed and may change with traffic or road conditions.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _stationCard(int index, Map<String, dynamic> center) {
    final distance = (center['distance_km'] as num?)?.toDouble();
    final minutes = (center['estimated_travel_minutes'] as num?)?.round();
    final barangay = center['barangays'] is Map
        ? center['barangays']['name']?.toString()
        : null;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: index == 0
                  ? const Color(0xFFDCFCE7)
                  : const Color(0xFFEFF6FF),
              foregroundColor: index == 0
                  ? const Color(0xFF15803D)
                  : const Color(0xFF2563EB),
              child: Icon(
                index == 0 ? Icons.near_me_rounded : Icons.location_on_rounded,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          center['name']?.toString() ?? 'Evacuation Station',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            color: Color(0xFF0F172A),
                          ),
                        ),
                      ),
                      if (index == 0)
                        const Text(
                          'NEAREST',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF15803D),
                          ),
                        ),
                    ],
                  ),
                  if (barangay != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        barangay,
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 12,
                        ),
                      ),
                    ),
                  if ((center['address']?.toString() ?? '').isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        center['address'].toString(),
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 12,
                        ),
                      ),
                    ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _metricChip(
                        Icons.straighten_rounded,
                        distance == null
                            ? 'Distance unavailable'
                            : '${distance.toStringAsFixed(1)} km',
                      ),
                      _metricChip(
                        Icons.schedule_rounded,
                        minutes == null
                            ? 'Time unavailable'
                            : 'About $minutes min',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _metricChip(IconData icon, String label) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: const Color(0xFFF1F5F9),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: const Color(0xFF0369A1)),
        const SizedBox(width: 5),
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
