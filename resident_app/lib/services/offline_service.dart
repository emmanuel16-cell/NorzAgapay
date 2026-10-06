import 'dart:io';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:path_provider/path_provider.dart';

class OfflineService {
  static const String reportBoxName = 'pending_reports';
  static const String draftBoxName = 'report_drafts';
  static const String profileBoxName = 'user_profile';
  static const String barangayBoxName = 'barangay_cache';
  static const String evacuationBoxName = 'evac_center_cache';
  static const String hotlineBoxName = 'barangay_hotline_cache';
  static const String evidenceUploadBoxName = 'pending_incident_evidence';

  static Future<void> init() async {
    await Hive.initFlutter();
    await Hive.openBox(reportBoxName);
    await Hive.openBox(draftBoxName);
    await Hive.openBox(profileBoxName);
    await Hive.openBox(barangayBoxName);
    await Hive.openBox(evacuationBoxName);
    await Hive.openBox(hotlineBoxName);
    await Hive.openBox(evidenceUploadBoxName);
  }

  // ── Onboarding State ────────────────────────────────────────────────────────

  static bool hasCompletedOnboarding() {
    final box = Hive.box(profileBoxName);
    return box.get('onboarding_completed', defaultValue: false) == true;
  }

  static bool getShowDemoData() =>
      Hive.box(profileBoxName).get('show_demo_data', defaultValue: false) ==
      true;

  static Future<void> setShowDemoData(bool enabled) async {
    await Hive.box(profileBoxName).put('show_demo_data', enabled);
  }

  static Future<void> setOnboardingCompleted(bool completed) async {
    final box = Hive.box(profileBoxName);
    await box.put('onboarding_completed', completed);
  }

  // ── Profile & Auth State ───────────────────────────────────────────────────

  static Future<void> saveProfile(Map<String, dynamic> profileData) async {
    final box = Hive.box(profileBoxName);
    final existing = getProfile() ?? {};
    await box.put('current_profile', {
      ...existing,
      ...profileData,
      'is_logged_in': profileData['is_logged_in'] ?? true,
      'updated_at': DateTime.now().toIso8601String(),
    });
  }

  static Map<String, dynamic>? getProfile() {
    final box = Hive.box(profileBoxName);
    final data = box.get('current_profile');
    return data != null ? Map<String, dynamic>.from(data) : null;
  }

  static const String _residentPinnedBroadcastsKey =
      'resident_pinned_broadcast_ids';

  static Set<String> getPinnedBroadcastIds() {
    final data = Hive.box(profileBoxName).get(_residentPinnedBroadcastsKey);
    if (data is! Iterable) return <String>{};
    return data.map((id) => id.toString()).where((id) => id.isNotEmpty).toSet();
  }

  static Future<void> savePinnedBroadcastIds(Iterable<String> ids) async {
    final normalized = ids.where((id) => id.isNotEmpty).toSet().toList();
    await Hive.box(
      profileBoxName,
    ).put(_residentPinnedBroadcastsKey, normalized);
  }

  static bool hasSeenReviewNotice(String reportId) {
    final seen = Hive.box(profileBoxName).get('seen_review_notice_ids');
    return seen is List &&
        seen.map((value) => value.toString()).contains(reportId);
  }

  static Future<void> markReviewNoticeSeen(String reportId) async {
    final box = Hive.box(profileBoxName);
    final seen = box.get('seen_review_notice_ids');
    final ids = seen is List
        ? seen.map((value) => value.toString()).toSet()
        : <String>{};
    ids.add(reportId);
    await box.put('seen_review_notice_ids', ids.toList());
  }

  static bool isLoggedIn() {
    final profile = getProfile();
    if (profile == null) return false;
    final loggedIn = profile['is_logged_in'];
    if (loggedIn is bool) return loggedIn;
    final contact = profile['contact_number'] as String?;
    return contact != null && contact.trim().isNotEmpty;
  }

  static Map<String, dynamic>? getMunicipalityBoundaryConfig() {
    final value = Hive.box(profileBoxName).get('municipality_boundary_config');
    return value is Map ? Map<String, dynamic>.from(value) : null;
  }

  static Future<void> saveMunicipalityBoundaryConfig(
    Map<String, dynamic> value,
  ) async {
    await Hive.box(profileBoxName).put('municipality_boundary_config', value);
  }

