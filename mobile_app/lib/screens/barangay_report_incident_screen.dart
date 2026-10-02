import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:location/location.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../core/phone_number_utils.dart';

class BarangayReportIncidentScreen extends StatefulWidget {
  const BarangayReportIncidentScreen({super.key});

  @override
  State<BarangayReportIncidentScreen> createState() => _BarangayReportIncidentScreenState();
}

class _BarangayReportIncidentScreenState extends State<BarangayReportIncidentScreen> {
  String _reportType = 'emergency'; // 'emergency' or 'community'
  String? _selectedCategory;
  String? _selectedSpecific;
  final _descController = TextEditingController();

  File? _proofFile;
  String? _proofType; // 'image' or 'video'
  bool _isUploading = false;

  LocationData? _currentLocation;
  final Location _location = Location();
  bool _gettingLocation = false;

  final Map<String, List<String>> _communityCategories = {
    'Community Safety Concerns': [
      'Minor Flooding',
      'Drainage Blockage',
      'Small Fire Incident',
      'Fallen Tree Report',
      'Road Damage Report',
      'Damaged House Report',
      'Cracked Road Report',
      'Unsafe Electrical Wiring',
      'River Water Level Report',
    ],
    'Environmental Concerns': [
      'Illegal Dumping',
      'River Pollution Report',
      'Smoke Pollution',
      'Animal Carcass Disposal',
      'Flood-Prone Area Report',
    ],
    'Weather & Monitoring Reports': [
      'Heavy Rain Monitoring',
      'Strong Wind Monitoring',
      'Rising Water Level Monitoring',
      'Landslide-Prone Area Report',
      'Earthquake Damage Observation',
    ],
  };

  @override
  void initState() {
    super.initState();
    _getLocation();
  }

  @override
  void dispose() {
    _descController.dispose();
    super.dispose();
  }

  Future<void> _getLocation() async {
    setState(() => _gettingLocation = true);
    try {
      var serviceEnabled = await _location.serviceEnabled();
      if (!serviceEnabled) serviceEnabled = await _location.requestService();
      if (serviceEnabled) {
        var permission = await _location.hasPermission();
        if (permission == PermissionStatus.denied) {
          permission = await _location.requestPermission();
        }
        if (permission == PermissionStatus.granted || permission == PermissionStatus.grantedLimited) {
          final loc = await _location.getLocation();
          if (mounted) setState(() => _currentLocation = loc);
        }
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _gettingLocation = false);
    }
  }

