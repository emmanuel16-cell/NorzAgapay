import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import '../widgets/resident_gradient_app_bar.dart';

class EmergencyProof {
  final File file;
  final String type;
  final int? durationSeconds;

  const EmergencyProof({
    required this.file,
    required this.type,
    this.durationSeconds,
  });
}

class EmergencyCameraScreen extends StatefulWidget {
  const EmergencyCameraScreen({super.key});

  @override
  State<EmergencyCameraScreen> createState() => _EmergencyCameraScreenState();
}

class _EmergencyCameraScreenState extends State<EmergencyCameraScreen> {
  final List<EmergencyProof> _capturedProofs = [];
  CameraController? _controller;
  List<CameraDescription> _cameras = [];
  int _selectedCameraIndex = 0;
  bool _isRecording = false;
  int _recordSeconds = 0;
  Timer? _recordTimer;
  String? _error;
  bool _isProcessing = false;

  void _finishCapture() {
    if (_capturedProofs.isNotEmpty) {
      Navigator.pop(context, List<EmergencyProof>.of(_capturedProofs));
    }
  }

  @override
  void initState() {
    super.initState();
    _initializeCamera();
  }

  Future<void> _initializeCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        throw CameraException('no_camera', 'No camera is available.');
      }
      await _initControllerWithIndex(_selectedCameraIndex);
    } on CameraException catch (error) {
      if (mounted) {
        setState(() => _error = error.description ?? 'Camera permission was not granted.');
      }
    }
  }

  Future<void> _initControllerWithIndex(int index) async {
    final prevController = _controller;
    final newController = CameraController(
      _cameras[index],
      ResolutionPreset.high,
      enableAudio: true,
    );

    await prevController?.dispose();
    await newController.initialize();

    if (mounted) {
      setState(() {
        _controller = newController;
        _selectedCameraIndex = index;
        _error = null;
      });
    }
  }

  Future<void> _switchCamera() async {
    if (_cameras.length < 2 || _isRecording || _isProcessing) return;
    final nextIndex = (_selectedCameraIndex + 1) % _cameras.length;
    await _initControllerWithIndex(nextIndex);
  }

  Future<void> _takePhoto() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || _isProcessing || _isRecording) {
      return;
    }
    try {
      setState(() => _isProcessing = true);
      final image = await controller.takePicture();
      if (mounted) {
        setState(() => _capturedProofs.add(
              EmergencyProof(file: File(image.path), type: 'image'),
            ));
      }
    } on CameraException catch (error) {
      if (mounted) {
        setState(() => _error = error.description ?? 'Unable to take photo.');
      }
    } finally {
      if (mounted) setState(() => _isProcessing = false);
    }
  }

  Future<void> _startRecording() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || _isProcessing || _isRecording) {
      return;
    }
    try {
      setState(() {
        _isProcessing = true;
        _recordSeconds = 0;
      });
      await controller.startVideoRecording();
      if (!mounted) return;

      _recordTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        setState(() => _recordSeconds++);
        // Auto-stop at 60 seconds (1 minute max video)
        if (_recordSeconds >= 60) {
          _stopRecording();
        }
      });

      setState(() {
        _isRecording = true;
        _isProcessing = false;
      });
    } on CameraException catch (error) {
      _recordTimer?.cancel();
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _isRecording = false;
          _error = error.description ?? 'Unable to start video recording.';
        });
      }
    }
  }

  Future<void> _stopRecording() async {
    final controller = _controller;
    if (controller == null || !_isRecording) return;
    _recordTimer?.cancel();
    try {
      setState(() => _isProcessing = true);
      final video = await controller.stopVideoRecording();
      final duration = _recordSeconds;
      if (mounted) {
        setState(() => _capturedProofs.add(
          EmergencyProof(
            file: File(video.path),
            type: 'video',
            durationSeconds: duration > 0 ? duration : 1,
          ),
        ));
      }
    } on CameraException catch (error) {
      if (mounted) {
        setState(() => _error = error.description ?? 'Unable to save video.');
      }
    } finally {
      if (mounted) {
        setState(() {
          _isRecording = false;
          _isProcessing = false;
        });
      }
    }
  }

  String _formatDuration(int totalSeconds) {
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _recordTimer?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: ResidentGradientAppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'Capture Proof',
          style: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        actions: [
          if (_capturedProofs.isNotEmpty)
            TextButton(
              onPressed: _isRecording || _isProcessing ? null : _finishCapture,
              child: Text(
                'Done (${_capturedProofs.length})',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
              ),
            ),
          if (_cameras.length > 1 && !_isRecording)
            IconButton(
              icon: const Icon(Icons.flip_camera_ios, color: Colors.white),
              onPressed: _switchCamera,
            ),
        ],
      ),
      body: controller == null || !controller.value.isInitialized
          ? Center(
              child: Text(
                _error ?? 'Opening camera...',
                style: const TextStyle(color: Colors.white, fontSize: 16),
              ),
            )
          : Stack(
              fit: StackFit.expand,
              children: [
                // Camera Preview
                Center(
                  child: CameraPreview(controller),
                ),

                // Top Recording Status Banner
                if (_isRecording)
                  Positioned(
                    top: 16,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                        decoration: BoxDecoration(
                          color: Colors.black54,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.redAccent.withOpacity(0.8)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 10,
                              height: 10,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: Colors.red,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'REC ${_formatDuration(_recordSeconds)} / 01:00',
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                // Bottom Controls matching Image 3
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 40,
                  child: _isRecording
                      ? Center(
                          // Video Stop Button while recording
                          child: GestureDetector(
                            onTap: _isProcessing ? null : _stopRecording,
                            child: Container(
                              width: 78,
                              height: 78,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: Colors.white,
                                border: Border.all(color: Colors.white70, width: 4),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.3),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: Center(
                                child: Container(
                                  width: 32,
                                  height: 32,
                                  decoration: BoxDecoration(
                                    color: Colors.red,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        )
                      : Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            // 1. Camera / Photo Button (White circle with camera icon)
                            GestureDetector(
                              onTap: _isProcessing ? null : _takePhoto,
                              child: Container(
                                width: 72,
                                height: 72,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Colors.white,
                                  border: Border.all(color: Colors.white70, width: 3),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.3),
                                      blurRadius: 10,
                                      offset: const Offset(0, 4),
                                    ),
                                  ],
                                ),
                                child: const Icon(
                                  Icons.camera_alt,
                                  color: Colors.black,
                                  size: 32,
                                ),
                              ),
                            ),

                            const SizedBox(width: 36),

                            // 2. Video Button (White circle with red circle inside)
                            GestureDetector(
                              onTap: _isProcessing ? null : _startRecording,
                              child: Container(
                                width: 72,
                                height: 72,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Colors.white,
                                  border: Border.all(color: Colors.white70, width: 3),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withOpacity(0.3),
                                      blurRadius: 10,
                                      offset: const Offset(0, 4),
                                    ),
                                  ],
                                ),
                                child: Center(
                                  child: Container(
                                    width: 48,
                                    height: 48,
                                    decoration: const BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: Color(0xFFE53935),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                ),
              ],
            ),
    );
  }
}
