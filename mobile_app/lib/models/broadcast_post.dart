import 'package:flutter/material.dart';

enum BroadcastCategory {
  disasterAlertYellow,
  disasterAlertOrange,
  disasterAlertRed,
  safetyAdvisory,
  reliefAssistance,
  allClearNotice,
}

extension BroadcastCategoryExt on BroadcastCategory {
  String get label {
    switch (this) {
      case BroadcastCategory.disasterAlertYellow:
        return 'Disaster Alert';
      case BroadcastCategory.disasterAlertOrange:
        return 'Disaster Alert';
      case BroadcastCategory.disasterAlertRed:
        return 'Disaster Alert';
      case BroadcastCategory.safetyAdvisory:
        return 'Safety Advisory';
      case BroadcastCategory.reliefAssistance:
        return 'Relief and Assistance';
      case BroadcastCategory.allClearNotice:
        return 'All-Clear Notice';
    }
  }

  String get sublabel {
    switch (this) {
      case BroadcastCategory.disasterAlertYellow:
        return 'Yellow';
      case BroadcastCategory.disasterAlertOrange:
        return 'Orange';
      case BroadcastCategory.disasterAlertRed:
        return 'Red';
      default:
        return '';
    }
  }

  Color get pillColor {
    switch (this) {
      case BroadcastCategory.disasterAlertYellow:
        return const Color(0xFFFACC15);
      case BroadcastCategory.disasterAlertOrange:
        return const Color(0xFFF97316);
      case BroadcastCategory.disasterAlertRed:
        return const Color(0xFFEF4444);
      case BroadcastCategory.safetyAdvisory:
        return const Color(0xFF14B8A6);
      case BroadcastCategory.reliefAssistance:
        return const Color(0xFF22C55E);
      case BroadcastCategory.allClearNotice:
        return const Color(0xFF3B82F6);
    }
  }

  String get apiValue {
    switch (this) {
      case BroadcastCategory.disasterAlertYellow:
        return 'disaster_alert_yellow';
      case BroadcastCategory.disasterAlertOrange:
        return 'disaster_alert_orange';
      case BroadcastCategory.disasterAlertRed:
        return 'disaster_alert_red';
      case BroadcastCategory.safetyAdvisory:
        return 'safety_advisory';
      case BroadcastCategory.reliefAssistance:
        return 'relief_assistance';
      case BroadcastCategory.allClearNotice:
        return 'all_clear_notice';
    }
  }

  static BroadcastCategory fromApiValue(String value) {
    switch (value) {
      case 'disaster_alert_yellow':
      case 'disaster_yellow':
        return BroadcastCategory.disasterAlertYellow;
      case 'disaster_alert_orange':
      case 'disaster_orange':
        return BroadcastCategory.disasterAlertOrange;
      case 'disaster_alert_red':
      case 'disaster_red':
        return BroadcastCategory.disasterAlertRed;
      case 'safety_advisory':
        return BroadcastCategory.safetyAdvisory;
      case 'relief_assistance':
        return BroadcastCategory.reliefAssistance;
      case 'all_clear_notice':
      case 'all_clear':
        return BroadcastCategory.allClearNotice;
      default:
        return BroadcastCategory.safetyAdvisory;
    }
  }
}

class BroadcastMediaItem {
  final String url;
  final bool isVideo;

  const BroadcastMediaItem({required this.url, required this.isVideo});

  factory BroadcastMediaItem.fromJson(Map<String, dynamic> json) {
    return BroadcastMediaItem(
      url: json['url'] as String? ?? '',
      isVideo: (json['type'] as String? ?? 'image') == 'video',
    );
  }

  Map<String, dynamic> toJson() => {
        'url': url,
        'type': isVideo ? 'video' : 'image',
      };
}

class BroadcastPost {
  final String id;
  final String barangayId;
  final String barangayName;
  final String authorId;
  final String authorName;
  final BroadcastCategory category;
  final String content;
  final List<String> links;
  final List<BroadcastMediaItem> media;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final bool isFromMdrrmo;
  final bool isPinned;
  final String? repostedBy;

  const BroadcastPost({
    required this.id,
    required this.barangayId,
    required this.barangayName,
    required this.authorId,
    required this.authorName,
    required this.category,
    required this.content,
    required this.links,
    required this.media,
    required this.createdAt,
    this.updatedAt,
    this.isFromMdrrmo = false,
    this.isPinned = false,
    this.repostedBy,
  });

  factory BroadcastPost.fromJson(Map<String, dynamic> json) {
    final mediaRaw = json['media'] as List<dynamic>? ?? [];
    final linksRaw = json['links'] as List<dynamic>? ?? [];

    return BroadcastPost(
      id: json['_id'] as String? ?? json['id'] as String? ?? '',
      barangayId: json['barangay_id'] as String? ?? '',
      barangayName: json['barangay_name'] as String? ?? 'Barangay',
      authorId: json['author_id'] as String? ?? '',
      authorName: json['author_name'] as String? ?? 'Barangay Officer',
      category: BroadcastCategoryExt.fromApiValue(
        json['category'] as String? ?? 'safety_advisory',
      ),
      content: json['content'] as String? ?? '',
      links: linksRaw.map((e) => e.toString()).toList(),
      media: mediaRaw
          .map((e) => BroadcastMediaItem.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ??
          DateTime.now(),
      updatedAt: json['updated_at'] != null
          ? DateTime.tryParse(json['updated_at'] as String)
          : null,
      isFromMdrrmo: json['is_from_mdrrmo'] == true ||
          json['author_name']?.toString().toUpperCase().contains('MDRRMO') == true,
      isPinned: json['is_pinned'] == true,
      repostedBy: json['reposted_by'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'barangay_id': barangayId,
        'barangay_name': barangayName,
        'author_id': authorId,
        'author_name': authorName,
        'category': category.apiValue,
        'content': content,
        'links': links,
        'media': media.map((m) => m.toJson()).toList(),
        'created_at': createdAt.toIso8601String(),
        'updated_at': updatedAt?.toIso8601String(),
        'is_from_mdrrmo': isFromMdrrmo,
        'is_pinned': isPinned,
        'reposted_by': repostedBy,
      };

  BroadcastPost copyWith({
    String? id,
    String? barangayId,
    String? barangayName,
    String? authorId,
    String? authorName,
    BroadcastCategory? category,
    String? content,
    List<String>? links,
    List<BroadcastMediaItem>? media,
    DateTime? createdAt,
    DateTime? updatedAt,
    bool? isFromMdrrmo,
    bool? isPinned,
    String? repostedBy,
  }) {
    return BroadcastPost(
      id: id ?? this.id,
      barangayId: barangayId ?? this.barangayId,
      barangayName: barangayName ?? this.barangayName,
      authorId: authorId ?? this.authorId,
      authorName: authorName ?? this.authorName,
      category: category ?? this.category,
      content: content ?? this.content,
      links: links ?? this.links,
      media: media ?? this.media,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isFromMdrrmo: isFromMdrrmo ?? this.isFromMdrrmo,
      isPinned: isPinned ?? this.isPinned,
      repostedBy: repostedBy ?? this.repostedBy,
    );
  }
}
