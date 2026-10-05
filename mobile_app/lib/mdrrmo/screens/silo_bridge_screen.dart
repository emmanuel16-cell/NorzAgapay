import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../core/constants.dart';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../../widgets/municipality_boundary_map_layer.dart';

class SiloBridgeScreen extends StatefulWidget {
  const SiloBridgeScreen({super.key});

  @override
  State<SiloBridgeScreen> createState() => _SiloBridgeScreenState();
}

class _SiloBridgeScreenState extends State<SiloBridgeScreen> {
  final MapController _mapController = MapController();
  List<Map<String, dynamic>> _units = [];
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _fetchUnits();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 10),
      (timer) => _fetchUnits(),
    );
  }

  @override
  void dispose() {
    _mapController.dispose();
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchUnits() async {
    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/users?role=responder'),
        headers: {
          'Authorization': 'Bearer ${auth.token}',
          'ngrok-skip-browser-warning': 'true',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          _units = List<Map<String, dynamic>>.from(data['users']);
        });
      }
    } catch (e) {
      print('SiloBridge Error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return FlutterMap(
      key: const ValueKey('norzagaray_map'),
      mapController: _mapController,
      options: MapOptions(
        initialCenter: LatLng(AppConstants.defaultLat, AppConstants.defaultLng),
        initialZoom: 15.0,
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.norzagapay.app.silo_bridge',
        ),
        MunicipalityBoundaryMarkerLayer(
          markers: [
            for (final u in _units)
              if (u['latitude'] != null && u['longitude'] != null)
                Marker(
                  point: LatLng(
                    (u['latitude'] as num).toDouble(),
                    (u['longitude'] as num).toDouble(),
                  ),
                  width: 60,
                  height: 60,
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black87,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          (u['full_name'] as String? ?? '').split(' ').first,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Icon(
                        u['unit_type'] == 'police'
                            ? Icons.local_police
                            : u['unit_type'] == 'fire'
                            ? Icons.local_fire_department
                            : Icons.medical_services,
                        color: u['unit_type'] == 'police'
                            ? Colors.blue
                            : u['unit_type'] == 'fire'
                            ? Colors.red
                            : Colors.green,
                        size: 30,
                      ),
                    ],
                  ),
                ),
          ],
        ),
        const MunicipalityBoundaryMapLayer(outsideColor: Colors.white),
      ],
    );
  }
}
