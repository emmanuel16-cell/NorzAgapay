import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';
import 'package:mobile_app/models/broadcast_post.dart';

// ─── Full-screen viewer: swipeable for 1-5 items (images + videos) ───────────

class BroadcastMediaViewer extends StatefulWidget {
  final List<BroadcastMediaItem> mediaItems;
  final int initialIndex;

  const BroadcastMediaViewer({
    super.key,
    required this.mediaItems,
    this.initialIndex = 0,
  });

  @override
  State<BroadcastMediaViewer> createState() => _BroadcastMediaViewerState();
}

class _BroadcastMediaViewerState extends State<BroadcastMediaViewer> {
  late PageController _pageController;
  late int _currentPage;

  @override
  void initState() {
    super.initState();
    _currentPage = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }

  @override
  void dispose() {
    _pageController.dispose();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Swipeable pages
          PageView.builder(
            controller: _pageController,
            itemCount: widget.mediaItems.length,
            onPageChanged: (i) => setState(() => _currentPage = i),
            itemBuilder: (context, index) {
              final item = widget.mediaItems[index];
              if (item.isVideo) {
                return _VideoPage(url: item.url);
              }
              return InteractiveViewer(
                minScale: 0.8,
                maxScale: 4.0,
                child: Center(
                  child: Image.network(
                    item.url,
                    fit: BoxFit.contain,
                    width: double.infinity,
                    height: double.infinity,
                    errorBuilder: (context, error, stackTrace) => const Center(
                      child: Icon(Icons.broken_image, color: Colors.white54, size: 64),
                    ),
                    loadingBuilder: (context, child, progress) {
                      if (progress == null) return child;
                      return const Center(
                        child: CircularProgressIndicator(color: Colors.white),
                      );
                    },
                  ),
                ),
              );
            },
          ),

          // Close button
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 12,
            child: GestureDetector(
              onTap: () => Navigator.of(context).pop(),
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.6),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.close, color: Colors.white, size: 22),
              ),
            ),
          ),

          // Counter
          if (widget.mediaItems.length > 1)
            Positioned(
              top: MediaQuery.of(context).padding.top + 14,
              right: 16,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.6),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (widget.mediaItems[_currentPage].isVideo) ...[
                      const Icon(Icons.videocam_outlined, color: Colors.white70, size: 14),
                      const SizedBox(width: 4),
                    ],
                    Text(
                      '${_currentPage + 1} / ${widget.mediaItems.length}',
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ),

          // Dot indicators
          if (widget.mediaItems.length > 1)
            Positioned(
              bottom: MediaQuery.of(context).padding.bottom + 16,
              left: 0,
              right: 0,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(widget.mediaItems.length, (i) {
                  final isVideo = widget.mediaItems[i].isVideo;
                  return AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    width: _currentPage == i ? 20 : 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: _currentPage == i
                          ? (isVideo ? const Color(0xFFA78BFA) : Colors.white)
                          : Colors.white.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(4),
                    ),
                  );
                }),
              ),
            ),
        ],
      ),
    );
  }
}

// ─── Inline video player page ─────────────────────────────────────────────────

class _VideoPage extends StatefulWidget {
  final String url;
  const _VideoPage({required this.url});

  @override
  State<_VideoPage> createState() => _VideoPageState();
}

