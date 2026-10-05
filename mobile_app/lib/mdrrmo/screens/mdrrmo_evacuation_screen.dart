import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:location/location.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../services/municipality_boundary_service.dart';
import '../../widgets/municipality_boundary_map_layer.dart';
import '../models/evacuation_center.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class MdrrmoEvacuationScreen extends StatefulWidget {
  const MdrrmoEvacuationScreen({super.key});

  @override
  State<MdrrmoEvacuationScreen> createState() => _MdrrmoEvacuationScreenState();
}

class _MdrrmoEvacuationScreenState extends State<MdrrmoEvacuationScreen> {
  static const _townCenter = LatLng(14.9133, 121.0436);
  static const _cacheKey = 'mdrrmo_active_evacuation_centers';
  final _mapController = MapController();
  final _location = Location();
  List<Map<String, dynamic>> _centers = [];
  LatLng? _currentLocation;
  String? _selectedBarangay;
  String? _selectedId;
  bool _loading = true;
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  double _number(dynamic value) => (value as num?)?.toDouble() ?? 0;
  double _lat(Map<String, dynamic> row) => _number(row['latitude']);
  double _lng(Map<String, dynamic> row) => _number(row['longitude']);
  bool _hasPoint(Map<String, dynamic> row) => _lat(row) != 0 && _lng(row) != 0;
  String? _barangayName(Map<String, dynamic> row) {
    final relation = row['barangays'];
    if (relation is Map) return relation['name']?.toString();
    return (row['barangay_name'] ?? row['barangayName'])?.toString();
  }

