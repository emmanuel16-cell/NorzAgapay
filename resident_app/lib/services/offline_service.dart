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

  static Future<void> init() async {
    await Hive.initFlutter();
    await Hive.openBox(reportBoxName);
    await Hive.openBox(draftBoxName);
    await Hive.openBox(profileBoxName);
    await Hive.openBox(barangayBoxName);
    await Hive.openBox(evacuationBoxName);
    await Hive.openBox(hotlineBoxName);
  }

  // ── Onboarding State ────────────────────────────────────────────────────────

  static bool hasCompletedOnboarding() {
    final box = Hive.box(profileBoxName);
    return box.get('onboarding_completed', defaultValue: false) == true;
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