class _VideoPageState extends State<_VideoPage> {
  late VideoPlayerController _controller;
  bool _initialized = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url))
      ..initialize().then((_) {
        if (mounted) setState(() => _initialized = true);
      }).catchError((_) {
        if (mounted) setState(() => _hasError = true);
      });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_hasError) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.videocam_off_outlined, color: Colors.white54, size: 56),
            SizedBox(height: 12),
            Text('Unable to load video', style: TextStyle(color: Colors.white54, fontSize: 13)),
          ],
        ),
      );
    }

    if (!_initialized) {
      return const Center(child: CircularProgressIndicator(color: Colors.white));
    }

    return GestureDetector(
      onTap: () {
        setState(() {
          _controller.value.isPlaying ? _controller.pause() : _controller.play();
        });
      },
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Video
          Center(
            child: AspectRatio(
              aspectRatio: _controller.value.aspectRatio,
              child: VideoPlayer(_controller),
            ),
          ),

          // Play/Pause overlay
          AnimatedOpacity(
            opacity: _controller.value.isPlaying ? 0.0 : 1.0,
            duration: const Duration(milliseconds: 200),
            child: Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.black.withValues(alpha: 0.5),
                border: Border.all(color: Colors.white.withValues(alpha: 0.8), width: 2),
              ),
              child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 38),
            ),
          ),

          // Bottom progress bar
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: VideoProgressIndicator(
              _controller,
              allowScrubbing: true,
              colors: const VideoProgressColors(
                playedColor: Color(0xFF38BDF8),
                bufferedColor: Color(0x4038BDF8),
                backgroundColor: Color(0x2AFFFFFF),
              ),
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Vertical carousel for 6+ items (images + videos) ────────────────────────

class BroadcastMediaCarousel extends StatelessWidget {
  final List<BroadcastMediaItem> mediaItems;
  final int initialIndex;

  const BroadcastMediaCarousel({
    super.key,
    required this.mediaItems,
    this.initialIndex = 0,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          ListView.builder(
            padding: EdgeInsets.only(
              top: MediaQuery.of(context).padding.top + 56,
              bottom: MediaQuery.of(context).padding.bottom + 24,
            ),
            itemCount: mediaItems.length,
            itemBuilder: (context, index) {
              final item = mediaItems[index];
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: item.isVideo
                    ? _CarouselVideoTile(url: item.url)
                    : Image.network(
                        item.url,
                        fit: BoxFit.cover,
                        width: double.infinity,
                        errorBuilder: (context, error, stackTrace) => Container(
                          height: 220,
                          color: const Color(0xFF1E293B),
                          child: const Center(
                            child: Icon(Icons.broken_image, color: Colors.white54, size: 48),
                          ),
                        ),
                        loadingBuilder: (context, child, progress) {
                          if (progress == null) return child;
                          return Container(
                            height: 220,
                            color: const Color(0xFF1E293B),
                            child: const Center(
                              child: CircularProgressIndicator(color: Colors.white),
                            ),
                          );
                        },
                      ),
              );
            },
          ),

          // Header
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: Container(
              color: Colors.black.withValues(alpha: 0.85),
              padding: EdgeInsets.only(
                top: MediaQuery.of(context).padding.top + 4,
                left: 4,
                right: 16,
                bottom: 8,
              ),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back, color: Colors.white),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'All Media (${mediaItems.length})',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Carousel video tile (tap to open full viewer) ───────────────────────────

class _CarouselVideoTile extends StatelessWidget {
  final String url;
  const _CarouselVideoTile({required this.url});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 220,
      color: const Color(0xFF1E293B),
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.videocam_outlined, color: Color(0xFF475569), size: 48),
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.black.withValues(alpha: 0.4),
              border: Border.all(color: Colors.white.withValues(alpha: 0.6), width: 2),
            ),
            child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 32),
          ),
        ],
      ),
    );
  }
}

// ─── Legacy aliases (kept for backward compat, use BroadcastMediaViewer instead) ─

@Deprecated('Use BroadcastMediaViewer instead')
class BroadcastImageViewer extends BroadcastMediaViewer {
  BroadcastImageViewer({
    super.key,
    required List<String> imageUrls,
    super.initialIndex,
  }) : super(
          mediaItems: imageUrls
              .map((url) => BroadcastMediaItem(url: url, isVideo: false))
              .toList(),
        );
}

@Deprecated('Use BroadcastMediaCarousel instead')
class BroadcastImageCarousel extends BroadcastMediaCarousel {
  BroadcastImageCarousel({
    super.key,
    required List<String> imageUrls,
    super.initialIndex,
  }) : super(
          mediaItems: imageUrls
              .map((url) => BroadcastMediaItem(url: url, isVideo: false))
              .toList(),
        );
}
