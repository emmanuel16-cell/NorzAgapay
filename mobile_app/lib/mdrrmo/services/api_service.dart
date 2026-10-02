import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/constants.dart';
import '../models/evacuation_center.dart';

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

  // ── Officer Account Registration ─────────────────────────────────────────
  static Future<Map<String, dynamic>> registerOfficer({
    required String fullName,
    required String email,
    required String password,
    String? phone,
    required String specialization,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/register'),
      headers: _headers(null),
      body: jsonEncode({
        'full_name': fullName,
        'email': email,
        'password': password,
        'phone': phone,
        'role': 'responder',
        'unit_type': specialization,
      }),
    );

    final data = jsonDecode(res.body);
    if (res.statusCode == 201 || res.statusCode == 200) {
      return data;
    }
    throw Exception(data['error'] ?? 'Registration failed');
  }
}
