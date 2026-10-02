import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:image_picker/image_picker.dart';
import '../models/incident_report.dart';
import '../models/barangay_user.dart';
import '../models/evacuation_center.dart';
import '../models/broadcast_post.dart';

class ApiService {
  static const String baseUrl = 'https://norzagapay-backend.onrender.com/api';

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

  // ── Barangays ─────────────────────────────────────────────────────────────
  static Future<List<Map<String, dynamic>>> getBarangays() async {
    final res = await http.get(
      Uri.parse('$baseUrl/barangay/list'),
      headers: _headers(null),
    );
    if (res.statusCode == 200) {
      final List<dynamic> data = jsonDecode(res.body);
      return data.map((e) => Map<String, dynamic>.from(e)).toList();
    }
    throw Exception('Failed to fetch barangays');
  }

  static Future<List<Map<String, dynamic>>> getBarangayHotlines(String barangayId) async {
    final res = await http.get(
      Uri.parse('$baseUrl/barangay/hotlines/$barangayId'),
      headers: _headers(null),
    );
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final entries = data['entries'] as List? ?? const [];
      return entries.map((entry) => Map<String, dynamic>.from(entry as Map)).toList();
    }
    throw Exception('Failed to fetch barangay hotline numbers');
  }

  static Future<List<Map<String, dynamic>>> saveBarangayHotlines(
    String token,
    List<Map<String, dynamic>> entries,
  ) async {
    final res = await http.put(
      Uri.parse('$baseUrl/barangay/hotlines'),
      headers: _headers(token),
      body: jsonEncode({'entries': entries}),
    );
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final savedEntries = data['entries'] as List? ?? const [];
      return savedEntries.map((entry) => Map<String, dynamic>.from(entry as Map)).toList();
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to save barangay hotline numbers');
  }

  // ── Incident Reports ───────────────────────────────────────────────────────
  static Future<List<IncidentReport>> getReports(String token, {String? status}) async {
    String url = '$baseUrl/barangay/reports';
    if (status != null) {
      url += '?status=$status';
    }
    final res = await http.get(Uri.parse(url), headers: _headers(token));
    if (res.statusCode == 200) {
      final List<dynamic> data = jsonDecode(res.body);
      return data.map((e) => IncidentReport.fromJson(e)).toList();
    }
    throw Exception('Failed to fetch reports');
  }

  static Future<IncidentReport> respondToReport(
    String token,
    String reportId, {
    String? notes,
    String? mdrrmoNotes,
  }) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/barangay/reports/$reportId/respond'),
      headers: _headers(token),
      body: jsonEncode({
        'notes': notes,
        'mdrrmo_notes': mdrrmoNotes,
      }),
    );
    if (res.statusCode == 200) {
      return IncidentReport.fromJson(jsonDecode(res.body));
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to respond to report');
  }

  static Future<IncidentReport> uploadFieldMedia(
    String token,
    String reportId,
    XFile file, {
    bool isVideo = false,
  }) async {
    final uri = Uri.parse('$baseUrl/barangay/reports/$reportId/field-media');
    final req = http.MultipartRequest('POST', uri);
    req.headers['Authorization'] = 'Bearer $token';
    req.headers['ngrok-skip-browser-warning'] = 'true';
    req.files.add(await http.MultipartFile.fromPath('media', file.path));
    req.fields['type'] = isVideo ? 'video' : 'image';

    final streamed = await req.send().timeout(const Duration(seconds: 40));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode == 200 || res.statusCode == 201) {
      return IncidentReport.fromJson(jsonDecode(res.body));
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to upload field media');
  }

  static Future<IncidentReport> dispatchReport(
    String token,
    String reportId, {
    String? teamLeaderId,
    List<String>? teamLeaderIds,
    String? notes,
    required String incidentType,
    required String severity,
  }) async {
    final ids = teamLeaderIds ?? (teamLeaderId != null ? [teamLeaderId] : <String>[]);
    final primaryId = ids.isNotEmpty ? ids.first : '';
    try {
      final res = await http.patch(
        Uri.parse('$baseUrl/barangay/reports/$reportId/dispatch'),
        headers: _headers(token),
        body: jsonEncode({
          'team_leader_id': primaryId,
          'team_leader_ids': ids,
          'notes': notes,
          'incident_type': incidentType,
          'severity': severity,
        }),
      );
      if (res.statusCode == 200) {
        return IncidentReport.fromJson(jsonDecode(res.body));
      }
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to dispatch report');
    } catch (e) {
      if (e is Exception) rethrow;
      throw Exception('Failed to dispatch report: $e');
    }
  }

  static Future<IncidentReport> escalateReport(
    String token,
    String reportId, {
    required String notes,
  }) async {
    try {
      final res = await http.patch(
        Uri.parse('$baseUrl/barangay/reports/$reportId/escalate'),
        headers: _headers(token),
        body: jsonEncode({
          'notes': notes,
        }),
      );
      if (res.statusCode == 200) {
        return IncidentReport.fromJson(jsonDecode(res.body));
      }
      if (res.statusCode == 404) {
        // Fallback to respond endpoint with mdrrmo_notes
        final fallbackRes = await http.patch(
          Uri.parse('$baseUrl/barangay/reports/$reportId/respond'),
          headers: _headers(token),
          body: jsonEncode({
            'notes': 'Escalated to MDRRMO: $notes',
            'mdrrmo_notes': notes,
          }),
        );
        if (fallbackRes.statusCode == 200) {
          return IncidentReport.fromJson(jsonDecode(fallbackRes.body));
        }
      }
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to escalate report to MDRRMO');
    } catch (e) {
      if (e is Exception) rethrow;
      throw Exception('Failed to escalate report: $e');
    }
  }

  static Future<IncidentReport> closeReport(
    String token,
    String reportId, {
    String? resolvedNotes,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/barangay/reports/$reportId/close'),
      headers: _headers(token),
      body: jsonEncode({'resolved_notes': resolvedNotes}),
    );
    if (res.statusCode == 200) {
      return IncidentReport.fromJson(jsonDecode(res.body));
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to close report');
  }

  // ── Team Management ────────────────────────────────────────────────────────
  static Future<List<BarangayUser>> getTeam(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/barangay/team'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      final List<dynamic> data = jsonDecode(res.body);
      return data.map((e) => BarangayUser.fromJson(e)).toList();
    }
    throw Exception('Failed to fetch team members');
  }

  static Future<BarangayUser> addTeamMember(
    String token, {
    required String fullName,
    required String email,
    required String password,
    String? phone,
    required String role,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/barangay/team'),
      headers: _headers(token),
      body: jsonEncode({
        'full_name': fullName,
        'email': email,
        'password': password,
        'phone': phone,
        'role': role,
      }),
    );
    if (res.statusCode == 201) {
      return BarangayUser.fromJson(jsonDecode(res.body));
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to add team member');
  }

  static Future<void> deactivateMember(String token, String memberId) async {
    final res = await http.delete(
      Uri.parse('$baseUrl/barangay/team/$memberId'),
      headers: _headers(token),
    );
    if (res.statusCode != 200) {
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to remove member');
    }
  }

  static Future<BarangayUser> updateTeamMember(
    String token,
    String memberId, {
    required String fullName,
    required String email,
    required String phone,
    required String role,
    String? password,
  }) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/barangay/team/$memberId'),
      headers: _headers(token),
      body: jsonEncode({
        'full_name': fullName,
        'email': email,
        'phone': phone,
        'role': role,
        if (password != null && password.isNotEmpty) 'password': password,
      }),
    );
    if (res.statusCode == 200) return BarangayUser.fromJson(jsonDecode(res.body));
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to update team member');
  }

  static Future<void> sendBarangayPasswordOtp(String email) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/barangay/password-otp'),
      headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
      body: jsonEncode({'email': email}),
    );
    if (res.statusCode == 200) return;
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to send verification code');
  }

  static Future<void> changeBarangayPassword({
    required String email,
    required String otp,
    required String currentPassword,
    required String newPassword,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/barangay/change-password'),
      headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
      body: jsonEncode({
        'email': email,
        'otp': otp,
        'current_password': currentPassword,
        'new_password': newPassword,
      }),
    );
    if (res.statusCode == 200) return;
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to change password');
  }

  // ── Evacuation Centers ─────────────────────────────────────────────────────
  static Future<List<EvacuationCenter>> getEvacuationCenters(String token, {String? barangayId}) async {
    String url = '$baseUrl/evacuation-centers';
    if (barangayId != null) {
      url += '?barangay_id=$barangayId';
    }
    final res = await http.get(Uri.parse(url), headers: _headers(token));
    if (res.statusCode == 200) {
      final List<dynamic> data = jsonDecode(res.body);
      return data.map((e) => EvacuationCenter.fromJson(e)).toList();
    }
    throw Exception('Failed to fetch evacuation centers');
  }

  static Future<EvacuationCenter> createEvacuationCenter(
    String token, {
    required String name,
    String? address,
    required double latitude,
    required double longitude,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/evacuation-centers'),
      headers: _headers(token),
      body: jsonEncode({
        'name': name,
        'address': address,
        'latitude': latitude,
        'longitude': longitude,
      }),
    );
    if (res.statusCode == 201) {
      return EvacuationCenter.fromJson(jsonDecode(res.body));
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to add evacuation center');
  }

  // ── Assistance Requests ────────────────────────────────────────────────────
  static Future<void> submitAssistanceRequest(
    String token, {
    String? incidentReportId,
    String? incidentTitle,
    required bool needsMoreManpower,
    required bool needsResources,
    required bool needsEquipment,
    required bool beyondBarangayCapability,
    required String explanation,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/barangay/assistance-requests'),
      headers: _headers(token),
      body: jsonEncode({
        'incident_report_id': incidentReportId,
        'incident_title': incidentTitle,
        'needs_more_manpower': needsMoreManpower,
        'needs_resources': needsResources,
        'needs_equipment': needsEquipment,
        'beyond_barangay_capability': beyondBarangayCapability,
        'explanation': explanation,
      }),
    );
    if (res.statusCode != 201) {
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to submit assistance request');
    }
  }

  static Future<List<Map<String, dynamic>>> getAssistanceRequests(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/barangay/assistance-requests'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body);
      final List<dynamic> list = data['requests'] ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    }
    throw Exception('Failed to fetch assistance requests');
  }

  static Future<void> decideAssistanceRequest(
    String token,
    String requestId, {
    required String decision,
    String? dispatcherNotes,
  }) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/barangay/assistance-requests/$requestId/decide'),
      headers: _headers(token),
      body: jsonEncode({
        'decision': decision,
        'dispatcher_notes': dispatcherNotes,
      }),
    );
    if (res.statusCode != 200) {
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to update assistance request');
    }
  }
  static Future<List<Map<String, dynamic>>> getMyAssistanceRequests(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/barangay/my-assistance-requests'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body);
      final List<dynamic> list = data['requests'] ?? [];
      return list.map((e) => Map<String, dynamic>.from(e)).toList();
    }
    throw Exception('Failed to fetch your assistance requests');
  }

  static Future<void> teamLeaderRequestAction(
    String token,
    String requestId, {
    required String action, // 'acknowledge' or 'cancel'
  }) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/barangay/assistance-requests/$requestId/team-action'),
      headers: _headers(token),
      body: jsonEncode({'action': action}),
    );
    if (res.statusCode != 200) {
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to perform action');
    }
  }

  static Future<void> editAssistanceRequest(
    String token,
    String requestId, {
    required bool needsMoreManpower,
    required bool needsResources,
    required bool needsEquipment,
    required bool beyondBarangayCapability,
    required String explanation,
  }) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/barangay/assistance-requests/$requestId/edit'),
      headers: _headers(token),
      body: jsonEncode({
        'needs_more_manpower': needsMoreManpower,
        'needs_resources': needsResources,
        'needs_equipment': needsEquipment,
        'beyond_barangay_capability': beyondBarangayCapability,
        'explanation': explanation,
      }),
    );
    if (res.statusCode != 200) {
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to update assistance request');
    }
  }

  // ── Public Alerts / Broadcasts ─────────────────────────────────────────────

  static Future<List<BroadcastPost>> getBroadcasts(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/barangay/broadcasts'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      final List<dynamic> data = jsonDecode(res.body);
      return data.map((e) => BroadcastPost.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    }
    throw Exception('Failed to fetch broadcasts');
  }

  static Future<BroadcastPost> createBroadcast(
    String token, {
    required String category,
    required String content,
    required List<String> links,
    List<XFile>? mediaFiles,
  }) async {
    final uri = Uri.parse('$baseUrl/barangay/broadcasts');
    final req = http.MultipartRequest('POST', uri);
    req.headers['Authorization'] = 'Bearer $token';
    req.headers['ngrok-skip-browser-warning'] = 'true';

    req.fields['category'] = category;
    req.fields['content'] = content;
    req.fields['links'] = jsonEncode(links);

    if (mediaFiles != null) {
      for (final file in mediaFiles) {
        final lower = file.name.toLowerCase();
        final isVideo = lower.endsWith('.mp4') ||
            lower.endsWith('.mov') ||
            lower.endsWith('.avi') ||
            lower.endsWith('.mkv');
        final mf = await http.MultipartFile.fromPath(
          'media',
          file.path,
          filename: file.name,
        );
        req.files.add(mf);
        req.fields['media_type_${req.files.length - 1}'] = isVideo ? 'video' : 'image';
      }
    }

    final streamed = await req.send().timeout(const Duration(seconds: 60));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode == 201) {
      return BroadcastPost.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to create broadcast');
  }

  static Future<BroadcastPost> updateBroadcast(
    String token,
    String broadcastId, {
    required String category,
    required String content,
    required List<String> links,
    List<BroadcastMediaItem>? existingMedia,
    List<XFile>? newMediaFiles,
  }) async {
    final mediaList = (existingMedia ?? []).map((m) => m.toJson()).toList();

    if (newMediaFiles != null && newMediaFiles.isNotEmpty) {
      final uri = Uri.parse('$baseUrl/barangay/broadcasts/$broadcastId');
      final req = http.MultipartRequest('PATCH', uri);
      req.headers['Authorization'] = 'Bearer $token';
      req.headers['ngrok-skip-browser-warning'] = 'true';

      req.fields['category'] = category;
      req.fields['content'] = content;
      req.fields['links'] = jsonEncode(links);
      req.fields['existing_media'] = jsonEncode(mediaList);

      for (final file in newMediaFiles) {
        final lower = file.name.toLowerCase();
        final isVideo = lower.endsWith('.mp4') ||
            lower.endsWith('.mov') ||
            lower.endsWith('.avi') ||
            lower.endsWith('.mkv');
        final mf = await http.MultipartFile.fromPath(
          'media',
          file.path,
          filename: file.name,
        );
        req.files.add(mf);
        req.fields['media_type_${req.files.length - 1}'] = isVideo ? 'video' : 'image';
      }

      final streamed = await req.send().timeout(const Duration(seconds: 60));
      final res = await http.Response.fromStream(streamed);
      if (res.statusCode == 200) {
        return BroadcastPost.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
      }
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to update broadcast');
    }

    final res = await http.patch(
      Uri.parse('$baseUrl/barangay/broadcasts/$broadcastId'),
      headers: _headers(token),
      body: jsonEncode({
        'category': category,
        'content': content,
        'links': links,
        'media': mediaList,
      }),
    );
    if (res.statusCode == 200) {
      return BroadcastPost.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to update broadcast');
  }

  static Future<void> deleteBroadcast(String token, String broadcastId) async {
    final res = await http.delete(
      Uri.parse('$baseUrl/barangay/broadcasts/$broadcastId'),
      headers: _headers(token),
    );
    if (res.statusCode != 200 && res.statusCode != 204) {
      final data = jsonDecode(res.body);
      throw Exception(data['error'] ?? 'Failed to delete broadcast');
    }
  }

  static Future<BroadcastPost> setBroadcastPinned(
    String token,
    String broadcastId,
    bool isPinned,
  ) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/barangay/broadcasts/$broadcastId/pin'),
      headers: _headers(token),
      body: jsonEncode({'is_pinned': isPinned}),
    );
    final data = jsonDecode(res.body);
    if (res.statusCode == 200) {
      return BroadcastPost.fromJson(Map<String, dynamic>.from(data as Map));
    }
    throw Exception(data['error'] ?? 'Failed to update pinned status');
  }

  static Future<List<BroadcastPost>> getMdrrmoBroadcasts(String token) async {
    final res = await http.get(
      Uri.parse('$baseUrl/barangay/broadcasts/mdrrmo'),
      headers: _headers(token),
    );
    if (res.statusCode == 200) {
      final List<dynamic> data = jsonDecode(res.body);
      return data.map((e) => BroadcastPost.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    }
    throw Exception('Failed to fetch MDRRMO broadcasts');
  }

  static Future<BroadcastPost> repostBroadcast(String token, String broadcastId) async {
    final res = await http.post(
      Uri.parse('$baseUrl/barangay/broadcasts/$broadcastId/repost'),
      headers: _headers(token),
    );
    if (res.statusCode == 200 || res.statusCode == 201) {
      return BroadcastPost.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
    }
    final data = jsonDecode(res.body);
    throw Exception(data['error'] ?? 'Failed to repost broadcast');
  }
}
