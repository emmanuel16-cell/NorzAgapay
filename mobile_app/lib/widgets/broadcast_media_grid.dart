import 'package:flutter/material.dart';
import 'package:mobile_app/models/broadcast_post.dart';

/// Displays post media using the resident feed's 1-6+ arrangement while
/// retaining tappable image and video previews.
class BroadcastMediaGrid extends StatelessWidget {
  final List<BroadcastMediaItem> mediaItems;
  final void Function(int index) onItemTap;
  final VoidCallback? onPlusTap;

  const BroadcastMediaGrid({
    super.key,
    required this.mediaItems,
    required this.onItemTap,
    this.onPlusTap,
  });

  @override
  Widget build(BuildContext context) {
    if (mediaItems.isEmpty) return const SizedBox.shrink();

    final count = mediaItems.length;

    final grid = switch (count) {
      1 => _buildOne(),
      2 => _buildTwo(),
      3 => _buildThree(),
      4 => _buildFour(),
      5 => _buildFive(),
      _ => _buildSixPlus(),
    };

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: grid,
    );
  }

  // ── 1 media item ────────────────────────────────────────────────────────
  Widget _buildOne() {
    return SizedBox(
      width: double.infinity,
      height: 210,
      child: _cell(0, rounded: false),
    );
  }

  // ── 2 media items ───────────────────────────────────────────────────────
  Widget _buildTwo() {
    return SizedBox(
      width: double.infinity,
      height: 180,
      child: Row(
        children: [
          Expanded(child: _cell(0, rounded: false)),
          const SizedBox(width: 4),
          Expanded(child: _cell(1, rounded: false)),
        ],
      ),
    );
  }

  // ── 3 media items ───────────────────────────────────────────────────────
  Widget _buildThree() {
    return SizedBox(
      width: double.infinity,
      height: 250,
      child: Column(
        children: [
          Expanded(
            flex: 14,
            child: Row(
              children: [Expanded(child: _cell(0, rounded: false))],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            flex: 11,
            child: Row(
              children: [
                Expanded(child: _cell(1, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(2, rounded: false)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── 4 media items ───────────────────────────────────────────────────────
  Widget _buildFour() {
    return SizedBox(
      width: double.infinity,
      height: 240,
      child: Column(
        children: [
          Expanded(
            child: Row(
              children: [
                Expanded(child: _cell(0, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(1, rounded: false)),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: Row(
              children: [
                Expanded(child: _cell(2, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(3, rounded: false)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── 5 media items ───────────────────────────────────────────────────────
  Widget _buildFive() {
    return SizedBox(
      width: double.infinity,
      height: 250,
      child: Column(
        children: [
          Expanded(
            flex: 13,
            child: Row(
              children: [
                Expanded(child: _cell(0, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(1, rounded: false)),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            flex: 11,
            child: Row(
              children: [
                Expanded(child: _cell(2, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(3, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(4, rounded: false)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── 6+ media items ──────────────────────────────────────────────────────
  Widget _buildSixPlus() {
    final extraCount = mediaItems.length - 5;
    return SizedBox(
      width: double.infinity,
      height: 250,
      child: Column(
        children: [
          Expanded(
            flex: 13,
            child: Row(
              children: [
                Expanded(child: _cell(0, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(1, rounded: false)),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            flex: 11,
            child: Row(
              children: [
                Expanded(child: _cell(2, rounded: false)),
                const SizedBox(width: 4),
                Expanded(child: _cell(3, rounded: false)),
                const SizedBox(width: 4),
                Expanded(
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      _cell(4, rounded: false),
                      GestureDetector(
                        onTap: () {
                          if (onPlusTap != null) {
                            onPlusTap!();
                          } else {
                            onItemTap(4);
                          }
                        },
                        child: Container(
                          color: const Color(0xFF64748B).withValues(alpha: 0.65),
                          child: Center(
                            child: Text(
                              '+$extraCount',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 1,
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
          ),
        ],
      ),
    );
  }

  // ── Helper: single media cell (image or video thumbnail) ─────────────────
  Widget _cell(int index, {double? aspectRatio, bool rounded = false}) {
    final item = mediaItems[index];
    final child = GestureDetector(
      onTap: () => onItemTap(index),
      child: Container(
        clipBehavior: Clip.hardEdge,
        decoration: BoxDecoration(
          borderRadius: rounded ? BorderRadius.circular(8) : BorderRadius.zero,
          color: const Color(0xFF1E293B),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Thumbnail: for videos we show the first frame or a dark bg
            Image.network(
              item.isVideo ? _videoThumbnailFallback(item.url) : item.url,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => Container(
                color: const Color(0xFF334155),
                child: Icon(
                  item.isVideo ? Icons.videocam_outlined : Icons.broken_image,
                  color: const Color(0xFF64748B),
                  size: 32,
                ),
              ),
              loadingBuilder: (context, child, progress) {
                if (progress == null) return child;
                return Container(
                  color: const Color(0xFF1E293B),
                  child: const Center(
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Color(0xFF38BDF8),
                    ),
                  ),
                );
              },
            ),

            // Video play overlay
            if (item.isVideo)
              Container(
                color: Colors.black.withValues(alpha: 0.35),
                child: Center(
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white.withValues(alpha: 0.2),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.6),
                        width: 2,
                      ),
                    ),
                    child: const Icon(
                      Icons.play_arrow_rounded,
                      color: Colors.white,
                      size: 26,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );

    if (aspectRatio != null) {
      return AspectRatio(aspectRatio: aspectRatio, child: child);
    }
    return child;
  }

  /// For video URLs we cannot extract a thumbnail natively without video_player,
  /// so we try a YouTube thumbnail pattern or fall back to showing an icon.
  /// The image widget's errorBuilder will show a video icon on failure.
  String _videoThumbnailFallback(String url) {
    // YouTube short thumbnail extraction
    final ytMatch = RegExp(r'(?:youtu\.be/|youtube\.com/(?:embed/|v/|watch\?v=))([\w-]+)')
        .firstMatch(url);
    if (ytMatch != null) {
      return 'https://img.youtube.com/vi/${ytMatch.group(1)}/mqdefault.jpg';
    }
    // For direct .mp4 etc., return the url itself — Image.network will fail
    // gracefully and show the video icon via errorBuilder
    return url;
  }
}
