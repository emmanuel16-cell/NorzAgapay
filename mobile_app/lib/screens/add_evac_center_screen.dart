import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:location/location.dart';
import 'package:provider/provider.dart';
import '../models/evacuation_center.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../services/municipality_boundary_service.dart';
import '../widgets/municipality_boundary_map_layer.dart';

class AddEvacCenterScreen extends StatefulWidget {
  final EvacuationCenter? center;

  const AddEvacCenterScreen({super.key, this.center});

  @override
  State<AddEvacCenterScreen> createState() => _AddEvacCenterScreenState();
}

class _AddEvacCenterScreenState extends State<AddEvacCenterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _addressController = TextEditingController();

  final MapController _mapController = MapController();
  LatLng _pinnedLocation = const LatLng(
    14.9133,
    121.0436,
  ); // Default Norzagaray
  bool _isSaving = false;
  final Location _location = Location();

  @override
  void initState() {
    super.initState();
    final center = widget.center;
    if (center == null) {
      _fetchUserLocation();
    } else {
      _nameController.text = center.name;
      _addressController.text = center.address ?? '';
      _pinnedLocation = LatLng(center.latitude, center.longitude);
    }
  }

  Future<void> _fetchUserLocation() async {
    try {
      final loc = await _location.getLocation();
      if (loc.latitude != null && loc.longitude != null && mounted) {
        setState(() {
          _pinnedLocation = LatLng(loc.latitude!, loc.longitude!);
          _mapController.move(_pinnedLocation, 16.0);
        });
      }
    } catch (_) {}
  }

  Future<void> _handleSave() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);
    final auth = Provider.of<AuthService>(context, listen: false);

    try {
      final center = widget.center;
      if (center == null) {
        await ApiService.createEvacuationCenter(
          auth.token!,
          name: _nameController.text.trim(),
          address: _addressController.text.trim(),
          latitude: _pinnedLocation.latitude,
          longitude: _pinnedLocation.longitude,
        );
      } else {
        await ApiService.updateEvacuationCenter(
          auth.token!,
          center.id,
          name: _nameController.text.trim(),
          address: _addressController.text.trim(),
          latitude: _pinnedLocation.latitude,
          longitude: _pinnedLocation.longitude,
        );
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              center == null
                  ? 'Evacuation station added successfully.'
                  : 'Evacuation station updated successfully.',
            ),
            backgroundColor: const Color(0xFF10B981),
          ),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        foregroundColor: Colors.white,
        title: Text(
          widget.center == null
              ? 'Add Evacuation Center'
              : 'Edit Evacuation Center',
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Center Name
              TextFormField(
                controller: _nameController,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration(
                  'Evacuation Center Name *',
                  Icons.night_shelter,
                ),
                validator: (v) =>
                    v == null || v.isEmpty ? 'Center name is required' : null,
              ),
              const SizedBox(height: 14),

              // Address
              TextFormField(
                controller: _addressController,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration(
                  'Street Address / Landmark (Optional)',
                  Icons.location_on,
                ),
              ),
              const SizedBox(height: 20),

              // Interactive Map Pinning
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Pin Location on Map *',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                    ),
                  ),
                  Text(
                    'Tap on map to set pin',
                    style: TextStyle(color: Colors.cyan.shade300, fontSize: 12),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  height: 260,
                  child: FlutterMap(
                    mapController: _mapController,
                    options: MapOptions(
                      initialCenter: _pinnedLocation,
                      initialZoom: 15.0,
                      onTap: (_, point) {
                        if (!MunicipalityBoundaryService.instance.contains(
                          point,
                        )) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Choose a location inside the active municipality boundary.',
                              ),
                            ),
                          );
                          return;
                        }
                        setState(() {
                          _pinnedLocation = point;
                        });
                      },
                    ),
                    children: [
                      TileLayer(
                        urlTemplate:
                            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        userAgentPackageName: 'ph.gov.mdrrmo.norzagapay_mobile',
                      ),
                      MunicipalityBoundaryMarkerLayer(
                        markers: [
                          Marker(
                            point: _pinnedLocation,
                            width: 50,
                            height: 50,
                            child: const Column(
                              children: [
                                Icon(
                                  Icons.location_pin,
                                  color: Colors.redAccent,
                                  size: 44,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const MunicipalityBoundaryMapLayer(
                        outsideColor: Color(0xFFF5F6FA),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(
                    Icons.pin_drop,
                    size: 14,
                    color: Color(0xFF38BDF8),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Pinned Coordinates: ${_pinnedLocation.latitude.toStringAsFixed(6)}, ${_pinnedLocation.longitude.toStringAsFixed(6)}',
                    style: const TextStyle(
                      color: Color(0xFF94A3B8),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 28),

              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton.icon(
                  onPressed: _isSaving ? null : _handleSave,
                  icon: const Icon(Icons.save),
                  label: _isSaving
                      ? const CircularProgressIndicator(color: Colors.white)
                      : Text(
                          widget.center == null
                              ? 'Save Evacuation Center'
                              : 'Save Changes',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0284C7),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
      prefixIcon: Icon(icon, color: const Color(0xFF38BDF8), size: 20),
      filled: true,
      fillColor: const Color(0xFF1E293B),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFF334155)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFF334155)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFF38BDF8), width: 1.5),
      ),
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    super.dispose();
  }
}
