import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';
import '../models/user.dart';
import '../core/constants.dart';

class AuthProvider with ChangeNotifier {
  User? _user;
  String? _token;
  bool _isLoading = false;
  Map<String, dynamic>? _myUnit;
  List<Map<String, dynamic>> _unitMembers = [];
  bool _isTeamLeader = false;
  final _storage = const FlutterSecureStorage();

  User? get user => _user;
  String? get token => _token;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _token != null;
  Map<String, dynamic>? get myUnit => _myUnit;
  List<Map<String, dynamic>> get unitMembers => _unitMembers;
  bool get isTeamLeader => _isTeamLeader;

  bool _isAllowedMobileRole(UserRole role) =>
      role == UserRole.dispatcher || role == UserRole.responder;

  Future<void> fetchMyUnit() async {
    if (_token == null) return;
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/respond-units/my-unit'),
        headers: {
          'Authorization': 'Bearer $_token',
          'ngrok-skip-browser-warning': 'true',
        },
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        _myUnit = data['unit'];
        _isTeamLeader = data['is_team_leader'] == true;
        _unitMembers = (data['members'] as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e))
            .toList();

        if (_user != null) {
          final myOfficerId = data['officer_id'];
          final myMember = _unitMembers.firstWhere(
            (m) => (myOfficerId != null && m['id']?.toString() == myOfficerId.toString()) ||
                   (m['email'] != null && m['email'] == _user?.email),
            orElse: () => {},
          );
          final String? officerSpec = myMember['specialization'];
          String? updatedUnitTypeString = _user!.unitTypeString;
          if (officerSpec != null && officerSpec.trim().isNotEmpty) {
            if (updatedUnitTypeString == null || officerSpec.contains(',') || !updatedUnitTypeString.contains(',')) {
              updatedUnitTypeString = officerSpec;
            }
          }

          _user = User(
            id: _user!.id,
            fullName: _user!.fullName,
            email: _user!.email,
            phone: _user!.phone,
            role: _user!.role,
            unitType: _user!.unitType,
            unitTypeString: updatedUnitTypeString,
            status: _user!.status,
            verified: _user!.verified,
            latitude: _user!.latitude,
            longitude: _user!.longitude,
            isTeamLeader: _isTeamLeader,
            unitName: _myUnit?['unit_name'],
            rank: _isTeamLeader ? 'Team Leader' : _user!.rank,
          );
        }
        notifyListeners();
      }
    } catch (e) {
      debugPrint('Fetch my unit error: $e');
    }
  }

  Future<void> tryAutoLogin() async {
    final token = await _storage.read(key: AppConstants.tokenKey);
    if (token == null) return;

    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/auth/me'),
        headers: {
          'Authorization': 'Bearer $token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final user = User.fromJson(data['user']);
        if (!_isAllowedMobileRole(user.role)) {
          await logout();
          return;
        }
        _token = token;
        _user = user;
        await fetchMyUnit();
        notifyListeners();
      } else {
        await logout();
      }
    } catch (e) {
      print('Auto login error: $e');
    }
  }

  Future<void> login(String email, String password) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/auth/login'),
        body: json.encode({'email': email, 'password': password}),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      final data = json.decode(response.body);
      if (response.statusCode == 200) {
        final user = User.fromJson(data['user']);
        if (!_isAllowedMobileRole(user.role)) {
          throw 'MDRRMO mobile access is limited to Dispatcher and Responder accounts.';
        }
        _token = data['token'];
        _user = user;
        await _storage.write(key: AppConstants.tokenKey, value: _token);
        await fetchMyUnit();
        notifyListeners();
      } else {
        throw data['error'] ?? 'Login failed';
      }
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<List<Map<String, dynamic>>> getDebugAccounts() async {
    final response = await http.get(
      Uri.parse('${AppConstants.apiBaseUrl}/debug/accounts?audience=standard'),
      headers: {'ngrok-skip-browser-warning': 'true'},
    );
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return (data['accounts'] as List)
          .map((account) => Map<String, dynamic>.from(account))
          .where((account) => account['role'] == 'dispatcher' || account['role'] == 'responder')
          .toList();
    }
    throw data['error'] ?? 'Debug quick login is unavailable';
  }

  Future<void> debugQuickLogin(String accountId) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/debug/quick-login'),
        body: json.encode({'accountId': accountId, 'audience': 'standard'}),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
      );
      final data = json.decode(response.body);
      if (response.statusCode != 200) throw data['error'] ?? 'Quick login failed';
      final user = User.fromJson(data['user']);
      if (!_isAllowedMobileRole(user.role)) {
        throw 'MDRRMO mobile access is limited to Dispatcher and Responder accounts.';
      }
      _token = data['token'];
      _user = user;
      await _storage.write(key: AppConstants.tokenKey, value: _token);
      await fetchMyUnit();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>> register(Map<String, dynamic> userData) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/auth/register'),
        body: json.encode(userData),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      final data = json.decode(response.body);
      if (response.statusCode == 201) {
        return data;
      } else {
        String msg = data['error'] ?? 'Registration failed';
        if (data['details'] != null && data['details'] is Map) {
          final details = data['details'] as Map;
          if (details['fieldErrors'] != null && details['fieldErrors'] is Map) {
            final fieldErrors = details['fieldErrors'] as Map;
            final errors = fieldErrors.entries
                .map((e) => '${e.key}: ${(e.value as List).join(", ")}')
                .join('\n');
            if (errors.isNotEmpty) {
              msg = '$msg:\n$errors';
            }
          }
        }
        throw msg;
      }
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> uploadFile({
     required XFile file,
     required String category,
     required String token,
     String? certType,
     String? certNumber,
   }) async {
     _isLoading = true;
     notifyListeners();

     try {
       final request = http.MultipartRequest(
         'POST',
         Uri.parse('${AppConstants.apiBaseUrl}/upload'),
       );
 
       request.headers.addAll({
         'Authorization': 'Bearer $token',
         'ngrok-skip-browser-warning': 'true',
       });
 
       request.fields['category'] = category;
 
       request.files.add(await http.MultipartFile.fromPath(
         'file',
         file.path,
         filename: file.name,
       ));
 
       final streamedResponse = await request.send();
       final response = await http.Response.fromStream(streamedResponse);
 
       if (response.statusCode != 200) {
         final errorData = json.decode(response.body);
         throw errorData['error'] ?? 'Upload failed';
       }
 
       final uploadData = json.decode(response.body);
       final objectKey = uploadData['object_key'];
 
       // Confirm the upload to save to DB
       final confirmResponse = await http.post(
         Uri.parse('${AppConstants.apiBaseUrl}/upload/confirm'),
         body: json.encode({
           'object_key': objectKey,
           'category': category,
           'cert_type': certType,
           'cert_number': certNumber,
         }),
         headers: {
           'Content-Type': 'application/json',
           'Authorization': 'Bearer $token',
           'ngrok-skip-browser-warning': 'true',
         },
       );
 
       if (confirmResponse.statusCode != 200) {
         final errorData = json.decode(confirmResponse.body);
         throw errorData['error'] ?? 'Failed to confirm upload';
       }
     } finally {
       _isLoading = false;
       notifyListeners();
     }
   }

  Future<void> updateStatus(bool isActive) async {
    if (_token == null) return;
    
    final status = isActive ? 'active' : 'inactive';
    try {
      final response = await http.patch(
        Uri.parse('${AppConstants.apiBaseUrl}/auth/status'),
        body: json.encode({'status': status}),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        _user = User.fromJson({
          ..._user!.toJson(),
          'status': data['user']['status'],
        });
        notifyListeners();
      } else {
        final data = json.decode(response.body);
        throw data['error'] ?? 'Failed to update status';
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> submitResourceRequest({
    required String requestType,
    required String subType,
    required String details,
    String? incidentId,
  }) async {
    if (_token == null) throw 'Authentication required';

    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/requests'),
        body: json.encode({
          'request_type': requestType,
          'sub_type': subType,
          'details': details,
          'incident_id': incidentId,
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (response.statusCode != 201) {
        final data = json.decode(response.body);
        throw data['error'] ?? 'Request submission failed';
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> logout() async {
    _token = null;
    _user = null;
    await _storage.delete(key: AppConstants.tokenKey);
    notifyListeners();
  }
}
