import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// A widget that displays either an image or video depending on [proofType].
/// For videos it shows play/pause button and a progress slider.
class VideoProofPlayer extends StatefulWidget {
  final String url;
  final File? file;
  final String proofType;
  final double height;

  const VideoProofPlayer({
    super.key,
    required this.url,
    this.file,
    required this.proofType,
    this.height = 220,
  });

  @override
  State<VideoProofPlayer> createState() => _VideoProofPlayerState();
}

class _VideoProofPlayerState extends State<VideoProofPlayer> {
  VideoPlayerController? _controller;
  bool _initialized = false;
  bool _error = false;

  bool get _isVideo {
    if (widget.proofType == 'video') return true;
    final lower = widget.url.toLowerCase().split('?').first;
    return lower.endsWith('.mp4') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.webm') ||
        lower.endsWith('.3gp') ||
        lower.endsWith('.mkv') ||
        lower.endsWith('.avi');
  }

  @override
  void initState() {
    super.initState();
    if (_isVideo) _initVideo();
  }

  Future<void> _initVideo() async {
    try {
      final ctrl = widget.file != null
          ? VideoPlayerController.file(widget.file!)
          : VideoPlayerController.networkUrl(Uri.parse(widget.url));
      _controller = ctrl;
      await ctrl.initialize();
      if (mounted) setState(() => _initialized = true);
    } catch (_) {
      if (mounted) setState(() => _error = true);
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_isVideo) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.network(
          widget.url,
          height: widget.height,
          width: double.infinity,
          fit: BoxFit.cover,
          loadingBuilder: (_, child, progress) => progress == null
              ? child
              : SizedBox(
                  height: widget.height,
                  child: const Center(child: CircularProgressIndicator()),
                ),
          errorBuilder: (_, __, ___) => SizedBox(
            height: widget.height,
            child: const Center(
              child: Icon(Icons.broken_image, color: Colors.grey, size: 50),
            ),
          ),
        ),
      );
    }

    if (_error) {
      return Container(
        height: widget.height,
        decoration: BoxDecoration(
          color: const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.videocam_off, color: Colors.grey, size: 48),
              SizedBox(height: 8),
              Text(
                'Unable to load video',
                style: TextStyle(color: Colors.grey),
              ),
            ],
          ),
        ),
      );
    }

    if (!_initialized || _controller == null) {
      return Container(
        height: widget.height,
        decoration: BoxDecoration(
          color: const Color(0xFF0F172A),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Center(child: CircularProgressIndicator()),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: _VideoControls(controller: _controller!, height: widget.height),
    );
  }
}

class _VideoControls extends StatefulWidget {
  final VideoPlayerController controller;
  final double height;

  const _VideoControls({required this.controller, required this.height});

  @override
  State<_VideoControls> createState() => _VideoControlsState();
}

class _VideoControlsState extends State<_VideoControls> {
  bool _showControls = true;

  VideoPlayerController get _ctrl => widget.controller;

  @override
  void initState() {
    super.initState();
    _ctrl.addListener(_onVideoUpdate);
  }

  void _onVideoUpdate() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _ctrl.removeListener(_onVideoUpdate);
    super.dispose();
  }

  String _formatDuration(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final value = _ctrl.value;
    final position = value.position;
    final duration = value.duration;
    final isPlaying = value.isPlaying;

    return LayoutBuilder(
      builder: (context, constraints) {
        final aspectRatio = value.aspectRatio;
        final safeAspectRatio = aspectRatio.isFinite && aspectRatio > 0
            ? aspectRatio
            : 16 / 9;
        final availableWidth = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : MediaQuery.sizeOf(context).width;
        final availableHeight = constraints.maxHeight.isFinite
            ? math.min(widget.height, constraints.maxHeight)
            : widget.height;
        final videoWidth = math.min(
          availableWidth,
          availableHeight * safeAspectRatio,
        );
        final videoHeight = videoWidth / safeAspectRatio;

        return SizedBox(
          width: videoWidth,
          height: videoHeight,
          child: GestureDetector(
            onTap: () => setState(() => _showControls = !_showControls),
            child: Stack(
              fit: StackFit.expand,
              alignment: Alignment.center,
              children: [
                VideoPlayer(_ctrl),
                if (_showControls) ...[
                  Container(color: Colors.black.withOpacity(0.35)),
                  GestureDetector(
                    onTap: () {
                      if (isPlaying) {
                        _ctrl.pause();
                      } else {
                        if (position >= duration) _ctrl.seekTo(Duration.zero);
                        _ctrl.play();
                      }
                      setState(() {});
                    },
                    child: Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.65),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white30, width: 1.5),
                      ),
                      child: Icon(
                        isPlaying ? Icons.pause : Icons.play_arrow,
                        color: Colors.white,
                        size: 32,
                      ),
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    left: 0,
                    right: 0,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.transparent,
                            Colors.black.withOpacity(0.75),
                          ],
                        ),
                      ),
                      child: Row(
                        children: [
                          Text(
                            _formatDuration(position),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                            ),
                          ),
                          Expanded(
                            child: SliderTheme(
                              data: SliderThemeData(
                                thumbShape: const RoundSliderThumbShape(
                                  enabledThumbRadius: 5,
                                ),
                                overlayShape: const RoundSliderOverlayShape(
                                  overlayRadius: 10,
                                ),
                                trackHeight: 2,
                                activeTrackColor: const Color(0xFF38BDF8),
                                inactiveTrackColor: Colors.white30,
                                thumbColor: const Color(0xFF38BDF8),
                                overlayColor: const Color(
                                  0xFF38BDF8,
                                ).withOpacity(0.2),
                              ),
                              child: Slider(
                                value: duration.inMilliseconds > 0
                                    ? position.inMilliseconds.toDouble().clamp(
                                        0,
                                        duration.inMilliseconds.toDouble(),
                                      )
                                    : 0,
                                min: 0,
                                max: duration.inMilliseconds > 0
                                    ? duration.inMilliseconds.toDouble()
                                    : 1,
                                onChanged: (v) => _ctrl.seekTo(
                                  Duration(milliseconds: v.toInt()),
                                ),
                              ),
                            ),
                          ),
                          Text(
                            _formatDuration(duration),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}
