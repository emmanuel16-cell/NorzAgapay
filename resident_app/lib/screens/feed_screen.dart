import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:url_launcher/url_launcher.dart';
import '../core/barangay_names.dart';
import '../core/constants.dart';
import '../services/offline_service.dart';

class FeedScreen extends StatefulWidget {
  final VoidCallback? onNavigateToHotlines;
  final Future<void> Function()? onRefreshLocation;

  const FeedScreen({
    super.key,
    this.onNavigateToHotlines,
    this.onRefreshLocation,
  });

  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends State<FeedScreen> with WidgetsBindingObserver {
  // The home feed starts with the resident's barangay and municipality alerts.
  String _selectedSource = 'all';
  String _selectedBarangay = '';

  // Category filter: 'all' by default, or specific category from img 2 button
  String _selectedCategory = 'all';

  bool _isLoading = false;
  String? _loadError;
  List<Map<String, dynamic>> _posts = [];
  List<String> _verifiedBarangayNames = [];
  Set<String> _residentPinnedBroadcastIds = {};

  // Category definitions with rich color palette matching web-dashboard
  final List<Map<String, dynamic>> _categories = [
    {
      'id': 'all',
      'label': 'All Category',
      'color': const Color(0xFF475569),
      'bg': const Color(0xFFF1F5F9),
      'border': const Color(0xFFCBD5E1),
      'icon': Icons.apps_rounded,
      'description': 'Show all official alerts and updates',
    },
    {
      'id': 'all_disaster',
      'label': 'All Disaster Alert',
      'color': const Color(0xFFDC2626),
      'bg': const Color(0xFFFEF2F2),
      'border': const Color(0xFFFCA5A5),
      'icon': Icons.warning_rounded,
      'description': 'Red, Orange, and Yellow emergency alerts',
    },
    {
      'id': 'disaster_red',
      'label': 'Disaster Alert · Red',
      'color': const Color(0xFFEF4444),
      'bg': const Color(0xFFFEF2F2),
      'border': const Color(0xFFFCA5A5),
      'icon': Icons.local_fire_department_rounded,
      'description': 'Severe flooding, evacuation orders & life threats',
    },
    {
      'id': 'disaster_orange',
      'label': 'Disaster Alert · Orange',
      'color': const Color(0xFFF97316),
      'bg': const Color(0xFFFFF7ED),
      'border': const Color(0xFFFDBA74),
      'icon': Icons.warning_amber_rounded,
      'description': 'Dam spillway alerts & pre-evacuation notices',
    },
    {
      'id': 'disaster_yellow',
      'label': 'Disaster Alert · Yellow',
      'color': const Color(0xFFEAB308),
      'bg': const Color(0xFFFFFBEB),
      'border': const Color(0xFFFDE68A),
      'icon': Icons.warning_amber_rounded,
      'description': 'River telemetry warning & standing advisory',
    },
    {
      'id': 'safety_advisory',
      'label': 'Safety Advisory',
      'color': const Color(0xFF14B8A6),
      'bg': const Color(0xFFF0FDFA),
      'border': const Color(0xFF99F6E4),
      'icon': Icons.security_rounded,
      'description': 'Preemptive clearing, sandbagging & safety tips',
    },
    {
      'id': 'relief_assistance',
      'label': 'Relief & Assistance',
      'color': const Color(0xFF22C55E),
      'bg': const Color(0xFFF0FDF4),
      'border': const Color(0xFFBBF7D0),
      'icon': Icons.volunteer_activism_rounded,
      'description': 'Food packs, medical kits & shelter distribution',
    },
    {
      'id': 'all_clear',
      'label': 'All-Clear Notice',
      'color': const Color(0xFF3B82F6),
      'bg': const Color(0xFFEFF6FF),
      'border': const Color(0xFFBFDBFE),
      'icon': Icons.check_circle_rounded,
      'description': 'Water subsided, safe return to residences',
    },
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _residentPinnedBroadcastIds = OfflineService.getPinnedBroadcastIds();
    _loadVerifiedBarangays();
    _fetchBroadcasts();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _fetchBroadcasts();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _loadVerifiedBarangays() async {
    final cached = OfflineService.getCachedBarangays()
        .where((barangay) => barangay['is_verified'] == true)
        .map((barangay) => barangay['name']?.toString())
        .whereType<String>()
        .toList();
    if (mounted && cached.isNotEmpty) {
      final savedBarangay = OfflineService.getProfile()?['barangay_name']
          ?.toString();
      setState(() {
        _verifiedBarangayNames = cached;
        _selectedBarangay = cached.contains(savedBarangay)
            ? savedBarangay!
            : cached.first;
      });
    }
    try {
      final response = await http
          .get(
            Uri.parse(
              '${AppConstants.apiBaseUrl}/barangay/list?verified_only=true',
            ),
            headers: {'ngrok-skip-browser-warning': 'true'},
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return;
      final data = (jsonDecode(response.body) as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .where((barangay) => barangay['is_verified'] == true)
          .toList();
      await OfflineService.saveBarangays(data);
      if (!mounted) return;
      setState(() {
        _verifiedBarangayNames = data
            .map((row) => row['name'].toString())
            .toList();
        final savedBarangay = OfflineService.getProfile()?['barangay_name']
            ?.toString();
        if (_verifiedBarangayNames.contains(savedBarangay)) {
          _selectedBarangay = savedBarangay!;
        } else if (_verifiedBarangayNames.isNotEmpty) {
          _selectedBarangay = _verifiedBarangayNames.first;
        } else if (_verifiedBarangayNames.isEmpty) {
          _selectedBarangay = '';
        }
      });
    } catch (_) {
      // Keep the most recent verified list from the offline cache.
    }
  }

  String _normalizeBarangayName(dynamic value) {
    return (value?.toString() ?? '')
        .replaceFirst(
          RegExp(r'^(barangay|bdrrmc)\s+', caseSensitive: false),
          '',
        )
        .trim()
        .toLowerCase();
  }

  Future<void> _fetchBroadcasts() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _loadError = null;
      });
    }
    try {
      final response = await http
          .get(
            Uri.parse('${AppConstants.apiBaseUrl}/broadcasts'),
            headers: {'ngrok-skip-browser-warning': 'true'},
          )
          .timeout(const Duration(seconds: 12));

      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        final fetched = data.map((b) {
          final post = Map<String, dynamic>.from(b);
          post['category'] = _normalizeCategory(post['category']?.toString());
          return post;
        }).toList();
        if (mounted) setState(() => _posts = fetched);
      } else {
        throw Exception(
          'Failed to load public broadcasts (${response.statusCode}).',
        );
      }
    } catch (error) {
      // Keep already loaded server posts; never substitute sample alerts.
      debugPrint('Could not refresh public broadcasts: $error');
      if (mounted && _posts.isEmpty) {
        setState(
          () => _loadError =
              'Unable to load public alerts. Check your connection and pull to refresh.',
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _normalizeCategory(String? category) {
    switch (category) {
      case 'disaster_alert_yellow':
        return 'disaster_yellow';
      case 'disaster_alert_orange':
        return 'disaster_orange';
      case 'disaster_alert_red':
        return 'disaster_red';
      case 'all_clear_notice':
        return 'all_clear';
      default:
        return category ?? 'safety_advisory';
    }
  }

  bool _matchesCategory(String postCategory, String tabId) {
    if (tabId == 'all') return true;
    if (tabId == 'all_disaster') return postCategory.startsWith('disaster_');
    return postCategory == tabId;
  }

  String? _postPinKey(Map<String, dynamic> post) {
    final id = post['id']?.toString();
    if (id == null || id.isEmpty) return null;
    final source = post['is_mdrrmo'] == false ? 'barangay' : 'mdrrmo';
    return '$source:$id';
  }

  Future<void> _setResidentPinned(
    Map<String, dynamic> post,
    bool isPinned,
  ) async {
    final key = _postPinKey(post);
    if (key == null) return;

    final updated = Set<String>.from(_residentPinnedBroadcastIds);
    if (isPinned) {
      updated.add(key);
    } else {
      updated.remove(key);
    }

    try {
      await OfflineService.savePinnedBroadcastIds(updated);
      if (!mounted) return;
      setState(() => _residentPinnedBroadcastIds = updated);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            isPinned ? 'Added to Pinned.' : 'Your pin was removed.',
          ),
          duration: const Duration(seconds: 2),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not update pinned posts: $error')),
      );
    }
  }

  List<Map<String, dynamic>> _filteredPosts() {
    return _posts.where((p) {
      final key = _postPinKey(p);
      final isPinned =
          p['is_pinned'] == true ||
          (key != null && _residentPinnedBroadcastIds.contains(key));
      final isMdrrmo = p['is_mdrrmo'] != false;
      if (!isMdrrmo &&
          !_verifiedBarangayNames.any(
            (name) =>
                _normalizeBarangayName(name) ==
                _normalizeBarangayName(p['barangay_name']),
          )) {
        return false;
      }

      // 1. Source filter: 'barangay' vs 'mdrrmo' vs 'pinned'
      if (_selectedSource == 'pinned') {
        // The personal pin view includes both sources and ignores the current
        // barangay selection. Category filters can still narrow the results.
        if (!isPinned) return false;
      } else if (_selectedSource == 'barangay') {
        // Show only posts from the selected Barangay, never MDRRMO posts.
        if (isMdrrmo ||
            _normalizeBarangayName(p['barangay_name']) !=
                _normalizeBarangayName(_selectedBarangay)) {
          return false;
        }
      } else if (_selectedSource == 'mdrrmo') {
        // MDRRMO tab: Only MDRRMO posts (pinned or not), never Barangay
        if (!isMdrrmo) return false;
      } else if (_selectedSource == 'all' &&
          !isMdrrmo &&
          _normalizeBarangayName(p['barangay_name']) !=
              _normalizeBarangayName(_selectedBarangay)) {
        // All combines town-wide MDRRMO alerts with the selected Barangay.
        return false;
      }

      // 2. Category filter
      final cat = p['category']?.toString() ?? 'safety_advisory';
      return _matchesCategory(cat, _selectedCategory);
    }).toList();
  }

  Future<void> _launchLink(String urlString) async {
    final Uri url = Uri.parse(urlString);
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
      debugPrint('Could not open $urlString');
    }
  }

