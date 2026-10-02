import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import '../models/broadcast_post.dart';
import '../services/api_service.dart';

enum TopLevelCategory {
  disasterAlert,
  safetyAdvisory,
  reliefAssistance,
  allClearNotice,
}

enum DisasterAlertColor {
  yellow,
  orange,
  red,
}

class CreateBroadcastModal extends StatefulWidget {
  final String token;
  final String barangayId;
  final String barangayName;
  final String authorId;
  final String authorName;
  final BroadcastPost? existingPost; // non-null when editing

  const CreateBroadcastModal({
    super.key,
    required this.token,
    required this.barangayId,
    required this.barangayName,
    required this.authorId,
    required this.authorName,
    this.existingPost,
  });

  @override
  State<CreateBroadcastModal> createState() => _CreateBroadcastModalState();
}

class _CreateBroadcastModalState extends State<CreateBroadcastModal> {
  TopLevelCategory _selectedTopCategory = TopLevelCategory.disasterAlert;
  DisasterAlertColor _selectedDisasterColor = DisasterAlertColor.red;

  final _contentController = TextEditingController();
  final List<TextEditingController> _linkControllers = [];

  // Media
  final List<BroadcastMediaItem> _existingMedia = [];
  final List<XFile> _pickedMedia = [];

  bool _isPosting = false;

  bool get _isEditing => widget.existingPost != null;

  BroadcastCategory get _computedCategory {
    switch (_selectedTopCategory) {
      case TopLevelCategory.disasterAlert:
        switch (_selectedDisasterColor) {
          case DisasterAlertColor.yellow:
            return BroadcastCategory.disasterAlertYellow;
          case DisasterAlertColor.orange:
            return BroadcastCategory.disasterAlertOrange;
          case DisasterAlertColor.red:
            return BroadcastCategory.disasterAlertRed;
        }
      case TopLevelCategory.safetyAdvisory:
        return BroadcastCategory.safetyAdvisory;
      case TopLevelCategory.reliefAssistance:
        return BroadcastCategory.reliefAssistance;
      case TopLevelCategory.allClearNotice:
        return BroadcastCategory.allClearNotice;
    }
  }

  Color get _currentPillColor => _computedCategory.pillColor;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final p = widget.existingPost!;
      _contentController.text = p.content;

      // Map existing category to top-level + sub-color
      switch (p.category) {
        case BroadcastCategory.disasterAlertYellow:
          _selectedTopCategory = TopLevelCategory.disasterAlert;
          _selectedDisasterColor = DisasterAlertColor.yellow;
          break;
        case BroadcastCategory.disasterAlertOrange:
          _selectedTopCategory = TopLevelCategory.disasterAlert;
          _selectedDisasterColor = DisasterAlertColor.orange;
          break;
        case BroadcastCategory.disasterAlertRed:
          _selectedTopCategory = TopLevelCategory.disasterAlert;
          _selectedDisasterColor = DisasterAlertColor.red;
          break;
        case BroadcastCategory.safetyAdvisory:
          _selectedTopCategory = TopLevelCategory.safetyAdvisory;
          break;
        case BroadcastCategory.reliefAssistance:
          _selectedTopCategory = TopLevelCategory.reliefAssistance;
          break;
        case BroadcastCategory.allClearNotice:
          _selectedTopCategory = TopLevelCategory.allClearNotice;
          break;
      }

      for (final link in p.links) {
        _linkControllers.add(TextEditingController(text: link));
      }