  Future<void> _pickMedia(ImageSource source, {bool isVideo = false}) async {
    final picker = ImagePicker();
    XFile? file;
    try {
      if (isVideo) {
        file = await picker.pickVideo(source: source);
      } else {
        file = await picker.pickImage(source: source, imageQuality: 85);
      }
      if (file != null && mounted) {
        setState(() {
          _proofFile = File(file!.path);
          _proofType = isVideo ? 'video' : 'image';
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error picking media: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _showMediaOptions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E293B),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Take or Upload Visual Proof',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 12),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF0284C7),
                  child: Icon(Icons.camera_alt, color: Colors.white, size: 20),
                ),
                title: const Text('Take Photo (Camera)', style: TextStyle(color: Colors.white)),
                subtitle: const Text('Capture live incident picture', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickMedia(ImageSource.camera);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFEF4444),
                  child: Icon(Icons.videocam, color: Colors.white, size: 20),
                ),
                title: const Text('Record Video (Camera)', style: TextStyle(color: Colors.white)),
                subtitle: const Text('Record live incident video footage', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickMedia(ImageSource.camera, isVideo: true);
                },
              ),
              const Divider(color: Color(0xFF334155), height: 20),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF10B981),
                  child: Icon(Icons.photo_library, color: Colors.white, size: 20),
                ),
                title: const Text('Upload Photo from Gallery', style: TextStyle(color: Colors.white)),
                subtitle: const Text('Select existing photo from storage', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickMedia(ImageSource.gallery);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF8B5CF6),
                  child: Icon(Icons.video_library, color: Colors.white, size: 20),
                ),
                title: const Text('Upload Video from Gallery', style: TextStyle(color: Colors.white)),
                subtitle: const Text('Select existing video file from storage', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickMedia(ImageSource.gallery, isVideo: true);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submitReport() async {
    if (_reportType == 'community' && _selectedCategory == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select an incident category'), backgroundColor: Colors.amber),
      );
      return;
    }

    if (_currentLocation == null) {
      await _getLocation();
      if (_currentLocation == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('GPS coordinates required. Please enable location.'), backgroundColor: Colors.red),
        );
        return;
      }
    }

    final auth = Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;
    if (user == null || auth.token == null) return;

    setState(() => _isUploading = true);

    try {
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('${ApiService.baseUrl}/incident-reports'),
      );

      request.headers.addAll({
        'Authorization': 'Bearer ${auth.token}',
        'ngrok-skip-browser-warning': 'true',
      });

      request.fields['type'] = _reportType;
      request.fields['title'] = _reportType == 'emergency'
          ? 'Field Emergency Report'
          : (_selectedCategory ?? 'Barangay Field Report');
      request.fields['specifics'] = _selectedSpecific ?? '';
      request.fields['description'] = _descController.text.trim();
      request.fields['latitude'] = _currentLocation!.latitude.toString();
      request.fields['longitude'] = _currentLocation!.longitude.toString();
      request.fields['proof_type'] = _proofType ?? 'image';
      request.fields['reporter_type'] = 'responder';
      request.fields['first_name'] = user.fullName;
      request.fields['last_name'] = '(Responder)';
      request.fields['contact_number'] = PhoneNumberUtils.digitsOnly(user.phone);
      request.fields['barangay_id'] = user.barangayId;

      if (_proofFile != null) {
        request.files.add(await http.MultipartFile.fromPath('proof', _proofFile!.path));
      }

      final streamedRes = await request.send().timeout(const Duration(seconds: 30));
      final res = await http.Response.fromStream(streamedRes);

      if (streamedRes.statusCode == 200 || streamedRes.statusCode == 201) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Incident report submitted successfully!'),
              backgroundColor: Color(0xFF10B981),
            ),
          );
          Navigator.pop(context, true);
        }
      } else {
        final data = jsonDecode(res.body);
        throw Exception(data['error'] ?? 'Submission failed (${streamedRes.statusCode})');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEmergency = _reportType == 'emergency';
    final primaryColor = isEmergency ? const Color(0xFFEF4444) : const Color(0xFF0284C7);

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        foregroundColor: Colors.white,
        title: const Text('Field Incident Report', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Report Type Selector
            Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() {
                      _reportType = 'emergency';
                      _selectedCategory = null;
                      _selectedSpecific = null;
                    }),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: isEmergency ? const Color(0xFFEF4444).withOpacity(0.2) : const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isEmergency ? const Color(0xFFEF4444) : const Color(0xFF334155),
                          width: isEmergency ? 2 : 1,
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.warning_amber_rounded, color: isEmergency ? const Color(0xFFEF4444) : Colors.grey, size: 20),
                          const SizedBox(width: 8),
                          Text(
                            'EMERGENCY',
                            style: TextStyle(
                              color: isEmergency ? Colors.white : Colors.grey,
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => _reportType = 'community'),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: !isEmergency ? const Color(0xFF0284C7).withOpacity(0.2) : const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: !isEmergency ? const Color(0xFF0284C7) : const Color(0xFF334155),
                          width: !isEmergency ? 2 : 1,
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.assignment_outlined, color: !isEmergency ? const Color(0xFF0284C7) : Colors.grey, size: 20),
                          const SizedBox(width: 8),
                          Text(
                            'COMMUNITY',
                            style: TextStyle(
                              color: !isEmergency ? Colors.white : Colors.grey,
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Category Selection (for community reports)
            if (!isEmergency) ...[
              const Text('Incident Category', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: _selectedCategory,
                    isExpanded: true,
                    dropdownColor: const Color(0xFF1E293B),
                    hint: const Text('Select Incident Category', style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                    items: _communityCategories.keys.map((cat) {
                      return DropdownMenuItem<String>(
                        value: cat,
                        child: Text(cat, style: const TextStyle(color: Colors.white, fontSize: 13)),
                      );
                    }).toList(),
                    onChanged: (val) {
                      setState(() {
                        _selectedCategory = val;
                        _selectedSpecific = null;
                      });
                    },
                  ),
                ),
              ),
              const SizedBox(height: 14),
              if (_selectedCategory != null) ...[
                const Text('Specific Incident', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: _selectedSpecific,
                      isExpanded: true,
                      dropdownColor: const Color(0xFF1E293B),
                      hint: const Text('Select Specific Type', style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                      items: _communityCategories[_selectedCategory]!.map((item) {
                        return DropdownMenuItem<String>(
                          value: item,
                          child: Text(item, style: const TextStyle(color: Colors.white, fontSize: 13)),
                        );
                      }).toList(),
                      onChanged: (val) => setState(() => _selectedSpecific = val),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
              ],
            ],

            // Visual Proof (Take or Upload Photo / Video)
            const Text(
              'Visual Proof (Photo / Video)',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 6),
            const Text(
              'Team leaders can capture live photos/videos with camera or upload existing files from gallery.',
              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
            ),
            const SizedBox(height: 10),

            if (_proofFile != null) ...[
              Stack(
                children: [
                  Container(
                    height: 200,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E293B),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFF334155)),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: _proofType == 'video'
                        ? Container(
                            color: Colors.black87,
                            child: Center(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.videocam, color: Color(0xFF38BDF8), size: 48),
                                  const SizedBox(height: 8),
                                  Text(
                                    'Video Selected: ${_proofFile!.path.split(Platform.pathSeparator).last}',
                                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                                    textAlign: TextAlign.center,
                                  ),
                                ],
                              ),
                            ),
                          )
                        : Image.file(_proofFile!, fit: BoxFit.cover),
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: GestureDetector(
                      onTap: () => setState(() {
                        _proofFile = null;
                        _proofType = null;
                      }),
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: const BoxDecoration(
                          color: Colors.black87,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.close, color: Colors.white, size: 18),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
            ],

            // Media action card
            InkWell(
              onTap: _showMediaOptions,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF334155), style: BorderStyle.solid),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFF0284C7).withOpacity(0.2),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Icon(Icons.camera_alt, color: Color(0xFF38BDF8), size: 24),
                        ),
                        const SizedBox(width: 12),
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFF10B981).withOpacity(0.2),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Icon(Icons.photo_library, color: Color(0xFF10B981), size: 24),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _proofFile == null ? 'Tap to Capture or Upload Photo / Video' : 'Tap to Change Visual Proof',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Camera (Photo/Video) • Gallery/Files Upload',
                      style: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Description Box
            const Text('Incident Description', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 8),
            TextField(
              controller: _descController,
              maxLines: 4,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Describe what happened, current situation, hazards, or immediate needs...',
                hintStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                filled: true,
                fillColor: const Color(0xFF1E293B),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFF334155))),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFF334155))),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: primaryColor)),
              ),
            ),
            const SizedBox(height: 20),

            // Location Box
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF1E293B),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.location_on, color: Color(0xFF38BDF8), size: 24),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Incident Location (GPS)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                        const SizedBox(height: 2),
                        Text(
                          _currentLocation != null
                              ? '${_currentLocation!.latitude!.toStringAsFixed(5)}, ${_currentLocation!.longitude!.toStringAsFixed(5)}'
                              : (_gettingLocation ? 'Acquiring GPS location...' : 'Location not available'),
                          style: TextStyle(color: _currentLocation != null ? const Color(0xFF10B981) : const Color(0xFF94A3B8), fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: _gettingLocation
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF38BDF8)))
                        : const Icon(Icons.refresh, color: Color(0xFF38BDF8), size: 20),
                    onPressed: _gettingLocation ? null : _getLocation,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),

            // Submit Button
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton.icon(
                onPressed: _isUploading ? null : _submitReport,
                icon: _isUploading
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.send_rounded),
                label: Text(
                  _isUploading ? 'Submitting Report...' : 'SUBMIT INCIDENT REPORT',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, letterSpacing: 0.5),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: primaryColor,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  elevation: 2,
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}
