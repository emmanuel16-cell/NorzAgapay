import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:location/location.dart';
import 'package:provider/provider.dart';

import '../models/evacuation_center.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import 'add_evac_center_screen.dart';
import '../widgets/municipality_boundary_map_layer.dart';

class EvacCentersScreen extends StatefulWidget {
  const EvacCentersScreen({super.key});

  @override
  State<EvacCentersScreen> createState() => _EvacCentersScreenState();
}

class _EvacCentersScreenState extends State<EvacCentersScreen> {
  final _location = Location();
  final _mapController = MapController();
  List<EvacuationCenter> _centers = [];
  LatLng? _userLocation;
  String? _selectedCenterId;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadStations();
  }

  Future<void> _loadStations() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final auth = context.read<AuthService>();
      final user = auth.currentUser;
      if (auth.token == null || user == null) {
        throw Exception('Please sign in again.');
      }
      final centers = await ApiService.getEvacuationCenters(auth.token!);
      final location = await _getCurrentLocation();
      if (!mounted) return;
      setState(() {
        _centers = centers.where(_hasCoordinates).toList();
        if (_selectedCenterId != null &&
            !_centers.any((center) => center.id == _selectedCenterId)) {
          _selectedCenterId = null;
        }
        _userLocation = location;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  bool _hasCoordinates(EvacuationCenter center) =>
      center.latitude != 0 && center.longitude != 0;

  Future<LatLng?> _getCurrentLocation() async {
    try {
      var serviceEnabled = await _location.serviceEnabled();
      if (!serviceEnabled) serviceEnabled = await _location.requestService();
      if (!serviceEnabled) return null;

      var permission = await _location.hasPermission();
      if (permission == PermissionStatus.denied) {
        permission = await _location.requestPermission();
      }
      if (permission != PermissionStatus.granted) return null;

      final data = await _location.getLocation().timeout(
        const Duration(seconds: 8),
      );
      if (data.latitude == null || data.longitude == null) return null;
      return LatLng(data.latitude!, data.longitude!);
    } catch (_) {
      return null;
    }
  }

  double? _distanceKm(EvacuationCenter center) {
    final origin = _userLocation;
    if (origin == null) return null;
    const radius = 6371.0;
    final dLat = (center.latitude - origin.latitude) * math.pi / 180;
    final dLon = (center.longitude - origin.longitude) * math.pi / 180;
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(origin.latitude * math.pi / 180) *
            math.cos(center.latitude * math.pi / 180) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  Future<void> _openAddScreen() async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const AddEvacCenterScreen()),
    );
    if (saved == true) _loadStations();
  }

  Future<void> _openEditScreen(EvacuationCenter center) async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => AddEvacCenterScreen(center: center)),
    );
    if (saved == true) {
      await _loadStations();
      if (!mounted) return;
      for (final updatedCenter in _centers) {
        if (updatedCenter.id == center.id) {
          _showDetails(updatedCenter);
          break;
        }
      }
    }
  }

  Future<void> _confirmRemove(
    EvacuationCenter center,
    BuildContext sheetContext,
  ) async {
    final token = context.read<AuthService>().token;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove evacuation station?'),
        content: Text(
          '“${center.name}” will be removed from the evacuation station list.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      if (token == null) throw Exception('Please sign in again.');
      await ApiService.removeEvacuationCenter(token, center.id);
      if (!mounted) return;
      if (sheetContext.mounted) Navigator.of(sheetContext).pop();
      setState(() {
        _centers.removeWhere((item) => item.id == center.id);
        if (_selectedCenterId == center.id) _selectedCenterId = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Evacuation station removed.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  void _showDetails(EvacuationCenter center) {
    setState(() => _selectedCenterId = center.id);
    _mapController.move(LatLng(center.latitude, center.longitude), 15.5);
    final distance = _distanceKm(center);
    final minutes = distance == null
        ? null
        : (distance * 1.3 / 25 * 60).round().clamp(1, 9999).toInt();
    final user = context.read<AuthService>().currentUser;
    final canManage =
        user?.canAddEvacuationCenter == true &&
        user?.barangayId == center.barangayId;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => _StationDetailsSheet(
        name: center.name,
        address: center.address,
        barangay: center.barangayName,
        distanceKm: distance,
        travelMinutes: minutes,
        distanceOrigin: 'your current location',
        canManage: canManage,
        onEdit: () {
          Navigator.of(sheetContext).pop();
          _openEditScreen(center);
        },
        onRemove: () => _confirmRemove(center, sheetContext),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = context.select<AuthService, bool>(
      (auth) => auth.currentUser?.canAddEvacuationCenter ?? false,
    );
    final hasStations = _centers.isNotEmpty;
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        foregroundColor: Colors.white,
        title: Text(
          !hasStations && canAdd
              ? 'Add Evacuation Station'
              : 'Evacuation Stations',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        actions: [
          IconButton(
            onPressed: _loading ? null : _loadStations,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && !hasStations
          ? const Center(child: CircularProgressIndicator())
          : _error != null && !hasStations
          ? _ErrorState(message: _error!, onRetry: _loadStations)
          : !hasStations
          ? _EmptyState(canAdd: canAdd, onAdd: _openAddScreen)
          : _stationMap(canAdd),
    );
  }

  Widget _stationMap(bool canAdd) {
    final initialCenter =
        _userLocation ??
        LatLng(_centers.first.latitude, _centers.first.longitude);
    return Stack(
      fit: StackFit.expand,
      children: [
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(initialCenter: initialCenter, initialZoom: 12.5),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'ph.gov.mdrrmo.norzagapay_mobile',
            ),
            MunicipalityBoundaryMarkerLayer(
              markers: [
                ..._centers.map(
                  (center) => Marker(
                    point: LatLng(center.latitude, center.longitude),
                    width: 54,
                    height: 58,
                    alignment: Alignment.bottomCenter,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => _showDetails(center),
                      child: Transform.scale(
                        scale: center.id == _selectedCenterId ? 1.12 : 1,
                        child: Icon(
                          Icons.location_pin,
                          size: 48,
                          color: center.id == _selectedCenterId
                              ? const Color(0xFFF97316)
                              : center.isActive
                              ? const Color(0xFF0D9488)
                              : const Color(0xFF64748B),
                        ),
                      ),
                    ),
                  ),
                ),
                if (_userLocation != null)
                  Marker(
                    point: _userLocation!,
                    width: 28,
                    height: 28,
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFF2563EB),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 4),
                        boxShadow: const [
                          BoxShadow(color: Color(0x40000000), blurRadius: 6),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            const MunicipalityBoundaryMapLayer(outsideColor: Color(0xFFF5F6FA)),
          ],
        ),
        Positioned(
          top: 12,
          left: 16,
          right: 16,
          child: _StationSelector(
            centers: _centers,
            selectedId: _selectedCenterId,
            onChanged: (id) {
              if (id == null) return;
              final center = _centers.firstWhere((item) => item.id == id);
              _showDetails(center);
            },
          ),
        ),
        Positioned(
          top: 82,
          left: 16,
          child: _MapBadge(
            icon: Icons.location_on_rounded,
            text:
                '${_centers.length} station${_centers.length == 1 ? '' : 's'}',
          ),
        ),
        if (_userLocation == null)
          const Positioned(
            top: 128,
            left: 16,
            child: _MapBadge(
              icon: Icons.my_location_rounded,
              text: 'Location unavailable',
            ),
          ),
        if (canAdd)
          Positioned(
            right: 16,
            bottom: 20,
            child: FloatingActionButton.extended(
              heroTag: 'add-evacuation-station',
              onPressed: _openAddScreen,
              backgroundColor: const Color(0xFF0D9488),
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add_location_alt_rounded),
              label: const Text('Add Station'),
            ),
          ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool canAdd;
  final VoidCallback onAdd;
  const _EmptyState({required this.canAdd, required this.onAdd});

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(
                radius: 30,
                backgroundColor: const Color(0xFFE0F2FE),
                child: Icon(
                  canAdd
                      ? Icons.add_location_alt_rounded
                      : Icons.location_off_rounded,
                  color: const Color(0xFF0284C7),
                  size: 30,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                canAdd ? 'Register a station' : 'No registered station',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF0F172A),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                canAdd
                    ? 'Add its name, address, and map pin so residents can find the nearest evacuation station.'
                    : 'There are no evacuation stations registered for your barangay yet.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF64748B), height: 1.4),
              ),
              if (canAdd) ...[
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: onAdd,
                    icon: const Icon(Icons.add_location_alt_rounded),
                    label: const Text('Add station'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF0D9488),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.cloud_off_rounded,
            size: 48,
            color: Color(0xFF64748B),
          ),
          const SizedBox(height: 12),
          const Text(
            'Could not load evacuation stations',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFF64748B)),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Try again'),
          ),
        ],
      ),
    ),
  );
}

class _MapBadge extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MapBadge({required this.icon, required this.text});

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
          text,
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

class _StationSelector extends StatelessWidget {
  final List<EvacuationCenter> centers;
  final String? selectedId;
  final ValueChanged<String?> onChanged;

  const _StationSelector({
    required this.centers,
    required this.selectedId,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    elevation: 5,
    borderRadius: BorderRadius.circular(14),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: selectedId,
          isExpanded: true,
          hint: const Text('Select an evacuation station'),
          icon: const Icon(Icons.expand_more_rounded),
          items: centers
              .map(
                (center) => DropdownMenuItem<String>(
                  value: center.id,
                  child: Text(
                    center.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              )
              .toList(),
          onChanged: onChanged,
        ),
      ),
    ),
  );
}

class _StationDetailsSheet extends StatelessWidget {
  final String name;
  final String? address;
  final String? barangay;
  final double? distanceKm;
  final int? travelMinutes;
  final String distanceOrigin;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

  const _StationDetailsSheet({
    required this.name,
    required this.address,
    required this.barangay,
    required this.distanceKm,
    required this.travelMinutes,
    required this.distanceOrigin,
    required this.canManage,
    required this.onEdit,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) => SafeArea(
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
            name,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
            ),
          ),
          if (barangay != null && barangay!.isNotEmpty) ...[
            const SizedBox(height: 5),
            Text(barangay!, style: const TextStyle(color: Color(0xFF64748B))),
          ],
          if (address != null && address!.isNotEmpty) ...[
            const SizedBox(height: 5),
            Text(address!, style: const TextStyle(color: Color(0xFF64748B))),
          ],
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _DetailMetric(
                icon: Icons.straighten_rounded,
                label: distanceKm == null
                    ? 'Distance unavailable'
                    : '${distanceKm!.toStringAsFixed(1)} km from $distanceOrigin',
              ),
              _DetailMetric(
                icon: Icons.schedule_rounded,
                label: travelMinutes == null
                    ? 'Travel time unavailable'
                    : 'About $travelMinutes min by road',
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Distance is straight-line; travel time is an estimate using average road speed.',
            style: TextStyle(color: Color(0xFF64748B), fontSize: 12),
          ),
          if (canManage) ...[
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onEdit,
                    icon: const Icon(Icons.edit_location_alt_outlined),
                    label: const Text('Edit station'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onRemove,
                    icon: const Icon(Icons.delete_outline_rounded),
                    label: const Text('Remove'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red.shade700,
                      side: BorderSide(color: Colors.red.shade300),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    ),
  );
}

class _DetailMetric extends StatelessWidget {
  final IconData icon;
  final String label;
  const _DetailMetric({required this.icon, required this.label});

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