  Future<void> _load() async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    setState(() => _loading = true);
    var offline = false;
    List<Map<String, dynamic>> rows;
    try {
      final centers = await ApiService.getEvacCenters(token);
      rows = centers
          .where((center) => center.isActive && center.latitude != 0 && center.longitude != 0)
          .map((center) => <String, dynamic>{
                'id': center.id,
                'name': center.name,
                'address': center.address,
                'latitude': center.latitude,
                'longitude': center.longitude,
                'barangay_id': center.barangayId,
                'barangay_name': center.barangayName,
                'is_active': center.isActive,
              })
          .where((row) => MunicipalityBoundaryService.instance.contains(LatLng(_lat(row), _lng(row))))
          .toList();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_cacheKey, jsonEncode(rows));
    } catch (_) {
      offline = true;
      try {
        final prefs = await SharedPreferences.getInstance();
        rows = (jsonDecode(prefs.getString(_cacheKey) ?? '[]') as List)
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .where((row) => row['is_active'] != false && _hasPoint(row))
            .toList();
      } catch (_) {
        rows = [];
      }
    }
    if (!mounted) return;
    setState(() {
      _centers = _withDistances(rows);
      _offline = offline;
      _loading = false;
      _selectedId = null;
      if (_selectedBarangay != null && !_barangays.contains(_selectedBarangay)) _selectedBarangay = null;
    });
    _moveToCenter();
    await _refreshLocation(requestPermission: false);
  }

  List<String> get _barangays => _centers.map(_barangayName).whereType<String>().toSet().toList()..sort();
  List<Map<String, dynamic>> get _visible => _centers.where((row) => _selectedBarangay == null || _barangayName(row) == _selectedBarangay).toList();

  double _distanceKm(double lat1, double lon1, double lat2, double lon2) {
    const radius = 6371.0;
    final dLat = (lat2 - lat1) * math.pi / 180;
    final dLon = (lon2 - lon1) * math.pi / 180;
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180) * math.cos(lat2 * math.pi / 180) * math.sin(dLon / 2) * math.sin(dLon / 2);
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  List<Map<String, dynamic>> _withDistances(List<Map<String, dynamic>> source) {
    final rows = source.map((row) {
      final distance = _currentLocation == null ? null : _distanceKm(_currentLocation!.latitude, _currentLocation!.longitude, _lat(row), _lng(row));
      return {
        ...row,
        'distance_km': distance,
        'estimated_travel_minutes': distance == null ? null : math.max(1, (distance * 1.3 / 25 * 60).round()),
      };
    }).toList();
    rows.sort((a, b) {
      final aDistance = a['distance_km'] as num?;
      final bDistance = b['distance_km'] as num?;
      if (aDistance != null && bDistance != null) return aDistance.compareTo(bDistance);
      return (a['name']?.toString() ?? '').compareTo(b['name']?.toString() ?? '');
    });
    return rows;
  }

  Future<LatLng?> _readLocation({required bool requestPermission}) async {
    try {
      var enabled = await _location.serviceEnabled();
      if (!enabled && requestPermission) enabled = await _location.requestService();
      if (!enabled) return null;
      var permission = await _location.hasPermission();
      if (permission == PermissionStatus.denied && requestPermission) permission = await _location.requestPermission();
      if (permission != PermissionStatus.granted) return null;
      final location = await _location.getLocation().timeout(const Duration(seconds: 12));
      if (location.latitude == null || location.longitude == null) return null;
      final point = LatLng(location.latitude!, location.longitude!);
      return MunicipalityBoundaryService.instance.contains(point) ? point : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _refreshLocation({required bool requestPermission}) async {
    final point = await _readLocation(requestPermission: requestPermission);
    if (!mounted || point == null) return;
    setState(() {
      _currentLocation = point;
      _centers = _withDistances(_centers);
    });
  }

  void _moveToCenter() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final target = _currentLocation ?? (_visible.isNotEmpty ? LatLng(_lat(_visible.first), _lng(_visible.first)) : _townCenter);
      _mapController.move(target, 11.7);
    });
  }

  void _selectCenter(Map<String, dynamic> center) {
    setState(() => _selectedId = center['id']?.toString());
    _mapController.move(LatLng(_lat(center), _lng(center)), 14);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _StationSheet(center: center, barangay: _barangayName(center)),
    );
  }

  Future<void> _findNearest() async {
    if (_centers.isEmpty) return;
    if (_currentLocation == null) await _refreshLocation(requestPermission: true);
    if (!mounted) return;
    if (_currentLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Turn on GPS and allow location access to find the nearest station.')));
      return;
    }
    if (_visible.isNotEmpty) _selectCenter(_visible.first);
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    final initialCenter = _currentLocation ?? (visible.isNotEmpty ? LatLng(_lat(visible.first), _lng(visible.first)) : _townCenter);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        foregroundColor: Colors.white,
        title: const Text('Evac Station', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          if (_offline) const Padding(padding: EdgeInsets.only(right: 4), child: Icon(Icons.cloud_off_rounded, size: 19)),
          IconButton(onPressed: _loading ? null : _load, tooltip: 'Refresh', icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: Stack(children: [
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(initialCenter: initialCenter, initialZoom: 11.7),
          children: [
            TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.norzagapay.mobile'),
            MunicipalityBoundaryMarkerLayer(markers: [
              ...visible.map((center) => Marker(
                point: LatLng(_lat(center), _lng(center)),
                width: 42,
                height: 46,
                alignment: Alignment.bottomCenter,
                child: GestureDetector(
                  onTap: () => _selectCenter(center),
                  child: Icon(Icons.location_pin, size: 42, color: center['id']?.toString() == _selectedId ? const Color(0xFFEA580C) : const Color(0xFF0D9488)),
                ),
              )),
              if (_currentLocation != null)
                Marker(
                  point: _currentLocation!,
                  width: 26,
                  height: 26,
                  child: Container(decoration: BoxDecoration(color: const Color(0xFF2563EB), shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 4), boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 7)])),
                ),
            ]),
            const MunicipalityBoundaryMapLayer(outsideColor: Colors.white),
          ],
        ),
        Positioned(
          top: 14,
          left: 14,
          right: 14,
          child: Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: .96), borderRadius: BorderRadius.circular(13), boxShadow: const [BoxShadow(color: Color(0x180F172A), blurRadius: 12)]),
              child: Text('${_centers.length} active station${_centers.length == 1 ? '' : 's'}', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
            ),
            const Spacer(),
            if (_barangays.isNotEmpty)
              Container(
                constraints: const BoxConstraints(maxWidth: 190),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: .96), borderRadius: BorderRadius.circular(13), boxShadow: const [BoxShadow(color: Color(0x180F172A), blurRadius: 12)]),
                child: DropdownButtonHideUnderline(child: DropdownButton<String?>(
                  value: _selectedBarangay,
                  isExpanded: true,
                  hint: const Text('All barangays'),
                  items: [const DropdownMenuItem<String?>(value: null, child: Text('All barangays')), ..._barangays.map((name) => DropdownMenuItem<String?>(value: name, child: Text(name, overflow: TextOverflow.ellipsis)))],
                  onChanged: (value) { setState(() { _selectedBarangay = value; _selectedId = null; }); _moveToCenter(); },
                )),
              ),
          ]),
        ),
        Positioned(
          right: 14,
          bottom: 22,
          child: FloatingActionButton.extended(
            heroTag: 'mdrrmo_nearest_station',
            onPressed: _findNearest,
            backgroundColor: Colors.white,
            foregroundColor: const Color(0xFF0369A1),
            icon: const Icon(Icons.near_me_rounded),
            label: const Text('Nearest station'),
          ),
        ),
        if (_loading && _centers.isEmpty) const Center(child: CircularProgressIndicator(color: Color(0xFF0D9488))),
        if (!_loading && _centers.isEmpty)
          Center(child: Container(
            margin: const EdgeInsets.all(24),
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: .96), borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFE2E8F0))),
            child: const Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.location_off_rounded, size: 42, color: Color(0xFF0284C7)),
              SizedBox(height: 10),
              Text('No active evacuation stations', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
              SizedBox(height: 5),
              Text('Active municipality-wide stations will appear here.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF64748B))),
            ]),
          )),
      ]),
    );
  }
}

