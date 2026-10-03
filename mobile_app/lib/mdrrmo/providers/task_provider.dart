import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/task.dart';
import '../core/constants.dart';

class TaskProvider with ChangeNotifier {
  List<Task> _tasks = [];
  bool _isLoading = false;

  List<Task> get tasks => _tasks;
  bool get isLoading => _isLoading;

  Future<void> fetchTasks(String token) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/tasks'),
        headers: {
          'Authorization': 'Bearer $token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        _tasks = (data['tasks'] as List).map((t) => Task.fromJson(t)).toList();
      }
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> updateTaskStatus(
    String taskId,
    String status,
    String token, {
    String? proofUrl,
    String? arrivalMethod,
    double? latitude,
    double? longitude,
    double? accuracyM,
    DateTime? fixAt,
  }) async {
    try {
      final response = await http.patch(
        Uri.parse('${AppConstants.apiBaseUrl}/tasks/$taskId/status'),
        body: json.encode({
          'status': status,
          'proof_photo_url': proofUrl,
          if (arrivalMethod != null) 'arrival_method': arrivalMethod,
          if (latitude != null) 'latitude': latitude,
          if (longitude != null) 'longitude': longitude,
          if (accuracyM != null) 'accuracy_m': accuracyM,
          if (fixAt != null) 'fix_at': fixAt.toUtc().toIso8601String(),
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (response.statusCode == 200) {
        final index = _tasks.indexWhere((t) => t.id == taskId);
        if (index != -1) {
          final body = json.decode(response.body);
          if (body['task'] != null) {
            _tasks[index] = Task.fromJson(body['task']);
          } else {
            // Manually update status if task object not returned
            final oldTask = _tasks[index];
            _tasks[index] = Task(
              id: oldTask.id,
              incidentId: oldTask.incidentId,
              title: oldTask.title,
              description: oldTask.description,
              type: oldTask.type,
              requiredSkill: oldTask.requiredSkill,
              assignedTo: oldTask.assignedTo,
              status: TaskStatus.values.firstWhere((e) => e.name == status),
              proofPhotoUrl: oldTask.proofPhotoUrl,
              createdAt: oldTask.createdAt,
              completedAt: oldTask.completedAt,
              acceptedAt: oldTask.acceptedAt,
              travelDistanceM: oldTask.travelDistanceM,
              travelDistanceAccuracyM: oldTask.travelDistanceAccuracyM,
              travelDistanceFixAt: oldTask.travelDistanceFixAt,
              arrivedAt: oldTask.arrivedAt,
              incidentTitle: oldTask.incidentTitle,
              incidentType: oldTask.incidentType,
              incidentSeverity: oldTask.incidentSeverity,
              latitude: oldTask.latitude,
              longitude: oldTask.longitude,
              address: oldTask.address,
            );
          }
          notifyListeners();
        }
      } else {
        final body = json.decode(response.body);
        throw Exception(body['error'] ?? 'Failed to update task status');
      }
    } catch (e) {
      rethrow;
    }
  }
}
