import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../core/constants.dart';
import 'offline_service.dart';

class EvidenceUploadService {
  static final Set<String> _activeReportIds = <String>{};

  static Future<void> queueAndUpload({
    required String reportId,
    required List<String> filePaths,
    required List<String> proofTypes,
    required String contactNumber,
  }) async {
    try {
      await OfflineService.savePendingEvidenceJob(
        reportId: reportId,
        sourcePaths: filePaths,
        proofTypes: proofTypes,
        contactNumber: contactNumber,
      );
      await _upload(reportId);
    } catch (error) {
      debugPrint('Could not queue evidence for report $reportId: $error');
    }
  }

  static Future<void> retryPending() async {
    for (final job in OfflineService.getPendingEvidenceJobs()) {
      final reportId = job['report_id']?.toString();
      if (reportId != null && reportId.isNotEmpty) await _upload(reportId);
    }
  }

  static Future<bool> _upload(String reportId) async {
    if (!_activeReportIds.add(reportId)) return false;
    try {
      Map<String, dynamic>? job;
      for (final item in OfflineService.getPendingEvidenceJobs()) {
        if (item['report_id']?.toString() == reportId) {
          job = item;
          break;
        }
      }
      if (job == null) return false;
      final paths = (job['proof_paths'] as List?)?.map((value) => value.toString()).toList() ?? const <String>[];
      final proofTypes = (job['proof_types'] as List?)?.map((value) => value.toString()).toList() ?? const <String>[];
      if (paths.isEmpty || paths.any((path) => path.isEmpty || !File(path).existsSync())) {
        await _markFailed(reportId, job['contact_number']?.toString() ?? '');
        return false;
      }

      final profile = OfflineService.getProfile();
      final token = profile?['token']?.toString();
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          final request = http.MultipartRequest(
            'POST',
            Uri.parse('${AppConstants.apiBaseUrl}/incident-reports/$reportId/evidence'),
          );
          request.headers['ngrok-skip-browser-warning'] = 'true';
          if (token != null && token.isNotEmpty) {
            request.headers['Authorization'] = 'Bearer $token';
          }
          request.fields['contact_number'] = job['contact_number']?.toString() ?? '';
          request.fields['proof_type'] = proofTypes.isNotEmpty ? proofTypes.first : 'image';
          request.fields['proof_types'] = jsonEncode(proofTypes);
          for (final path in paths) {
            request.files.add(await http.MultipartFile.fromPath('proofs', path));
          }

          final streamed = await request.send().timeout(const Duration(seconds: 90));
          final response = await http.Response.fromStream(streamed);
          if (response.statusCode >= 200 && response.statusCode < 300) {
            final body = jsonDecode(response.body);
            if (body is Map && body['evidence_status'] == 'ready') {
              await OfflineService.clearPendingEvidenceJob(reportId);
              return true;
            }
          }
        } catch (error) {
          debugPrint('Evidence upload attempt ${attempt + 1} failed for $reportId: $error');
        }
        if (attempt < 2) await Future<void>.delayed(const Duration(seconds: 1));
      }
      await _markFailed(reportId, job['contact_number']?.toString() ?? '');
      return false;
    } finally {
      _activeReportIds.remove(reportId);
    }
  }

  static Future<void> _markFailed(String reportId, String contactNumber) async {
    try {
      final token = OfflineService.getProfile()?['token']?.toString();
      await http.patch(
        Uri.parse('${AppConstants.apiBaseUrl}/incident-reports/$reportId/evidence-failed'),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'contact_number': contactNumber}),
      ).timeout(const Duration(seconds: 8));
    } catch (error) {
      debugPrint('Could not update evidence failure state for $reportId: $error');
    }
  }
}
