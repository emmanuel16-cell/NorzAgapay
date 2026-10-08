import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../models/broadcast_post.dart';
import '../widgets/broadcast_media_grid.dart';
import '../widgets/broadcast_image_viewer.dart';
import 'create_broadcast_modal.dart';

class PublicAlertsScreen extends StatefulWidget {
  const PublicAlertsScreen({super.key});

  @override
  State<PublicAlertsScreen> createState() => _PublicAlertsScreenState();
}

class _PublicAlertsScreenState extends State<PublicAlertsScreen>
    with WidgetsBindingObserver {
  // Tab index: 0 = Barangay, 1 = MDRRMO
  int _selectedTab = 0; // 0 = All, 1 = Barangay, 2 = MDRRMO
  String _selectedCategory = 'all';

  static const List<Map<String, dynamic>> _categories = [
    {
      'id': 'all',
      'label': 'All Category',
      'description': 'Show all official alerts and updates',
      'icon': Icons.apps_rounded,
      'color': Color(0xFF475569),
      'bg': Color(0xFFF1F5F9),
      'border': Color(0xFFCBD5E1),
    },
    {
      'id': 'all_disaster',
      'label': 'All Disaster Alert',
      'description': 'Red, Orange, and Yellow emergency alerts',
      'icon': Icons.warning_rounded,
      'color': Color(0xFFDC2626),
      'bg': Color(0xFFFEF2F2),
      'border': Color(0xFFFCA5A5),
    },
    {
      'id': 'disaster_red',
      'label': 'Disaster Alert · Red',
      'description': 'Severe flooding, evacuation orders & life threats',
      'icon': Icons.local_fire_department_rounded,
      'color': Color(0xFFEF4444),
      'bg': Color(0xFFFEF2F2),
      'border': Color(0xFFFCA5A5),
    },
    {
      'id': 'disaster_orange',
      'label': 'Disaster Alert · Orange',
      'description': 'Dam spillway alerts & pre-evacuation notices',
      'icon': Icons.warning_amber_rounded,
      'color': Color(0xFFF97316),
      'bg': Color(0xFFFFF7ED),
      'border': Color(0xFFFDBA74),
    },
    {
      'id': 'disaster_yellow',
      'label': 'Disaster Alert · Yellow',
      'description': 'River telemetry warning & standing advisory',
      'icon': Icons.warning_amber_rounded,
      'color': Color(0xFFEAB308),
      'bg': Color(0xFFFFFBEB),
      'border': Color(0xFFFDE68A),
    },
    {
      'id': 'safety_advisory',
      'label': 'Safety Advisory',
      'description': 'Preemptive clearing, sandbagging & safety tips',
      'icon': Icons.security_rounded,
      'color': Color(0xFF14B8A6),
      'bg': Color(0xFFF0FDFA),
      'border': Color(0xFF99F6E4),
    },
    {
      'id': 'relief_assistance',
      'label': 'Relief & Assistance',
      'description': 'Food packs, medical kits & shelter distribution',
      'icon': Icons.volunteer_activism_rounded,
      'color': Color(0xFF22C55E),
      'bg': Color(0xFFF0FDF4),
      'border': Color(0xFFBBF7D0),
    },
    {
      'id': 'all_clear',
      'label': 'All-Clear Notice',
      'description': 'Water subsided, safe return to residences',
      'icon': Icons.check_circle_rounded,
      'color': Color(0xFF3B82F6),
      'bg': Color(0xFFEFF6FF),
      'border': Color(0xFFBFDBFE),
    },
  ];

  List<BroadcastPost> _barangayPosts = [];
  List<BroadcastPost> _mdrrmoPosts = [];
  bool _isLoading = true;
  String? _barangayLoadError;
  String? _mdrrmoLoadError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _fetchPosts();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _fetchPosts();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _fetchPosts() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _barangayLoadError = null;
      _mdrrmoLoadError = null;
    });

    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) {
      _barangayPosts = [];
      _mdrrmoPosts = [];
      _barangayLoadError = 'Sign in to load barangay posts.';
      _mdrrmoLoadError = 'Sign in to load MDRRMO posts.';
    } else {
      try {
        _barangayPosts = await ApiService.getBroadcasts(auth.token!);
      } catch (_) {
        _barangayPosts = [];
        _barangayLoadError =
            'Could not load barangay posts. Check your connection and try again.';
      }

      try {
        _mdrrmoPosts = await ApiService.getMdrrmoBroadcasts(auth.token!);
      } catch (_) {
        _mdrrmoPosts = [];
        _mdrrmoLoadError =
            'Could not load MDRRMO posts. Check your connection and try again.';
      }
    }
    if (mounted) setState(() => _isLoading = false);
  }

  Future<void> _openCreateModal({BroadcastPost? existing}) async {
    final auth = Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;
    final token = auth.token ?? '';

    final result = await showModalBottomSheet<BroadcastPost?>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CreateBroadcastModal(
        token: token,
        barangayId: user?.barangayId ?? '',
        barangayName: user?.barangayName ?? 'Barangay Bigte',
        authorId: user?.id ?? '',
        authorName: user?.fullName ?? 'Barangay Dispatcher',
        existingPost: existing,
      ),
    );

    if (result != null) {
      setState(() {
        if (existing != null) {
          final idx = _barangayPosts.indexWhere((p) => p.id == existing.id);
          if (idx != -1) {
            _barangayPosts[idx] = result;
          }
        } else {
          _barangayPosts.insert(0, result);
        }
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              existing != null
                  ? 'Post updated successfully!'
                  : 'Alert posted successfully!',
            ),
            backgroundColor: const Color(0xFF10B981),
          ),
        );
      }
    }
  }

  Future<void> _repostMdrrmoToBarangay(BroadcastPost mdrrmoPost) async {
    final auth = Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;
    final bName = user?.barangayName ?? 'Barangay Bigte';

    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Repost to $bName',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
        content: Text(
          'This MDRRMO alert will be shared to your barangay feed so residents of $bName will see it marked as "From Mdrrmo".',
          style: const TextStyle(color: Color(0xFF94A3B8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text(
              'Cancel',
              style: TextStyle(color: Color(0xFF94A3B8)),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0284C7),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: Text('Repost to $bName'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    if (auth.token == null) return;
    late final BroadcastPost reposted;
    try {
      reposted = await ApiService.repostBroadcast(auth.token!, mdrrmoPost.id);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not repost this alert: $error'),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
      return;
    }

    if (mounted) {
      setState(() {
        if (!_barangayPosts.any((post) => post.id == reposted.id)) {
          _barangayPosts.insert(0, reposted);
        }
      });
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Reposted to $bName successfully! View it in your Barangay feed.',
          ),
          backgroundColor: const Color(0xFF10B981),
          action: SnackBarAction(
            label: 'View Feed',
            textColor: Colors.white,
            onPressed: () => setState(() => _selectedTab = 1),
          ),
        ),
      );
    }
  }

  Future<void> _deletePost(BroadcastPost post) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Remove Post',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        content: const Text(
          'Are you sure you want to remove this alert broadcast? Residents will no longer see this notification.',
          style: TextStyle(color: Color(0xFF94A3B8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text(
              'Cancel',
              style: TextStyle(color: Color(0xFF94A3B8)),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) return;
    try {
      await ApiService.deleteBroadcast(auth.token!, post.id);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not remove this post: $error'),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
      return;
    }

    if (!mounted) return;
    setState(() {
      _barangayPosts.removeWhere((p) => p.id == post.id);
      _mdrrmoPosts.removeWhere((p) => p.id == post.id);
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Post removed.'),
          backgroundColor: Color(0xFF64748B),
        ),
      );
    }
  }

  Future<void> _togglePinnedPost(BroadcastPost post) async {
    final auth = Provider.of<AuthService>(context, listen: false);
    final token = auth.token;
    if (token == null) return;
    try {
      final updated = await ApiService.setBroadcastPinned(
        token,
        post.id,
        !post.isPinned,
      );
      if (!mounted) return;
      setState(() {
        final index = _barangayPosts.indexWhere(
          (item) => item.id == updated.id,
        );
        if (index >= 0) _barangayPosts[index] = updated;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            updated.isPinned
                ? 'Post pinned to resident home.'
                : 'Post unpinned from resident home.',
          ),
          backgroundColor: const Color(0xFF0D9488),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not update pinned status: $error'),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
    }
  }

  void _openMediaViewer(List<BroadcastMediaItem> items, int initialIndex) {
    if (items.length <= 5) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => BroadcastMediaViewer(
            mediaItems: items,
            initialIndex: initialIndex,
          ),
        ),
      );
    } else {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => BroadcastMediaCarousel(
            mediaItems: items,
            initialIndex: initialIndex,
          ),
        ),
      );
    }
  }

  void _openVerticalCarousel(List<BroadcastMediaItem> items) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => BroadcastMediaCarousel(mediaItems: items),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);
    final user = auth.currentUser;
    final isDispatcher = user?.canManageContent == true;
    final barangayDisplayName = user?.barangayName ?? 'Bigte';

    final sourcePosts = switch (_selectedTab) {
      1 => _barangayPosts,
      2 => _mdrrmoPosts,
      _ => [
        ..._barangayPosts,
        ..._mdrrmoPosts,
      ]..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
    };
    final sourceError = switch (_selectedTab) {
      1 => _barangayLoadError,
      2 => _mdrrmoLoadError,
      _ when _barangayLoadError != null && _mdrrmoLoadError != null =>
        'Could not load public alerts. Check your connection and try again.',
      _ => null,
    };
    final activePosts = sourcePosts.where(_matchesCategory).toList();

    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        flexibleSpace: const _BarangayGradient(),
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Public Alerts and Broadcasts',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 18,
            letterSpacing: -0.3,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchPosts,
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Segmented Top Bar: [ Barangay Name ] | [ Mdrrmo ] (Matching img 1) ──
          _buildSegmentedTabBar(barangayDisplayName),

          // ── Feed Body ──────────────────────────────────────────────────
          Expanded(
            child: _isLoading
                ? const Center(
                    child: CircularProgressIndicator(color: Color(0xFF38BDF8)),
                  )
                : sourceError != null
                ? _buildError(sourceError)
                : activePosts.isEmpty
                ? _buildEmpty()
                : RefreshIndicator(
                    onRefresh: _fetchPosts,
                    color: const Color(0xFF38BDF8),
                    child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(14, 14, 14, 80),
                      itemCount: activePosts.length,
                      itemBuilder: (context, index) {
                        final post = activePosts[index];
                        final isMdrrmoPost =
                            post.barangayId.isEmpty && post.isFromMdrrmo;

                        return _BroadcastPostCard(
                          post: post,
                          currentUserId: user?.id ?? '',
                          isDispatcher: isDispatcher,
                          isMdrrmoTab: isMdrrmoPost,
                          barangayName: barangayDisplayName,
                          onEdit: () => _openCreateModal(existing: post),
                          onDelete: () => _deletePost(post),
                          onRepost: () => _repostMdrrmoToBarangay(post),
                          onTogglePin: () => _togglePinnedPost(post),
                          onImageTap: (items, idx) =>
                              _openMediaViewer(items, idx),
                          onPlusTap: (items) => _openVerticalCarousel(items),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _openCategoryFilterSheet,
        backgroundColor: const Color(0xFF2563EB),
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        elevation: 5,
        tooltip: 'Filter posts by category',
        child: const Icon(Icons.format_list_bulleted_rounded, size: 27),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
    );
  }

  bool _matchesCategory(BroadcastPost post) {
    final id = _selectedCategory;
    if (id == 'all') return true;
    switch (id) {
      case 'all_disaster':
        return post.category == BroadcastCategory.disasterAlertRed ||
            post.category == BroadcastCategory.disasterAlertOrange ||
            post.category == BroadcastCategory.disasterAlertYellow;
      case 'disaster_red':
        return post.category == BroadcastCategory.disasterAlertRed;
      case 'disaster_orange':
        return post.category == BroadcastCategory.disasterAlertOrange;
      case 'disaster_yellow':
        return post.category == BroadcastCategory.disasterAlertYellow;
      case 'safety_advisory':
        return post.category == BroadcastCategory.safetyAdvisory;
      case 'relief_assistance':
        return post.category == BroadcastCategory.reliefAssistance;
      case 'all_clear':
        return post.category == BroadcastCategory.allClearNotice;
      default:
        return true;
    }
  }

  void _openCategoryFilterSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => _PostCategoryFilterSheet(
        categories: _categories,
        selectedCategory: _selectedCategory,
        showCreatePost:
            Provider.of<AuthService>(
                  context,
                  listen: false,
                ).currentUser?.canManageContent ==
                true &&
            _selectedTab != 2,
        onSelect: (id) {
          setState(() => _selectedCategory = id);
          Navigator.pop(sheetContext);
        },
        onCreatePost: () {
          Navigator.pop(sheetContext);
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => _openCreateModal(),
          );
        },
      ),
    );
  }

  // ── Segmented Top Bar (Matching img 1) ──────────────────────────────────
  Widget _buildSegmentedTabBar(String barangayName) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF151F34), Color(0xFF202C40)],
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
        ),
        border: Border(
          bottom: BorderSide(color: Color(0xFF334155), width: 1.5),
        ),
      ),
      child: Row(
        children: [
          // All posts are visible on the home feed by default.
          Expanded(
            child: InkWell(
              onTap: () => setState(() => _selectedTab = 0),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  border: Border(
                    right: const BorderSide(color: Color(0xFF334155), width: 1),
                    bottom: BorderSide(
                      color: _selectedTab == 0
                          ? const Color(0xFF38BDF8)
                          : Colors.transparent,
                      width: 2.5,
                    ),
                  ),
                ),
                child: Center(
                  child: Text(
                    'All',
                    style: TextStyle(
                      color: _selectedTab == 0
                          ? Colors.white
                          : const Color(0xFF94A3B8),
                      fontWeight: _selectedTab == 0
                          ? FontWeight.bold
                          : FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
            ),
          ),

          // Barangay Name
          Expanded(
            child: InkWell(
              onTap: () => setState(() => _selectedTab = 1),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  border: Border(
                    right: const BorderSide(color: Color(0xFF334155), width: 1),
                    bottom: BorderSide(
                      color: _selectedTab == 1
                          ? const Color(0xFF38BDF8)
                          : Colors.transparent,
                      width: 2.5,
                    ),
                  ),
                  color: Colors.transparent,
                ),
                child: Center(
                  child: Text(
                    barangayName.isNotEmpty ? barangayName : 'Barangay Name',
                    style: TextStyle(
                      color: _selectedTab == 1
                          ? Colors.white
                          : const Color(0xFF94A3B8),
                      fontWeight: _selectedTab == 1
                          ? FontWeight.bold
                          : FontWeight.w600,
                      fontSize: 14,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ),
          ),

          // MDRRMO
          Expanded(
            child: InkWell(
              onTap: () => setState(() => _selectedTab = 2),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: _selectedTab == 2
                          ? const Color(0xFF38BDF8)
                          : Colors.transparent,
                      width: 2.5,
                    ),
                  ),
                  color: Colors.transparent,
                ),
                child: Center(
                  child: Text(
                    'Mdrrmo',
                    style: TextStyle(
                      color: _selectedTab == 2
                          ? Colors.white
                          : const Color(0xFF94A3B8),
                      fontWeight: _selectedTab == 2
                          ? FontWeight.bold
                          : FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildError(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.cloud_off_rounded,
              color: Color(0xFF475569),
              size: 56,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _fetchPosts,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0284C7),
              ),
              child: const Text(
                'Try Again',
                style: TextStyle(color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty() {
    final isMdrrmo = _selectedTab == 2;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.campaign_outlined,
              size: 64,
              color: Color(0xFF94A3B8),
            ),
            const SizedBox(height: 14),
            Text(
              _selectedCategory != 'all'
                  ? 'No posts in this category.'
                  : isMdrrmo
                  ? 'No MDRRMO broadcasts available yet.'
                  : 'No public alerts posted yet.',
              style: const TextStyle(
                color: Color(0xFF1E293B),
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              _selectedCategory != 'all'
                  ? 'Try a different category filter.'
                  : isMdrrmo
                  ? 'Municipal emergency advisories will appear here.'
                  : 'Open the filter button to create a post or choose another category.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Post card (Matches img 2 layout + "From Mdrrmo" badge + Repost Menu) ───

class _BroadcastPostCard extends StatefulWidget {
  final BroadcastPost post;
  final String currentUserId;
  final bool isDispatcher;
  final bool isMdrrmoTab;
  final String barangayName;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onRepost;
  final VoidCallback onTogglePin;
  final void Function(List<BroadcastMediaItem> items, int index) onImageTap;
  final void Function(List<BroadcastMediaItem> items) onPlusTap;

  const _BroadcastPostCard({
    required this.post,
    required this.currentUserId,
    required this.isDispatcher,
    required this.isMdrrmoTab,
    required this.barangayName,
    required this.onEdit,
    required this.onDelete,
    required this.onRepost,
    required this.onTogglePin,
    required this.onImageTap,
    required this.onPlusTap,
  });

  @override
  State<_BroadcastPostCard> createState() => _BroadcastPostCardState();
}

class _BroadcastPostCardState extends State<_BroadcastPostCard> {
  String _formatTimestamp(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'Yesterday';
    return '${dt.month}/${dt.day}/${dt.year}';
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final cat = post.category;
    final isMdrrmoTab = widget.isMdrrmoTab;
    final isRepostedFromMdrrmo = post.isFromMdrrmo && !isMdrrmoTab;

    final mediaItems = post.media;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: post.isPinned
              ? const Color(0xFFF59E0B)
              : const Color(0xFFE2E8F0),
          width: post.isPinned ? 2 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: post.isPinned
                ? const Color(0xFFF59E0B).withValues(alpha: 0.15)
                : Colors.black.withValues(alpha: 0.04),
            blurRadius: post.isPinned ? 12 : 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      clipBehavior: Clip.hardEdge,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (post.isPinned)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
              decoration: const BoxDecoration(
                color: Color(0xFFFEF3C7),
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: const Row(
                children: [
                  Icon(
                    Icons.push_pin_rounded,
                    size: 14,
                    color: Color(0xFFB45309),
                  ),
                  SizedBox(width: 6),
                  Text(
                    'PINNED',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFFB45309),
                      letterSpacing: 0.8,
                    ),
                  ),
                ],
              ),
            ),

          // Keep the repost source visible in a light resident-feed style.
          if (isRepostedFromMdrrmo)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: const BoxDecoration(
                color: Color(0xFFEFF6FF),
                border: Border(
                  bottom: BorderSide(color: Color(0xFFDBEAFE), width: 1),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.shield_rounded,
                    color: Color(0xFF1B4F72),
                    size: 14,
                  ),
                  const SizedBox(width: 6),
                  const Text(
                    'From MDRRMO',
                    style: TextStyle(
                      color: Color(0xFF1B4F72),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (post.repostedBy != null) ...[
                    const SizedBox(width: 6),
                    Text(
                      '• Reposted by ${post.repostedBy}',
                      style: const TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 10,
                      ),
                    ),
                  ],
                ],
              ),
            ),

          // ── Header (Barangay Name / MDRRMO + Timestamp + Pill + 3-Dot) ───
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 10, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                // Name + Timestamp
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              isMdrrmoTab
                                  ? 'MDRRMO Norzagaray'
                                  : (post.barangayName.toLowerCase().startsWith(
                                          'barangay',
                                        )
                                        ? post.barangayName
                                        : 'Barangay ${post.barangayName}'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF0F172A),
                                fontWeight: FontWeight.bold,
                                fontSize: 15.5,
                              ),
                            ),
                          ),
                          const SizedBox(width: 5),
                          const Icon(
                            Icons.verified_rounded,
                            size: 16,
                            color: Color(0xFF1B4F72),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _formatTimestamp(post.createdAt),
                        style: const TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 11.5,
                        ),
                      ),
                    ],
                  ),
                ),

                // Pill (Category)
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 140),
                  child: _CategoryPill(category: cat),
                ),
                const SizedBox(width: 4),

                // 3-dot Menu:
                // - On MDRRMO tab: shows "Repost to (barangay name)"
                // - On Barangay tab: shows "Edit Post" and "Remove Post" for dispatcher
                if (isMdrrmoTab && widget.isDispatcher) ...[
                  PopupMenuButton<String>(
                    color: const Color(0xFF1E293B),
                    icon: const Icon(
                      Icons.more_vert,
                      color: Color(0xFF475569),
                      size: 22,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    onSelected: (v) {
                      if (v == 'repost') widget.onRepost();
                    },
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'repost',
                        child: Row(
                          children: [
                            const Icon(
                              Icons.repeat_rounded,
                              color: Color(0xFF38BDF8),
                              size: 18,
                            ),
                            const SizedBox(width: 10),
                            Text(
                              'Repost to ${widget.barangayName}',
                              style: const TextStyle(color: Colors.white),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ] else if (widget.isDispatcher) ...[
                  PopupMenuButton<String>(
                    color: const Color(0xFF1E293B),
                    icon: const Icon(
                      Icons.more_vert,
                      color: Color(0xFF475569),
                      size: 22,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    onSelected: (v) {
                      if (v == 'edit') widget.onEdit();
                      if (v == 'delete') widget.onDelete();
                      if (v == 'pin') widget.onTogglePin();
                    },
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'pin',
                        child: Row(
                          children: [
                            const Icon(
                              Icons.push_pin_outlined,
                              color: Color(0xFF38BDF8),
                              size: 18,
                            ),
                            const SizedBox(width: 10),
                            Text(
                              post.isPinned
                                  ? 'Unpin from Resident Home'
                                  : 'Pin to Resident Home',
                              style: const TextStyle(color: Colors.white),
                            ),
                          ],
                        ),
                      ),
                      PopupMenuItem(
                        value: 'edit',
                        child: Row(
                          children: [
                            Icon(
                              Icons.edit_outlined,
                              color: Color(0xFF38BDF8),
                              size: 18,
                            ),
                            SizedBox(width: 10),
                            Text(
                              'Edit Post',
                              style: TextStyle(color: Colors.white),
                            ),
                          ],
                        ),
                      ),
                      PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(
                              Icons.delete_outline,
                              color: Color(0xFFEF4444),
                              size: 18,
                            ),
                            SizedBox(width: 10),
                            Text(
                              'Remove Post',
                              style: TextStyle(color: Color(0xFFEF4444)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),

          // Match resident feed spacing and content/media/link ordering.
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  post.content,
                  style: const TextStyle(
                    color: Color(0xFF1E293B),
                    fontSize: 13.5,
                    height: 1.45,
                  ),
                ),
                if (mediaItems.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  BroadcastMediaGrid(
                    mediaItems: mediaItems,
                    onItemTap: (idx) => widget.onImageTap(mediaItems, idx),
                    onPlusTap: () => widget.onPlusTap(mediaItems),
                  ),
                ],
                if (post.links.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: post.links
                        .map((link) => _LinkTile(url: link))
                        .toList(),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Category pill ──────────────────────────────────────────────────────────

class _CategoryPill extends StatelessWidget {
  final BroadcastCategory category;

  const _CategoryPill({required this.category});

  @override
  Widget build(BuildContext context) {
    late final Color color;
    late final Color background;
    late final Color border;
    late final IconData icon;
    switch (category) {
      case BroadcastCategory.disasterAlertYellow:
        color = const Color(0xFFD97706);
        background = const Color(0xFFFFFBEB);
        border = const Color(0xFFFDE68A);
        icon = Icons.warning_amber_rounded;
        break;
      case BroadcastCategory.disasterAlertOrange:
        color = const Color(0xFFF97316);
        background = const Color(0xFFFFF7ED);
        border = const Color(0xFFFDBA74);
        icon = Icons.warning_amber_rounded;
        break;
      case BroadcastCategory.disasterAlertRed:
        color = const Color(0xFFEF4444);
        background = const Color(0xFFFEF2F2);
        border = const Color(0xFFFCA5A5);
        icon = Icons.local_fire_department_rounded;
        break;
      case BroadcastCategory.safetyAdvisory:
        color = const Color(0xFF0D9488);
        background = const Color(0xFFF0FDFA);
        border = const Color(0xFF99F6E4);
        icon = Icons.security_rounded;
        break;
      case BroadcastCategory.reliefAssistance:
        color = const Color(0xFF16A34A);
        background = const Color(0xFFF0FDF4);
        border = const Color(0xFFBBF7D0);
        icon = Icons.volunteer_activism_rounded;
        break;
      case BroadcastCategory.allClearNotice:
        color = const Color(0xFF2563EB);
        background = const Color(0xFFEFF6FF);
        border = const Color(0xFFBFDBFE);
        icon = Icons.check_circle_rounded;
        break;
    }
    final label = category.sublabel.isNotEmpty
        ? '${category.label} · ${category.sublabel}'
        : category == BroadcastCategory.reliefAssistance
        ? 'Relief & Assistance'
        : category.label;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color,
                fontSize: 10.5,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Link tile ───────────────────────────────────────────────────────────────

class _LinkTile extends StatelessWidget {
  final String url;

  const _LinkTile({required this.url});

  Future<void> _launch() async {
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _launch,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFCBD5E1)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.link_rounded, color: Color(0xFF1B4F72), size: 14),
            const SizedBox(width: 4),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 240),
              child: Text(
                url.replaceFirst(RegExp(r'https?://'), ''),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF1B4F72),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BarangayGradient extends StatelessWidget {
  const _BarangayGradient();

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
  );
}

class _PostCategoryFilterSheet extends StatelessWidget {
  final List<Map<String, dynamic>> categories;
  final String selectedCategory;
  final ValueChanged<String> onSelect;
  final bool showCreatePost;
  final VoidCallback onCreatePost;

  const _PostCategoryFilterSheet({
    required this.categories,
    required this.selectedCategory,
    required this.onSelect,
    required this.showCreatePost,
    required this.onCreatePost,
  });

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.86,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 44,
                height: 5,
                decoration: BoxDecoration(
                  color: Color(0xFFD6D6D6),
                  borderRadius: BorderRadius.all(Radius.circular(8)),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 12, 12),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2563EB).withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(
                        Icons.format_list_bulleted_rounded,
                        color: Color(0xFF2563EB),
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Filter by Post Category',
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                          Text(
                            'Select a category to filter public alerts and advisories',
                            style: TextStyle(
                              fontSize: 12,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close, color: Color(0xFF9CA3AF)),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, indent: 16, endIndent: 16),
              Expanded(
                child: ListView.builder(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
                  itemCount: categories.length,
                  itemBuilder: (context, index) {
                    final category = categories[index];
                    final id = category['id'] as String;
                    final selected = id == selectedCategory;
                    final color = category['color'] as Color;
                    final border = category['border'] as Color;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Material(
                        color: selected
                            ? category['bg'] as Color
                            : Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: () => onSelect(id),
                          child: Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: selected
                                    ? const Color(0xFF475569)
                                    : border.withValues(alpha: .65),
                                width: selected ? 2 : 1,
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 48,
                                  height: 48,
                                  decoration: BoxDecoration(
                                    color: color.withValues(alpha: .15),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Icon(
                                    category['icon'] as IconData,
                                    color: color,
                                    size: 23,
                                  ),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        category['label'] as String,
                                        style: const TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.bold,
                                          color: Color(0xFF1E293B),
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        category['description'] as String,
                                        style: const TextStyle(
                                          fontSize: 12.5,
                                          color: Color(0xFF737373),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Icon(
                                  selected
                                      ? Icons.check_circle
                                      : Icons.chevron_right,
                                  color: selected
                                      ? const Color(0xFF475569)
                                      : const Color(0xFFBDBDBD),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              if (showCreatePost)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                  ),
                  child: SizedBox(
                    height: 54,
                    child: ElevatedButton.icon(
                      onPressed: onCreatePost,
                      icon: const Icon(Icons.add_rounded),
                      label: const Text(
                        'Create Post',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0D9488),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
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
}