class _StationSheet extends StatelessWidget {
  final Map<String, dynamic> center;
  final String? barangay;
  const _StationSheet({required this.center, required this.barangay});

  @override
  Widget build(BuildContext context) {
    final distance = (center['distance_km'] as num?)?.toDouble();
    final minutes = (center['estimated_travel_minutes'] as num?)?.round();
    return SafeArea(child: Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: Container(width: 38, height: 4, decoration: BoxDecoration(color: const Color(0xFFCBD5E1), borderRadius: BorderRadius.circular(8)))),
        const SizedBox(height: 18),
        Text(center['name']?.toString() ?? 'Evacuation Station', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
        if (barangay != null) Padding(padding: const EdgeInsets.only(top: 5), child: Text(barangay!, style: const TextStyle(color: Color(0xFF64748B)))),
        if ((center['address']?.toString() ?? '').isNotEmpty) Padding(padding: const EdgeInsets.only(top: 5), child: Text(center['address'].toString(), style: const TextStyle(color: Color(0xFF64748B)))),
        const SizedBox(height: 16),
        Wrap(spacing: 9, runSpacing: 9, children: [
          _Metric(icon: Icons.straighten_rounded, label: distance == null ? 'Turn on GPS to calculate distance' : '${distance.toStringAsFixed(1)} km away'),
          _Metric(icon: Icons.schedule_rounded, label: minutes == null ? 'Travel time unavailable' : 'About $minutes min by road'),
        ]),
        const SizedBox(height: 12),
        const Text('Distance is straight-line; travel time is estimated and can vary with road conditions.', style: TextStyle(color: Color(0xFF64748B), fontSize: 12)),
      ]),
    ));
  }
}

class _Metric extends StatelessWidget {
  final IconData icon;
  final String label;
  const _Metric({required this.icon, required this.label});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(20)),
    child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 16, color: const Color(0xFF0369A1)), const SizedBox(width: 6), Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF334155)))]),
  );
}