  // ── Bottom Sheet for Categories (when img 2 button is pressed) ──────────────
  void _openCategoryFilterSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _CategoryFilterModal(
        categories: _categories,
        selectedCategory: _selectedCategory,
        onSelect: (catId) {
          setState(() => _selectedCategory = catId);
          Navigator.pop(ctx);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredPosts();
    final residentBarangay = _selectedBarangay;

    final activeCategoryObj = _categories.firstWhere(
      (c) => c['id'] == _selectedCategory,
      orElse: () => _categories.first,
    );

    return Scaffold(
      backgroundColor: const Color(0xFFF1F5F9),
      // ── Floating Action Button matching img 2 ──────────────────────────────
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 6.0),
        child: SizedBox(
          width: 54,
          height: 54,
          child: Material(
            color: const Color(0xFF2563EB), // Vibrant blue matching img 2
            borderRadius: BorderRadius.circular(16), // Squircle matching img 2
            elevation: 4,
            shadowColor: const Color(0xFF2563EB).withValues(alpha: 0.4),
            child: InkWell(
              onTap: _openCategoryFilterSheet,
              borderRadius: BorderRadius.circular(16),
              child: const Center(
                child: Icon(
                  Icons.format_list_bulleted_rounded,
                  color: Colors.white,
                  size: 28,
                ),
              ),
            ),
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            // ── Top Header Section (Replacing plain color from img 3) ────────
            _buildVibrantHeader(residentBarangay),

            // ── Active Category Indicator (if not 'all') ─────────────────────
            if (_selectedCategory != 'all')
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                color: (activeCategoryObj['color'] as Color).withValues(
                  alpha: 0.1,
                ),
                child: Row(
                  children: [
                    Icon(
                      activeCategoryObj['icon'] as IconData,
                      size: 16,
                      color: activeCategoryObj['color'] as Color,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Filtered by: ${activeCategoryObj['label']}',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.bold,
                          color: activeCategoryObj['color'] as Color,
                        ),
                      ),
                    ),
                    InkWell(
                      onTap: () => setState(() => _selectedCategory = 'all'),
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: (activeCategoryObj['color'] as Color)
                                .withValues(alpha: 0.4),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'Clear',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: activeCategoryObj['color'] as Color,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Icon(
                              Icons.close,
                              size: 12,
                              color: activeCategoryObj['color'] as Color,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            // ── Feed Post List ───────────────────────────────────────────────
            Expanded(
              child: RefreshIndicator(
                onRefresh: _fetchBroadcasts,
                color: const Color(0xFF2563EB),
                child: filtered.isEmpty
                    ? ListView(
                        padding: const EdgeInsets.only(top: 80),
                        children: [
                          Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  _loadError != null
                                      ? Icons.cloud_off_rounded
                                      : _selectedSource == 'pinned'
                                      ? Icons.push_pin_outlined
                                      : Icons.inbox_outlined,
                                  size: 54,
                                  color: Colors.grey.shade400,
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  _loadError != null
                                      ? 'Unable to load public alerts'
                                      : _selectedSource == 'pinned'
                                      ? 'No pinned broadcasts'
                                      : 'No posts found for this view',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.grey.shade700,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  _loadError != null
                                      ? _loadError!
                                      : _selectedSource == 'pinned'
                                      ? 'Broadcasts you pin from any verified Barangay or MDRRMO will be listed here.'
                                      : 'Try switching tabs or tapping the blue list button to change category.',
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    color: Colors.grey.shade500,
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                                if (_loadError != null) ...[
                                  const SizedBox(height: 14),
                                  TextButton.icon(
                                    onPressed: _isLoading
                                        ? null
                                        : _fetchBroadcasts,
                                    icon: const Icon(Icons.refresh_rounded),
                                    label: const Text('Try Again'),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(14, 14, 14, 80),
                        itemCount: filtered.length,
                        itemBuilder: (context, index) {
                          return _BroadcastCard(
                            post: filtered[index],
                            onOpenLink: _launchLink,
                            isResidentPinned: _residentPinnedBroadcastIds
                                .contains(_postPinKey(filtered[index])),
                            onResidentPinChanged: (isPinned) =>
                                _setResidentPinned(filtered[index], isPinned),
                          );
                        },
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Vibrant Modern Header (Replaces plain dull color from img 3) ────────────
  Widget _buildVibrantHeader(String residentBarangay) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF0C243B), // Deep midnight blue
            Color(0xFF133E68), // Rich sapphire navy
            Color(0xFF0F5B78), // Modern ocean teal accent
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0C243B).withValues(alpha: 0.35),
            blurRadius: 16,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
          child: Column(
            children: [
              // Top Title Bar
              Row(
                children: [
                  Image.asset(
                    'assets/NA-icon.png',
                    width: 60,
                    height: 60,
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) => const Icon(
                      Icons.shield_rounded,
                      color: Colors.white,
                      size: 32,
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Norz-Agapay',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.3,
                          ),
                        ),
                        Text(
                          'MDRRMO & Barangay Feed',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Refresh Action Button
                  IconButton(
                    onPressed: _refreshHeader,
                    icon: _isLoading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(
                            Icons.refresh_rounded,
                            color: Colors.white,
                          ),
                    tooltip: 'Refresh feed and location',
                  ),
                ],
              ),
              const SizedBox(height: 14),

              // Segmented Tabs: [All] | [Barangay name] | [MDRRMO] | [ 📌 ]
              Container(
                height: 48,
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.22),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.12),
                  ),
                ),
                child: Row(
                  children: [
                    // Separate dropdown control, placed immediately left of the Barangay tab.
                    Padding(
                      padding: const EdgeInsets.only(left: 4, right: 3),
                      child: PopupMenuButton<String>(
                        tooltip: 'Choose barangay',
                        onSelected: (name) =>
                            setState(() => _selectedBarangay = name),
                        itemBuilder: (context) => _verifiedBarangayNames
                            .map(
                              (name) => PopupMenuItem<String>(
                                value: name,
                                child: Text(barangayDisplayLabel(name)),
                              ),
                            )
                            .toList(),
                        child: Container(
                          width: 38,
                          height: 38,
                          decoration: BoxDecoration(
                            color: const Color(0xFF1B4F72),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: const Color(0xFF38BDF8),
                              width: 1.5,
                            ),
                          ),
                          alignment: Alignment.center,
                          child: const Icon(
                            Icons.keyboard_arrow_down_rounded,
                            color: Colors.white,
                            size: 25,
                          ),
                        ),
                      ),
                    ),

                    Expanded(
                      flex: 2,
                      child: InkWell(
                        onTap: () => setState(() => _selectedSource = 'all'),
                        borderRadius: BorderRadius.circular(8),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          height: 42,
                          decoration: BoxDecoration(
                            color: _selectedSource == 'all'
                                ? const Color(
                                    0xFF0284C7,
                                  ).withValues(alpha: 0.28)
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(8),
                            border: _selectedSource == 'all'
                                ? Border.all(
                                    color: const Color(0xFF38BDF8),
                                    width: 2,
                                  )
                                : null,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            'All',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontWeight: _selectedSource == 'all'
                                  ? FontWeight.w900
                                  : FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ),

                    // Barangay tab still switches to the selected barangay feed.
                    Expanded(
                      flex: 5,
                      child: Container(
                        height: 42,
                        margin: const EdgeInsets.only(left: 4),
                        padding: const EdgeInsets.only(left: 10, right: 6),
                        decoration: BoxDecoration(
                          color: _selectedSource == 'barangay'
                              ? const Color(0xFF0284C7).withValues(alpha: 0.28)
                              : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          border: _selectedSource == 'barangay'
                              ? Border.all(
                                  color: const Color(0xFF38BDF8),
                                  width: 2,
                                )
                              : null,
                        ),
                        child: InkWell(
                          onTap: () =>
                              setState(() => _selectedSource = 'barangay'),
                          borderRadius: BorderRadius.circular(8),
                          child: Align(
                            alignment: Alignment.center,
                            child: Text(
                              residentBarangay.isEmpty
                                  ? 'No verified barangay'
                                  : barangayDisplayLabel(residentBarangay),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 14.5,
                                fontWeight: _selectedSource == 'barangay'
                                    ? FontWeight.w900
                                    : FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),

                    // Tab 2: MDRRMO
                    Expanded(
                      flex: 4,
                      child: InkWell(
                        onTap: () => setState(() => _selectedSource = 'mdrrmo'),
                        borderRadius: BorderRadius.circular(8),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          decoration: BoxDecoration(
                            color: _selectedSource == 'mdrrmo'
                                ? const Color(
                                    0xFF0284C7,
                                  ).withValues(alpha: 0.28)
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(8),
                            border: _selectedSource == 'mdrrmo'
                                ? Border.all(
                                    color: const Color(
                                      0xFF38BDF8,
                                    ), // Glowing cyan border matching img 3
                                    width: 2,
                                  )
                                : null,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            'MDRRMO',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 14.5,
                              fontWeight: _selectedSource == 'mdrrmo'
                                  ? FontWeight.w900
                                  : FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ),

                    // Tab 3: Pin button at the very right (matching img 2)
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 4,
                      ),
                      child: InkWell(
                        onTap: () => setState(() {
                          _selectedSource = 'pinned';
                          _selectedCategory = 'all';
                        }),
                        borderRadius: BorderRadius.circular(20),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          width: 38,
                          height: 38,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: _selectedSource == 'pinned'
                                ? const Color(0xFF38BDF8)
                                : const Color(0xFFE2E8F0),
                            border: Border.all(
                              color: _selectedSource == 'pinned'
                                  ? Colors.white
                                  : const Color(0xFF94A3B8),
                              width: _selectedSource == 'pinned' ? 2 : 1,
                            ),
                            boxShadow: _selectedSource == 'pinned'
                                ? [
                                    BoxShadow(
                                      color: const Color(
                                        0xFF38BDF8,
                                      ).withValues(alpha: 0.6),
                                      blurRadius: 8,
                                    ),
                                  ]
                                : null,
                          ),
                          alignment: Alignment.center,
                          child: Icon(
                            Icons.push_pin_rounded,
                            size: 20,
                            color: _selectedSource == 'pinned'
                                ? const Color(0xFF0F2B48)
                                : const Color(0xFF334155),
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
      ),
    );
  }

  Future<void> _refreshHeader() async {
    final locationRefresh = widget.onRefreshLocation?.call();
    final refreshes = <Future<void>>[_fetchBroadcasts()];
    if (locationRefresh != null) refreshes.add(locationRefresh);
    await Future.wait(refreshes);
  }
}

// ── Category Filter Bottom Sheet (Triggered by img 2 button) ────────────────
class _CategoryFilterModal extends StatelessWidget {
  final List<Map<String, dynamic>> categories;
  final String selectedCategory;
  final ValueChanged<String> onSelect;

  const _CategoryFilterModal({
    required this.categories,
    required this.selectedCategory,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Handle bar
            Center(
              child: Container(
                width: 44,
                height: 5,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2563EB).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.format_list_bulleted_rounded,
                    color: Color(0xFF2563EB),
                    size: 22,
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
                          fontSize: 11.5,
                          color: Color(0xFF64748B),
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, color: Colors.grey),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 10),

            // Category List with Rich Colors
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.of(context).size.height * 0.55,
              ),
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: categories.length,
                itemBuilder: (ctx, idx) {
                  final cat = categories[idx];
                  final isSelected = selectedCategory == cat['id'];
                  final Color color = cat['color'] as Color;
                  final Color bg = cat['bg'] as Color;
                  final Color border = cat['border'] as Color;

                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8.0),
                    child: Material(
                      color: isSelected ? bg : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                      child: InkWell(
                        onTap: () => onSelect(cat['id'] as String),
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 11,
                          ),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: isSelected
                                  ? color
                                  : border.withValues(alpha: 0.5),
                              width: isSelected ? 1.8 : 1,
                            ),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 34,
                                height: 34,
                                decoration: BoxDecoration(
                                  color: color.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(
                                  cat['icon'] as IconData,
                                  color: color,
                                  size: 18,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      cat['label'] as String,
                                      style: TextStyle(
                                        fontSize: 13.5,
                                        fontWeight: FontWeight.bold,
                                        color: isSelected
                                            ? color
                                            : const Color(0xFF1E293B),
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      cat['description'] as String,
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: Colors.grey.shade600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (isSelected)
                                Icon(
                                  Icons.check_circle_rounded,
                                  color: color,
                                  size: 20,
                                )
                              else
                                Icon(
                                  Icons.chevron_right_rounded,
                                  color: Colors.grey.shade400,
                                  size: 18,
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
          ],
        ),
      ),
    );
  }
}

// ── Broadcast Post Card Widget (Matching img 1) ──────────────────────────────
class _BroadcastCard extends StatelessWidget {
  final Map<String, dynamic> post;
  final Function(String) onOpenLink;
  final bool isResidentPinned;
  final ValueChanged<bool> onResidentPinChanged;

  const _BroadcastCard({
    required this.post,
    required this.onOpenLink,
    required this.isResidentPinned,
    required this.onResidentPinChanged,
  });

  Map<String, dynamic> _getCategoryConfig(String category) {
    switch (category) {
      case 'disaster_red':
        return {
          'label': 'Disaster Alert · Red',
          'color': const Color(0xFFEF4444),
          'bg': const Color(0xFFFEF2F2),
          'border': const Color(0xFFFCA5A5),
          'icon': Icons.local_fire_department_rounded,
        };
      case 'disaster_orange':
        return {
          'label': 'Disaster Alert · Orange',
          'color': const Color(0xFFF97316),
          'bg': const Color(0xFFFFF7ED),
          'border': const Color(0xFFFDBA74),
          'icon': Icons.warning_amber_rounded,
        };
      case 'disaster_yellow':
        return {
          'label': 'Disaster Alert · Yellow',
          'color': const Color(0xFFD97706),
          'bg': const Color(0xFFFFFBEB),
          'border': const Color(0xFFFDE68A),
          'icon': Icons.warning_amber_rounded,
        };
      case 'safety_advisory':
        return {
          'label': 'Safety Advisory',
          'color': const Color(0xFF0D9488),
          'bg': const Color(0xFFF0FDFA),
          'border': const Color(0xFF99F6E4),
          'icon': Icons.security_rounded,
        };
      case 'relief_assistance':
        return {
          'label': 'Relief & Assistance',
          'color': const Color(0xFF16A34A),
          'bg': const Color(0xFFF0FDF4),
          'border': const Color(0xFFBBF7D0),
          'icon': Icons.volunteer_activism_rounded,
        };
      case 'all_clear':
        return {
          'label': 'All-Clear Notice',
          'color': const Color(0xFF2563EB),
          'bg': const Color(0xFFEFF6FF),
          'border': const Color(0xFFBFDBFE),
          'icon': Icons.check_circle_rounded,
        };
      default:
        return {
          'label': 'Official Broadcast',
          'color': const Color(0xFF475569),
          'bg': const Color(0xFFF8FAFC),
          'border': const Color(0xFFCBD5E1),
          'icon': Icons.campaign_rounded,
        };
    }
  }

  @override
  Widget build(BuildContext context) {
    final isPinned = post['is_pinned'] == true || isResidentPinned;
    final isMdrrmo = post['is_mdrrmo'] != false;
    // author_name unused in header (source shown as entity origin only)
    final barangay =
        post['barangay_name'] ??
        (isMdrrmo ? 'Municipality of Norzagaray' : 'Barangay');
    final category = post['category']?.toString() ?? 'safety_advisory';
    final cfg = _getCategoryConfig(category);
    final content = post['content']?.toString() ?? '';
    final media = post['media'] as List<dynamic>? ?? [];
    final links = post['links'] as List<dynamic>? ?? [];
    final timeStr = post['time_ago']?.toString() ?? 'Just now';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: isPinned ? const Color(0xFFF59E0B) : const Color(0xFFE2E8F0),
          width: isPinned ? 2 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: isPinned
                ? const Color(0xFFF59E0B).withValues(alpha: 0.15)
                : Colors.black.withValues(alpha: 0.04),
            blurRadius: isPinned ? 12 : 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Pinned Banner (just "PINNED") ──────────────────────────────
          if (isPinned)
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

          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── Source and time on the left, menu and notice pill on the right ──
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  isMdrrmo
                                      ? 'MDRRMO Norzagaray'
                                      : (barangay.toLowerCase().startsWith(
                                              'barangay',
                                            )
                                            ? barangay
                                            : 'Barangay $barangay'),
                                  style: const TextStyle(
                                    fontSize: 15.5,
                                    fontWeight: FontWeight.bold,
                                    color: Color(0xFF0F172A),
                                  ),
                                  overflow: TextOverflow.ellipsis,
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
                        ),
                        PopupMenuButton<bool>(
                          tooltip: 'Post options',
                          padding: EdgeInsets.zero,
                          icon: const Icon(
                            Icons.more_vert_rounded,
                            color: Color(0xFF64748B),
                          ),
                          onSelected: onResidentPinChanged,
                          itemBuilder: (_) => [
                            PopupMenuItem<bool>(
                              value: !isResidentPinned,
                              child: Row(
                                children: [
                                  Icon(
                                    isResidentPinned
                                        ? Icons.push_pin_outlined
                                        : Icons.push_pin_rounded,
                                    size: 18,
                                  ),
                                  const SizedBox(width: 10),
                                  Text(
                                    isResidentPinned
                                        ? 'Remove my pin'
                                        : 'Pin this post',
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            timeStr,
                            style: TextStyle(
                              fontSize: 11.5,
                              color: Colors.grey.shade600,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: cfg['bg'] as Color,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: cfg['border'] as Color),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                cfg['icon'] as IconData,
                                size: 12,
                                color: cfg['color'] as Color,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                cfg['label'] as String,
                                style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.bold,
                                  color: cfg['color'] as Color,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // ── Post Content ─────────────────────────────────────────────
                Text(
                  content,
                  style: const TextStyle(
                    fontSize: 13.5,
                    color: Color(0xFF1E293B),
                    height: 1.45,
                  ),
                ),

                // ── Attached Media Grid (matching img 2 multi-image layouts) ─
                if (media.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _PostImageGrid(
                    media: media,
                    onOpenImage: (url) => _showImagePreviewDialog(context, url),
                  ),
                ],

                // ── Links (matching img 1 link pills) ───────────────────────
                if (links.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: links.map((link) {
                      final url = link.toString();
                      return InkWell(
                        onTap: () => onOpenLink(url),
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFFCBD5E1)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons.link_rounded,
                                size: 14,
                                color: Color(0xFF1B4F72),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                url.replaceFirst(RegExp(r'https?://'), ''),
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1B4F72),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }).toList(),
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

// ── Multi-Image Dynamic Grid Widget (Exact layout matching img 2) ───────────
class _PostImageGrid extends StatelessWidget {
  final List<dynamic> media;
  final Function(String) onOpenImage;

  const _PostImageGrid({required this.media, required this.onOpenImage});

  Widget _buildTile(String url, {String? overlayText}) {
    return Expanded(
      child: GestureDetector(
        onTap: () => onOpenImage(url),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.network(
              url,
              fit: BoxFit.cover,
              errorBuilder: (_, e, stack) => Container(
                color: const Color(0xFFE2E8F0),
                child: const Center(
                  child: Icon(
                    Icons.image_not_supported_rounded,
                    color: Colors.grey,
                    size: 22,
                  ),
                ),
              ),
            ),
            if (overlayText != null)
              Container(
                color: Colors.black.withValues(alpha: 0.55),
                alignment: Alignment.center,
                child: Text(
                  overlayText,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 22,
                    letterSpacing: 1,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final urls = media
        .map((m) => m is Map ? (m['url'] ?? '') : m.toString())
        .where((u) => u.isNotEmpty)
        .toList();

    if (urls.isEmpty) return const SizedBox.shrink();

    final count = urls.length;
    const double gap = 4.0;

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Builder(
        builder: (_) {
          // 1 Image: One Square
          if (count == 1) {
            return SizedBox(
              width: double.infinity,
              height: 210,
              child: GestureDetector(
                onTap: () => onOpenImage(urls[0]),
                child: Image.network(
                  urls[0],
                  fit: BoxFit.cover,
                  width: double.infinity,
                  height: double.infinity,
                  errorBuilder: (_, e, stack) => Container(
                    color: const Color(0xFFE2E8F0),
                    child: const Center(
                      child: Icon(
                        Icons.image_not_supported_rounded,
                        color: Colors.grey,
                      ),
                    ),
                  ),
                ),
              ),
            );
          }

          // 2 Images: Two Squares side-by-side
          if (count == 2) {
            return SizedBox(
              width: double.infinity,
              height: 180,
              child: Row(
                children: [
                  _buildTile(urls[0]),
                  const SizedBox(width: gap),
                  _buildTile(urls[1]),
                ],
              ),
            );
          }

          // 3 Images: Three Squares (Top 1 full-width, Bottom 2 side-by-side)
          if (count == 3) {
            return SizedBox(
              width: double.infinity,
              height: 250,
              child: Column(
                children: [
                  Expanded(
                    flex: 14,
                    child: Row(children: [_buildTile(urls[0])]),
                  ),
                  const SizedBox(height: gap),
                  Expanded(
                    flex: 11,
                    child: Row(
                      children: [
                        _buildTile(urls[1]),
                        const SizedBox(width: gap),
                        _buildTile(urls[2]),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }

          // 4 Images: Four Squares (2x2 grid)
          if (count == 4) {
            return SizedBox(
              width: double.infinity,
              height: 240,
              child: Column(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        _buildTile(urls[0]),
                        const SizedBox(width: gap),
                        _buildTile(urls[1]),
                      ],
                    ),
                  ),
                  const SizedBox(height: gap),
                  Expanded(
                    child: Row(
                      children: [
                        _buildTile(urls[2]),
                        const SizedBox(width: gap),
                        _buildTile(urls[3]),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }

          // 5 Images: Five Squares (Top 2 side-by-side, Bottom 3 side-by-side)
          if (count == 5) {
            return SizedBox(
              width: double.infinity,
              height: 250,
              child: Column(
                children: [
                  Expanded(
                    flex: 13,
                    child: Row(
                      children: [
                        _buildTile(urls[0]),
                        const SizedBox(width: gap),
                        _buildTile(urls[1]),
                      ],
                    ),
                  ),
                  const SizedBox(height: gap),
                  Expanded(
                    flex: 11,
                    child: Row(
                      children: [
                        _buildTile(urls[2]),
                        const SizedBox(width: gap),
                        _buildTile(urls[3]),
                        const SizedBox(width: gap),
                        _buildTile(urls[4]),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }

          // 6 or more Images: Six Squares (Top 2, Bottom 3 with +N overlay)
          return SizedBox(
            width: double.infinity,
            height: 250,
            child: Column(
              children: [
                Expanded(
                  flex: 13,
                  child: Row(
                    children: [
                      _buildTile(urls[0]),
                      const SizedBox(width: gap),
                      _buildTile(urls[1]),
                    ],
                  ),
                ),
                const SizedBox(height: gap),
                Expanded(
                  flex: 11,
                  child: Row(
                    children: [
                      _buildTile(urls[2]),
                      const SizedBox(width: gap),
                      _buildTile(urls[3]),
                      const SizedBox(width: gap),
                      _buildTile(urls[4], overlayText: '+${count - 5}'),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ── Photo Viewer Dialog ─────────────────────────────────────────────────────
void _showImagePreviewDialog(BuildContext context, String imageUrl) {
  showDialog(
    context: context,
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(12),
      child: Stack(
        alignment: Alignment.topRight,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: InteractiveViewer(
              child: Image.network(
                imageUrl,
                fit: BoxFit.contain,
                errorBuilder: (_, e, stack) => Container(
                  height: 250,
                  color: Colors.black54,
                  child: const Center(
                    child: Icon(
                      Icons.image_not_supported_rounded,
                      color: Colors.white70,
                      size: 40,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            top: 8,
            right: 8,
            child: CircleAvatar(
              backgroundColor: Colors.black54,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.pop(ctx),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