  static Future<void> logout() async {
    final box = Hive.box(profileBoxName);
    final profile = getProfile();
    if (profile != null) {
      profile['is_logged_in'] = false;
      await box.put('current_profile', profile);
    }
  }

  // ── Pending Reports ────────────────────────────────────────────────────────

  static Future<void> savePendingReport(Map<String, dynamic> reportData) async {
    final box = Hive.box(reportBoxName);
    final String timestamp = DateTime.now().millisecondsSinceEpoch.toString();
    await box.put(timestamp, reportData);
  }

  static List<Map<String, dynamic>> getPendingReports() {
    final box = Hive.box(reportBoxName);
    return box.values.map((e) => Map<String, dynamic>.from(e)).toList();
  }

  static Future<void> clearReport(String key) async {
    final box = Hive.box(reportBoxName);
    await box.delete(key);
  }

  static Future<void> savePendingEvidenceJob({
    required String reportId,
    required List<String> sourcePaths,
    required List<String> proofTypes,
    required String contactNumber,
  }) async {
    final documents = await getApplicationDocumentsDirectory();
    final evidenceDirectory = Directory(
      '${documents.path}/incident_evidence/$reportId',
    );
    await evidenceDirectory.create(recursive: true);
    final persistentPaths = <String>[];
    for (var index = 0; index < sourcePaths.length; index++) {
      final source = File(sourcePaths[index]);
      if (!await source.exists()) {
        persistentPaths.add('');
        continue;
      }
      final originalName = source.uri.pathSegments.isNotEmpty
          ? source.uri.pathSegments.last
          : 'proof_$index';
      final safeName = originalName.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
      final destination = File('${evidenceDirectory.path}/${index}_$safeName');
      if (source.absolute.path != destination.absolute.path &&
          !await destination.exists()) {
        await source.copy(destination.path);
      }
      if (await destination.exists()) persistentPaths.add(destination.path);
    }
    final box = Hive.box(evidenceUploadBoxName);
    await box.put(reportId, {
      'report_id': reportId,
      'proof_paths': persistentPaths,
      'proof_types': proofTypes,
      'contact_number': contactNumber,
      'saved_at': DateTime.now().toIso8601String(),
    });
  }

  static List<Map<String, dynamic>> getPendingEvidenceJobs() {
    return Hive.box(evidenceUploadBoxName).values
        .whereType<Map>()
        .map((job) => Map<String, dynamic>.from(job))
        .toList();
  }

  static Future<void> clearPendingEvidenceJob(String reportId) async {
    final box = Hive.box(evidenceUploadBoxName);
    final value = box.get(reportId);
    await box.delete(reportId);
    if (value is! Map || value['proof_paths'] is! List) return;
    Directory? evidenceDirectory;
    for (final item in value['proof_paths'] as List) {
      final path = item.toString();
      if (path.isEmpty) continue;
      final file = File(path);
      evidenceDirectory ??= file.parent;
      if (await file.exists()) await file.delete();
    }
    if (evidenceDirectory != null &&
        await evidenceDirectory.exists() &&
        await evidenceDirectory.list().isEmpty) {
      await evidenceDirectory.delete();
    }
  }

  // ── Report Drafts ─────────────────────────────────────────────────────────

  static Future<String> saveDraft(
    Map<String, dynamic> draft, {
    String? id,
  }) async {
    final box = Hive.box(draftBoxName);
    final key = id ?? DateTime.now().millisecondsSinceEpoch.toString();
    final savedDraft = Map<String, dynamic>.from(draft);
    final originalPaths =
        (savedDraft['proof_paths'] as List?)
            ?.map((e) => e.toString())
            .toList() ??
        [];
    if (originalPaths.isNotEmpty) {
      final documents = await getApplicationDocumentsDirectory();
      final mediaDirectory = Directory('${documents.path}/report_drafts/$key');
      await mediaDirectory.create(recursive: true);
      final persistentPaths = <String>[];
      for (var i = 0; i < originalPaths.length; i++) {
        final source = File(originalPaths[i]);
        if (!await source.exists()) continue;
        if (source.absolute.path.startsWith(
          '${mediaDirectory.absolute.path}${Platform.pathSeparator}',
        )) {
          persistentPaths.add(source.path);
          continue;
        }
        final name = source.uri.pathSegments.isNotEmpty
            ? source.uri.pathSegments.last
            : 'proof_$i';
        final destination = File('${mediaDirectory.path}/${i}_$name');
        if (source.absolute.path != destination.absolute.path)
          await source.copy(destination.path);
        persistentPaths.add(destination.path);
      }
      savedDraft['proof_paths'] = persistentPaths;
    }
    await box.put(key, {
      ...savedDraft,
      'draft_id': key,
      'saved_at': DateTime.now().toIso8601String(),
    });
    return key;
  }

