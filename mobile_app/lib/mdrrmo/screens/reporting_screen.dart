import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:location/location.dart';
import 'dart:io';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../core/constants.dart';
import '../services/offline_service.dart';
import 'my_reports_screen.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class ReportingScreen extends StatefulWidget {
  const ReportingScreen({super.key});

  @override
  State<ReportingScreen> createState() => _ReportingScreenState();
}

class _ReportingScreenState extends State<ReportingScreen> {
  String _reportType = 'emergency';
  String? _selectedCategory;
  String? _selectedSpecific;
  File? _proofFile;
  String? _proofType;
  bool _isUploading = false;
  final TextEditingController _descController = TextEditingController();
  
  LocationData? _currentLocation;
  final Location _location = Location();

  final Map<String, List<String>> _emergencyCategories = {
    'Natural Disasters': [
      'Flood Incident',
      'Flash Flood',
      'Typhoon Incident',
      'Severe Rainfall Incident',
      'Landslide',
      'Mudslide',
      'Earthquake Incident',
      'Extreme Heat Incident',
      'Strong Wind Incident'
    ],
    'Fire Incidents': [
      'Residential Fire',
      'Grass Fire',
      'Forest / Mountain Fire',
      'Electrical Fire',
      'Vehicular Fire',
      'Gas Leak Incident'
    ],
    'Rescue & Medical Emergencies': [
      'Medical Emergency',
      'Vehicular Accident',
      'Motorcycle Accident',
      'Missing Person',
      'Mountain Rescue Incident',
      'Drowning Incident',
      'River Rescue Incident',
      'Entrapment Incident'
    ],
    'Public Safety Incidents': [
      'Building Collapse',
      'Fallen Tree Incident',
      'Downed Electrical Lines',
      'Road Obstruction',
      'Bridge Damage Incident',
      'Evacuation Incident'
    ],
  };

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
      'River Water Level Report'
    ],
    'Environmental Concerns': [
      'Illegal Dumping',
      'River Pollution Report',
      'Smoke Pollution',
      'Animal Carcass Disposal',
      'Flood-Prone Area Report'
    ],
    'Weather & Monitoring Reports': [
      'Heavy Rain Monitoring',
      'Strong Wind Monitoring',
      'Rising Water Level Monitoring',
      'Landslide-Prone Area Report',
      'Earthquake Damage Observation'
    ],
  };

  @override
  void initState() {
    super.initState();
    _getLocation();
  }

  Future<void> _getLocation() async {
    try {
      final loc = await _location.getLocation();
      setState(() => _currentLocation = loc);
    } catch (e) {
      debugPrint('Error getting location: $e');
    }
  }

  Future<void> _pickFile(ImageSource source, {bool isVideo = false}) async {
    final picker = ImagePicker();
    XFile? file;
    
    if (isVideo) {
      file = await picker.pickVideo(source: source);
    } else {
      file = await picker.pickImage(source: source);
    }

    if (file != null) {
      setState(() {
        _proofFile = File(file!.path);
        _proofType = isVideo ? 'video' : 'image';
      });
    }
  }

  void _showCameraOptions() {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt),
              title: const Text('Take Photo'),
              onTap: () {
                Navigator.pop(context);
                _pickFile(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.videocam),
              title: const Text('Record Video'),
              onTap: () {
                Navigator.pop(context);
                _pickFile(ImageSource.camera, isVideo: true);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submitReport() async {
    if (_selectedCategory == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a Category'))
      );
      return;
    }

    if (_proofFile == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Proof of Incident is mandatory'))
      );
      return;
    }

    if (_currentLocation == null) {
      await _getLocation();
      if (_currentLocation == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Location required. Please enable GPS.'))
        );
        return;
      }
    }

    setState(() => _isUploading = true);

    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      
      var request = http.MultipartRequest(
        'POST',
        Uri.parse('${AppConstants.apiBaseUrl}/incident-reports'),
      );

      // Add Headers
      request.headers.addAll({
        'Authorization': 'Bearer ${auth.token}',
        'ngrok-skip-browser-warning': 'true',
      });

      // Add Fields
      final Map<String, String> fields = {
        'type': _reportType,
        'title': _selectedCategory!,
        'specifics': _selectedSpecific ?? '',
        'description': _descController.text,
        'latitude': _currentLocation!.latitude.toString(),
        'longitude': _currentLocation!.longitude.toString(),
        'proof_type': _proofType ?? 'image',
      };
      request.fields.addAll(fields);

      // Add File
      if (_proofFile != null) {
        request.files.add(await http.MultipartFile.fromPath(
          'proof',
          _proofFile!.path,
        ));
      }

      final streamedResponse = await request.send().timeout(const Duration(seconds: 15));
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 201 || response.statusCode == 200) {
        if (mounted) {
          // Show success dialog
          showDialog(
            context: context,
            barrierDismissible: false,
            builder: (context) => AlertDialog(
              title: const Text('Success!'),
              content: const Text('Your report has been submitted successfully.'),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(context); // Close dialog
                    // Navigate to MyReportsScreen
                    Navigator.pushReplacement(
                      context,
                      MaterialPageRoute(builder: (_) => const MyReportsScreen()),
                    );
                  },
                  child: const Text('View My Reports'),
                ),
              ],
            ),
          );
        }
      } else {
        final errorData = jsonDecode(response.body);
        throw Exception(errorData['message'] ?? 'Failed to submit report');
      }
    } catch (e) {
      debugPrint('Submission error: $e');
      
      // If it's a network error or timeout, save offline
      if (mounted) {
        final shouldSaveOffline = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Network Error'),
            content: const Text('Could not connect to the server. Would you like to save this report locally and sync it later?'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
              ElevatedButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save Locally')),
            ],
          ),
        );

        if (shouldSaveOffline == true) {
          await OfflineService.savePendingReport({
            'type': _reportType,
            'title': _selectedCategory,
            'specifics': _selectedSpecific,
            'description': _descController.text,
            'latitude': _currentLocation!.latitude,
            'longitude': _currentLocation!.longitude,
            'proof_type': _proofType,
            'proof_path': _proofFile?.path,
            'timestamp': DateTime.now().toIso8601String(),
          });
          
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Report saved locally!'), backgroundColor: Colors.orange)
            );
            Navigator.pop(context);
          }
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e'), backgroundColor: const Color(AppColors.accent))
          );
        }
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = _reportType == 'emergency' ? _emergencyCategories : _communityCategories;
    
    return Scaffold(
      appBar: AppBar(title: const Text('Submit Report')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Incident Type', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            Row(
              children: [
                Expanded(
                  child: RadioListTile<String>(
                    title: const Text('Emergency'),
                    value: 'emergency',
                    groupValue: _reportType,
                    onChanged: (v) => setState(() {
                      _reportType = v!;
                      _selectedCategory = null;
                      _selectedSpecific = null;
                    }),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                    dense: true,
                  ),
                ),
                Expanded(
                  child: RadioListTile<String>(
                    title: const Text('Community'),
                    value: 'community',
                    groupValue: _reportType,
                    onChanged: (v) => setState(() {
                      _reportType = v!;
                      _selectedCategory = null;
                      _selectedSpecific = null;
                    }),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                    dense: true,
                  ),
                ),
              ],
            ),
            
            const SizedBox(height: 20),
            DropdownButtonFormField<String>(
              initialValue: _selectedCategory,
              decoration: const InputDecoration(
                labelText: 'Category',
                border: OutlineInputBorder(),
              ),
              items: categories.keys.map((String category) {
                return DropdownMenuItem<String>(
                  value: category,
                  child: Text(category),
                );
              }).toList(),
              onChanged: (String? newValue) {
                setState(() {
                  _selectedCategory = newValue;
                  _selectedSpecific = null;
                });
              },
            ),
            
            if (_selectedCategory != null) ...[
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: _selectedSpecific,
                decoration: const InputDecoration(
                  labelText: 'Specifics (Optional)',
                  border: OutlineInputBorder(),
                ),
                items: categories[_selectedCategory]!.map((String specific) {
                  return DropdownMenuItem<String>(
                    value: specific,
                    child: Text(specific),
                  );
                }).toList(),
                onChanged: (String? newValue) {
                  setState(() {
                    _selectedSpecific = newValue;
                  });
                },
              ),
            ],
            
            const SizedBox(height: 16),
            TextField(
              controller: _descController,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Description (Optional)',
                hintText: 'Describe what is happening...',
                border: OutlineInputBorder(),
              ),
            ),

            const SizedBox(height: 24),
            const Text('Proof of Incident', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Row(
              children: [
                _buildProofOption(Icons.image, 'Gallery', () => _pickFile(ImageSource.gallery)),
                const SizedBox(width: 8),
                _buildProofOption(Icons.camera_alt, 'Camera', _showCameraOptions),
              ],
            ),

            if (_proofFile != null) ...[
              const SizedBox(height: 16),
              Stack(
                children: [
                  Container(
                    height: 150,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(8),
                      color: Colors.black12,
                    ),
                    child: _proofType == 'video' 
                      ? const Center(child: Icon(Icons.play_circle_fill, size: 48))
                      : Image.file(_proofFile!, fit: BoxFit.cover),
                  ),
                  Positioned(
                    right: 8,
                    top: 8,
                    child: IconButton(
                      icon: const Icon(Icons.cancel, color: Colors.white),
                      onPressed: () => setState(() { _proofFile = null; _proofType = null; }),
                    ),
                  ),
                ],
              ),
            ],

            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  const Icon(Icons.location_on, color: Colors.blue),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Your Location', style: TextStyle(fontWeight: FontWeight.bold)),
                        Text(
                          _currentLocation != null 
                            ? '${_currentLocation!.latitude!.toStringAsFixed(6)}, ${_currentLocation!.longitude!.toStringAsFixed(6)}'
                            : 'Fetching location...',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _isUploading ? null : _submitReport,
                style: ElevatedButton.styleFrom(
                  backgroundColor: _reportType == 'emergency' ? const Color(AppColors.accent) : const Color(AppColors.primary),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: _isUploading 
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Text('Submit Report', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProofOption(IconData icon, String label, VoidCallback onTap) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            border: Border.all(color: Colors.grey.shade300),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            children: [
              Icon(icon, size: 24),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
}