      _existingMedia.addAll(p.media);
    }
  }

  @override
  void dispose() {
    _contentController.dispose();
    for (final c in _linkControllers) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickMedia() async {
    final picker = ImagePicker();
    final files = await picker.pickMultipleMedia();
    if (files.isNotEmpty) {
      setState(() => _pickedMedia.addAll(files));
    }
  }

  void _addLink() {
    setState(() => _linkControllers.add(TextEditingController()));
  }

  void _removeLink(int index) {
    setState(() {
      _linkControllers[index].dispose();
      _linkControllers.removeAt(index);
    });
  }

  void _removeExistingMedia(int index) {
    setState(() => _existingMedia.removeAt(index));
  }

  void _removePickedMedia(int index) {
    setState(() => _pickedMedia.removeAt(index));
  }

  Future<void> _submit() async {
    final content = _contentController.text.trim();
    if (content.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please add some details to the post')),
      );
      return;
    }

    setState(() => _isPosting = true);

    final links = _linkControllers
        .map((c) => c.text.trim())
        .where((l) => l.isNotEmpty)
        .toList();

    final category = _computedCategory;
    BroadcastPost? resultPost;

    try {
      if (_isEditing) {
        resultPost = await ApiService.updateBroadcast(
          widget.token,
          widget.existingPost!.id,
          category: category.apiValue,
          content: content,
          links: links,
          existingMedia: _existingMedia,
          newMediaFiles: _pickedMedia.isNotEmpty ? _pickedMedia : null,
        );
      } else {
        resultPost = await ApiService.createBroadcast(
          widget.token,
          category: category.apiValue,
          content: content,
          links: links,
          mediaFiles: _pickedMedia.isNotEmpty ? _pickedMedia : null,
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() => _isPosting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not save the post: $error'),
            backgroundColor: const Color(0xFFEF4444),
          ),
        );
      }
      return;
    }

    if (mounted) {
      Navigator.of(context).pop(resultPost);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final totalMediaCount = _existingMedia.length + _pickedMedia.length;

    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF1E293B),
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.fromLTRB(20, 16, 20, bottomInset + 24),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Drag handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFF475569),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _isEditing ? 'Edit Post' : 'Create Post',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: Color(0xFF94A3B8)),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // ── Top-Level Category ─────────────────────────────────────────
            const Text(
              'Select Category',
              style: TextStyle(
                color: Color(0xFF94A3B8),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            _buildTopLevelCategoryPicker(),

            // ── Disaster Alert Sub-Colors (Yellow / Orange / Red) ──────────
            if (_selectedTopCategory == TopLevelCategory.disasterAlert) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Disaster Alert Severity Level',
                      style: TextStyle(
                        color: Color(0xFF94A3B8),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: _buildSubColorChip(
                            color: const Color(0xFFFACC15),
                            label: 'Yellow',
                            isSelected: _selectedDisasterColor == DisasterAlertColor.yellow,
                            onTap: () => setState(() =>
                                _selectedDisasterColor = DisasterAlertColor.yellow),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _buildSubColorChip(
                            color: const Color(0xFFF97316),
                            label: 'Orange',
                            isSelected: _selectedDisasterColor == DisasterAlertColor.orange,
                            onTap: () => setState(() =>
                                _selectedDisasterColor = DisasterAlertColor.orange),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _buildSubColorChip(
                            color: const Color(0xFFEF4444),
                            label: 'Red',
                            isSelected: _selectedDisasterColor == DisasterAlertColor.red,
                            onTap: () => setState(() =>
                                _selectedDisasterColor = DisasterAlertColor.red),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 20),

            // ── Details ────────────────────────────────────────────────────
            const Text(
              'Details',
              style: TextStyle(
                color: Color(0xFF94A3B8),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                color: const Color(0xFF0F172A),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: TextField(
                controller: _contentController,
                maxLines: 5,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: const InputDecoration(
                  hintText: 'Write your alert, announcement, or disaster advisory details...',
                  hintStyle: TextStyle(color: Color(0xFF475569)),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.all(14),
                ),
              ),
            ),
            const SizedBox(height: 20),

            // ── Links ──────────────────────────────────────────────────────
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Add Links (Optional)',
                  style: TextStyle(
                    color: Color(0xFF94A3B8),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                GestureDetector(
                  onTap: _addLink,
                  child: const Row(
                    children: [
                      Icon(Icons.add_circle_outline,
                          color: Color(0xFF38BDF8), size: 18),
                      SizedBox(width: 4),
                      Text(
                        'Add Link',
                        style: TextStyle(
                          color: Color(0xFF38BDF8),
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ..._buildLinkFields(),

            // ── Media (Images / Videos) ────────────────────────────────────
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  totalMediaCount > 0
                      ? 'Photos / Videos ($totalMediaCount)'
                      : 'Photos / Videos (Optional)',
                  style: const TextStyle(
                    color: Color(0xFF94A3B8),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                GestureDetector(
                  onTap: _pickMedia,
                  child: const Row(
                    children: [
                      Icon(Icons.add_photo_alternate_outlined,
                          color: Color(0xFF38BDF8), size: 18),
                      SizedBox(width: 4),
                      Text(
                        'Add Media',
                        style: TextStyle(
                          color: Color(0xFF38BDF8),
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (totalMediaCount > 0) _buildAllMediaPreviews(),

            const SizedBox(height: 24),

            // ── Submit Button ──────────────────────────────────────────────
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _isPosting ? null : _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: _currentPillColor,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor:
                      _currentPillColor.withValues(alpha: 0.5),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: _isPosting
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child:
                            CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : Text(
                        _isEditing ? 'Save Changes' : 'Post Alert / Broadcast',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 16),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Top-Level Category Picker ───────────────────────────────────────────
  Widget _buildTopLevelCategoryPicker() {
    final options = [
      {'cat': TopLevelCategory.disasterAlert, 'label': 'Disaster Alert', 'color': _selectedTopCategory == TopLevelCategory.disasterAlert ? _currentPillColor : const Color(0xFFEF4444)},
      {'cat': TopLevelCategory.safetyAdvisory, 'label': 'Safety Advisory', 'color': const Color(0xFF14B8A6)},
      {'cat': TopLevelCategory.reliefAssistance, 'label': 'Relief and Assistance', 'color': const Color(0xFF22C55E)},
      {'cat': TopLevelCategory.allClearNotice, 'label': 'All-Clear Notice', 'color': const Color(0xFF3B82F6)},
    ];

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: options.map((opt) {
        final cat = opt['cat'] as TopLevelCategory;
        final label = opt['label'] as String;
        final color = opt['color'] as Color;
        final isSelected = _selectedTopCategory == cat;

        return GestureDetector(
          onTap: () => setState(() => _selectedTopCategory = cat),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: isSelected ? color.withValues(alpha: 0.18) : Colors.transparent,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isSelected ? color : const Color(0xFF475569),
                width: isSelected ? 1.6 : 1,
              ),
            ),
            child: Text(
              label,
              style: TextStyle(
                color: isSelected ? color : const Color(0xFF94A3B8),
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  // ── Disaster Sub-Color Chip ─────────────────────────────────────────────
  Widget _buildSubColorChip({
    required Color color,
    required String label,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? color.withValues(alpha: 0.22) : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isSelected ? color : const Color(0xFF334155),
            width: isSelected ? 1.8 : 1,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? color : const Color(0xFF94A3B8),
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Link fields ─────────────────────────────────────────────────────────
  List<Widget> _buildLinkFields() {
    if (_linkControllers.isEmpty) {
      return [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: const Text(
            'No links added yet. Click "+ Add Link" to attach websites or advisory resources.',
            style: TextStyle(color: Color(0xFF475569), fontSize: 12),
          ),
        ),
      ];
    }
    return List.generate(_linkControllers.length, (i) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: TextField(
                  controller: _linkControllers[i],
                  keyboardType: TextInputType.url,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: const InputDecoration(
                    hintText: 'https://...',
                    hintStyle: TextStyle(color: Color(0xFF475569)),
                    border: InputBorder.none,
                    prefixIcon: Icon(Icons.link,
                        color: Color(0xFF38BDF8), size: 18),
                    contentPadding:
                        EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: () => _removeLink(i),
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: const Icon(Icons.close,
                    color: Color(0xFFEF4444), size: 16),
              ),
            ),
          ],
        ),
      );
    });
  }

  // ── Media previews (both existing and newly added) ──────────────────────
  Widget _buildAllMediaPreviews() {
    return SizedBox(
      height: 90,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          // 1. Existing media from post
          ...List.generate(_existingMedia.length, (i) {
            final item = _existingMedia[i];
            final isLocal = File(item.url).existsSync();
            return Stack(
              children: [
                Container(
                  width: 80,
                  height: 80,
                  margin: const EdgeInsets.only(right: 8),
                  clipBehavior: Clip.hardEdge,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(10),
                    color: const Color(0xFF0F172A),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: isLocal
                      ? Image.file(File(item.url), fit: BoxFit.cover)
                      : Image.network(
                          item.url,
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) =>
                              const Center(
                            child: Icon(Icons.broken_image,
                                color: Color(0xFF64748B), size: 28),
                          ),
                        ),
                ),
                Positioned(
                  top: 2,
                  right: 10,
                  child: GestureDetector(
                    onTap: () => _removeExistingMedia(i),
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        color: Colors.black87,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.close,
                          color: Colors.white, size: 14),
                    ),
                  ),
                ),
              ],
            );
          }),

          // 2. Newly picked media files
          ...List.generate(_pickedMedia.length, (i) {
            return Stack(
              children: [
                Container(
                  width: 80,
                  height: 80,
                  margin: const EdgeInsets.only(right: 8),
                  clipBehavior: Clip.hardEdge,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(10),
                    color: const Color(0xFF0F172A),
                    border: Border.all(color: const Color(0xFF0284C7)),
                  ),
                  child: Image.file(
                    File(_pickedMedia[i].path),
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        const Center(
                      child: Icon(Icons.video_file,
                          color: Color(0xFF64748B), size: 28),
                    ),
                  ),
                ),
                Positioned(
                  top: 2,
                  right: 10,
                  child: GestureDetector(
                    onTap: () => _removePickedMedia(i),
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        color: Colors.black87,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.close,
                          color: Colors.white, size: 14),
                    ),
                  ),
                ),
              ],
            );
          }),
        ],
      ),
    );
  }
}
