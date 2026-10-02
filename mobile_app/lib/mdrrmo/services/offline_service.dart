import 'package:hive_flutter/hive_flutter.dart';
import '../models/task.dart';

class OfflineService {
  static const String taskBoxName = 'tasks_offline';
  static const String reportBoxName = 'pending_reports';

  static Future<void> init() async {
    await Hive.openBox(taskBoxName);
    await Hive.openBox(reportBoxName);
  }

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

  static Future<void> clearAllReports() async {
    final box = Hive.box(reportBoxName);
    await box.clear();
  }

  static Future<void> cacheTasks(List<Task> tasks) async {
    final box = Hive.box(taskBoxName);
    // Simple JSON string storage for demonstration
    await box.put('last_tasks', tasks.map((t) => t.id).toList());
  }

  static List<String> getCachedTaskIds() {
    final box = Hive.box(taskBoxName);
    return List<String>.from(box.get('last_tasks', defaultValue: []));
  }
}