  static List<Map<String, dynamic>> getDrafts() {
    final box = Hive.box(draftBoxName);
    return box.values.map((value) => Map<String, dynamic>.from(value)).toList()
      ..sort(
        (a, b) => (b['saved_at'] ?? '').toString().compareTo(
          (a['saved_at'] ?? '').toString(),
        ),
      );
  }

  static Future<void> deleteDraft(String id) async {
    await Hive.box(draftBoxName).delete(id);
    final documents = await getApplicationDocumentsDirectory();
    final mediaDirectory = Directory('${documents.path}/report_drafts/$id');
    if (await mediaDirectory.exists())
      await mediaDirectory.delete(recursive: true);
  }

  // ── Barangay Cache ─────────────────────────────────────────────────────────

  static Future<void> saveBarangays(
    List<Map<String, dynamic>> barangays,
  ) async {
    final box = Hive.box(barangayBoxName);
    await box.put('barangay_list', barangays);
    await box.put('cached_at', DateTime.now().toIso8601String());
  }

  static List<Map<String, dynamic>> getCachedBarangays() {
    final box = Hive.box(barangayBoxName);
    final data = box.get('barangay_list');
    if (data == null) return [];
    return (data as List).map((e) => Map<String, dynamic>.from(e)).toList();
  }

  static bool isBarangayCacheValid() {
    final box = Hive.box(barangayBoxName);
    final cachedAt = box.get('cached_at');
    if (cachedAt == null) return false;
    final cached = DateTime.parse(cachedAt);
    return DateTime.now().difference(cached).inHours < 24;
  }

  // ── Evacuation Center Cache ────────────────────────────────────────────────

  static Future<void> saveEvacCenters(
    List<Map<String, dynamic>> centers,
  ) async {
    final box = Hive.box(evacuationBoxName);
    await box.put('evac_centers', centers);
    await box.put('evac_cached_at', DateTime.now().toIso8601String());
  }

  static List<Map<String, dynamic>> getCachedEvacCenters() {
    final box = Hive.box(evacuationBoxName);
    final data = box.get('evac_centers');
    if (data == null) return [];
    return (data as List).map((e) => Map<String, dynamic>.from(e)).toList();
  }

  static bool isEvacCacheFresh() {
    final box = Hive.box(evacuationBoxName);
    final cachedAt = box.get('evac_cached_at');
    if (cachedAt == null) return false;
    return DateTime.now().difference(DateTime.parse(cachedAt)).inHours < 1;
  }

  static String? getEvacCacheTime() {
    final box = Hive.box(evacuationBoxName);
    return box.get('evac_cached_at');
  }

  // ── Barangay Hotline Cache ─────────────────────────────────────────────────

  static Future<void> saveBarangayHotlines(
    Map<String, dynamic> entriesByBarangayId,
  ) async {
    final box = Hive.box(hotlineBoxName);
    await box.put('entries_by_barangay', entriesByBarangayId);
    await box.put('cached_at', DateTime.now().toIso8601String());
  }

  static Map<String, List<Map<String, dynamic>>> getCachedBarangayHotlines() {
    final data = Hive.box(hotlineBoxName).get('entries_by_barangay');
    if (data is! Map) return {};
    return data.map(
      (key, value) => MapEntry(
        key.toString(),
        (value as List? ?? const [])
            .map((entry) => Map<String, dynamic>.from(entry as Map))
            .toList(),
      ),
    );
  }

  static String? getBarangayHotlineCacheTime() =>
      Hive.box(hotlineBoxName).get('cached_at') as String?;
}
