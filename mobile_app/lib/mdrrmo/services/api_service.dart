import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/constants.dart';
import '../models/evacuation_center.dart';
import '../models/mdrrmo_report.dart';
import 'package:image_picker/image_picker.dart';

class ApiService {
  static const String baseUrl = AppConstants.apiBaseUrl;

  static Map<String, String> _headers(String? token) {
    final headers = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    if (token != null) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  static Future<List<MdrrmoReport>> getMdrrmoReports(String token) async {
    final response = await http.get(
      Uri.parse('$baseUrl/mdrrmo/reports/queue'),
      headers: _headers(token),
    );
    final body = response.body.isEmpty ? const [] : jsonDecode(response.body);
    if (response.statusCode == 200 && body is List) {
      return body.map((item) => MdrrmoReport.fromJson(Map<String, dynamic>.from(item as Map))).toList();
    }
    final message = body is Map ? body['error'] : null;
    throw Exception(message ?? 'Failed to fetch MDRRMO reports');
  }

  static Future<List<Map<String, dynamic>>> getMdrrmoBroadcasts(String token) async {
    final response = await http.get(
      Uri.parse('$baseUrl/broadcasts/mdrrmo'),
      headers: _headers(token),
    );
    final body = response.body.isEmpty ? const [] : jsonDecode(response.body);
    if (response.statusCode == 200 && body is List) {
      return body.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList();
    }
    final message = body is Map ? body['error'] : null;
    throw Exception(message ?? 'Failed to load MDRRMO posts');
  }

  static Future<MdrrmoReport> saveMdrrmoFieldAssessment(
    String token,
    String reportId, {
    required String situation,
    String affectedPeople = '',
    String actionsTaken = '',
    String risksResources = '',
  }) async {
    final response = await http.patch(
      Uri.parse('$baseUrl/mdrrmo/reports/$reportId/field-assessment'),
      headers: _headers(token),
      body: jsonEncode({
        'situation': situation,
        'affected_people': affectedPeople,
        'actions_taken': actionsTaken,
        'risks_resources': risksResources,
      }),
    );
    return _mdrrmoReportFromResponse(response, 'Failed to save field assessment');
  }

  static Future<void> requestMdrrmoAssistance(
    String token,
    String reportId, {
    required String requestType,
    required String subType,
    required String details,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/requests'),
      headers: _headers(token),
      body: jsonEncode({
        'request_type': requestType,
        'sub_type': subType,
        'details': details,
        'incident_id': reportId,
      }),
    );
    final body = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    if (response.statusCode != 201) {
      throw Exception(body is Map ? body['error'] ?? 'Failed to submit assistance request' : 'Failed to submit assistance request');
    }
  }

  static Future<List<Map<String, dynamic>>> getActiveMdrrmoResponders(String token) async {
    final response = await http.get(
      Uri.parse('$baseUrl/mdrrmo/reports/responders'),
      headers: _headers(token),
    );
    final body = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    if (response.statusCode == 200 && body is Map) {
      return (body['responders'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
    }
    throw Exception(body is Map ? body['error'] ?? 'Failed to fetch responders' : 'Failed to fetch responders');
  }

  static Future<MdrrmoReport> dispatchMdrrmoReport(
    String token,
    String reportId, {
    required String incidentType,
    required String severity,
    required List<String> responderIds,
    String? notes,
  }) async {
    final response = await http.patch(
      Uri.parse('$baseUrl/mdrrmo/reports/$reportId/dispatch'),
      headers: _headers(token),
      body: jsonEncode({
        'incident_type': incidentType,
        'severity': severity,
        'responder_ids': responderIds,
        'notes': notes?.trim() ?? '',
      }),
    );
    final body = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    if (response.statusCode == 200 && body is Map) return MdrrmoReport.fromJson(Map<String, dynamic>.from(body));
    throw Exception(body is Map ? body['error'] ?? 'Failed to dispatch report' : 'Failed to dispatch report');
  }

  static Future<MdrrmoReport> respondToMdrrmoReport(String token, String reportId) async {
    return _mdrrmoMutation(token, reportId, 'respond', method: 'PATCH');
  }

  static Future<MdrrmoReport> markMdrrmoReportArrived(
    String token,
    String reportId, {
    String method = 'manual',
    double? latitude,
    double? longitude,
    double? accuracyM,
    DateTime? fixAt,
  }) async {
    final response = await http.patch(
      Uri.parse('$baseUrl/mdrrmo/reports/$reportId/arrive'),
      headers: _headers(token),
      body: jsonEncode({
        'method': method,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (accuracyM != null) 'accuracy_m': accuracyM,
        if (fixAt != null) 'fix_at': fixAt.toUtc().toIso8601String(),
      }),
    );
    return _mdrrmoReportFromResponse(response, 'Failed to record arrival');
  }

  static Future<MdrrmoReport> closeMdrrmoReport(String token, String reportId, String resolvedNotes) async {
    final response = await http.post(
      Uri.parse('$baseUrl/mdrrmo/reports/$reportId/close'),
      headers: _headers(token),
      body: jsonEncode({'resolved_notes': resolvedNotes}),
    );
    return _mdrrmoReportFromResponse(response, 'Failed to close report');
  }

  static Future<MdrrmoReport> uploadMdrrmoFieldMedia(String token, String reportId, XFile file) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/mdrrmo/reports/$reportId/field-media'));
    request.headers['Authorization'] = 'Bearer $token';
    request.headers['ngrok-skip-browser-warning'] = 'true';
    request.files.add(await http.MultipartFile.fromPath('media', file.path));
    final streamed = await request.send().timeout(const Duration(seconds: 40));
    return _mdrrmoReportFromResponse(await http.Response.fromStream(streamed), 'Failed to upload field media');
  }

  static Future<MdrrmoReport> _mdrrmoMutation(String token, String reportId, String action, {required String method}) async {
    final uri = Uri.parse('$baseUrl/mdrrmo/reports/$reportId/$action');
    final response = method == 'POST'
        ? await http.post(uri, headers: _headers(token), body: jsonEncode({}))
        : await http.patch(uri, headers: _headers(token), body: jsonEncode({}));
    return _mdrrmoReportFromResponse(response, 'Failed to update report');
  }

  static MdrrmoReport _mdrrmoReportFromResponse(http.Response response, String fallback) {
    final body = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    if (response.statusCode == 200 && body is Map) return MdrrmoReport.fromJson(Map<String, dynamic>.from(body));
    throw Exception(body is Map ? body['error'] ?? fallback : fallback);
  }

  // ── Respond Unit & Team ──────────────────────────────────────────────────
  static Future<Map<String, dynamic>> getMyUnit(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/respond-units/my-unit'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      return jsonDecode(res.body);
    }
    throw Exception('Failed to fetch unit details');
  }

  static Future<void> addUnitMembers(String token, String unitId, List<String> officerIds) async {
    final res = await http.post(
      Uri.parse('$baseUrl/respond-units/$unitId/members'),
      headers: _headers(token),
      body: jsonEncode({'officer_ids': officerIds}),
    );
    if (res.statusCode != 200) {
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to add members to unit');
    }
  }

  // ── Team Leader Adding Members on the Move ──────────────────────────────
  static Future<Map<String, dynamic>> addMembersOnTheMove(
    String token,
    String taskId,
    List<String> memberIds,
  ) async {
    final res = await http.post(
      Uri.parse('$baseUrl/tasks/$taskId/members'),
      headers: _headers(token),
      body: jsonEncode({'member_ids': memberIds}),
    );
    if (res.statusCode == 200) {
      return jsonDecode(res.body);
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to add members on the move');
  }

  // ── Officers List ────────────────────────────────────────────────────────
  static Future<List<Map<String, dynamic>>> getOfficers(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/officers'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body);
      final List<dynamic> list = data['officers'] ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    }
    throw Exception('Failed to fetch officers list');
  }

  // ── Evacuation Centers ───────────────────────────────────────────────────
  static Future<List<EvacuationCenter>> getEvacCenters(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/evacuation-centers'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      final decoded = jsonDecode(res.body);
      final List<dynamic> list = decoded is List
          ? decoded
          : (decoded['centers'] ?? decoded['evacuation_centers'] ?? decoded['data'] ?? []);
      return list.map((e) => EvacuationCenter.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    }
    throw Exception('Failed to fetch evacuation centers');
  }

}
