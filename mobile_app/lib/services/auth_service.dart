import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:open_file/open_file.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/barangay_user.dart';

class AuthService extends ChangeNotifier {
  static const String _authBoxName = 'barangay_auth';
  static const String _apiBaseUrl = 'https://norzagapay-backend.onrender.com/api';

  BarangayUser? _currentUser;
  String? _token;
  bool _isLoading = false;

  BarangayUser? get currentUser => _currentUser;
  String? get token => _token;
  bool get isAuthenticated => _token != null && _currentUser != null;
  bool get isLoading => _isLoading;
  String get apiBaseUrl => _apiBaseUrl;

  static Future<void> init() async {
    await Hive.initFlutter();
    await Hive.openBox(_authBoxName);
    await Hive.openBox('barangay_settings');
  }

  Future<void> loadSavedAuth() async {
    final box = Hive.box(_authBoxName);
    final savedToken = box.get('token');
    final savedUserData = box.get('user');

    if (savedToken != null && savedUserData != null) {
      _token = savedToken;
      _currentUser = BarangayUser.fromJson(Map<String, dynamic>.from(savedUserData));
      // Never trust cached barangay approval after an app restart. Every role
      // stays behind the account-request screen until the server confirms it.
      _currentUser = _currentUser!.copyWith(coordinationVerified: false);
      await box.put('user', _currentUser!.toJson());
      notifyListeners();

      checkVerificationStatus();
    }
  }

  Future<bool> login(String email, String password) async {
    _isLoading = true;
    notifyListeners();

    try {
      final res = await http.post(
        Uri.parse('$_apiBaseUrl/barangay/login'),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: jsonEncode({'email': email, 'password': password}),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _token = data['token'];
        _currentUser = BarangayUser.fromJson(data['user']);

        final box = Hive.box(_authBoxName);
        await box.put('token', _token);
        await box.put('user', _currentUser!.toJson());

        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        final data = jsonDecode(res.body);
        throw Exception(data['error'] ?? 'Login failed');
      }
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> getDebugAccounts() async {
    final res = await http.get(
      Uri.parse('$_apiBaseUrl/debug/accounts?audience=barangay'),
      headers: {'ngrok-skip-browser-warning': 'true'},
    );
    final data = jsonDecode(res.body);
    if (res.statusCode == 200) {
      return (data['accounts'] as List)
          .map((account) => Map<String, dynamic>.from(account))
          .toList();
    }
    throw Exception(data['error'] ?? 'Debug quick login is unavailable');
  }

  Future<void> debugQuickLogin(String accountId) async {
    _isLoading = true;
    notifyListeners();
    try {
      final res = await http.post(
        Uri.parse('$_apiBaseUrl/debug/quick-login'),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: jsonEncode({'accountId': accountId, 'audience': 'barangay'}),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode != 200) throw Exception(data['error'] ?? 'Quick login failed');
      _token = data['token'];
      _currentUser = BarangayUser.fromJson(data['user']);
      final box = Hive.box(_authBoxName);
      await box.put('token', _token);
      await box.put('user', _currentUser!.toJson());
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> sendBarangayRegistrationOtp({
    required String fullName,
    required String email,
    required String barangayId,
    required String positionDesignation,
    String? phone,
  }) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await http.post(
        Uri.parse('$_apiBaseUrl/barangay/register-otp'),
        headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
        body: jsonEncode({
          'full_name': fullName,
          'email': email,
          'phone': phone,
          'barangay_id': barangayId,
          'position_designation': positionDesignation,
        }),
      );
      final data = jsonDecode(response.body);
      if (response.statusCode != 200) throw Exception(data['error'] ?? 'Could not send verification code');
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>> verifyBarangayRegistrationOtp({required String email, required String otp}) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await http.post(
        Uri.parse('$_apiBaseUrl/barangay/verify-register-otp'),
        headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
        body: jsonEncode({'email': email, 'otp': otp}),
      );
      final data = Map<String, dynamic>.from(jsonDecode(response.body));
      if (response.statusCode != 201) throw Exception(data['error'] ?? 'Could not verify account');
      return data;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> activateRegisteredAccount(Map<String, dynamic> result) async {
    _token = result['token'] as String?;
    _currentUser = BarangayUser.fromJson(Map<String, dynamic>.from(result['user'] as Map));
    final box = Hive.box(_authBoxName);
    await box.put('token', _token);
    await box.put('user', _currentUser!.toJson());
    notifyListeners();
  }

  // Check verification status from server
  Future<void> checkVerificationStatus() async {
    if (_token == null) return;
    try {
      final res = await http.get(
        Uri.parse('$_apiBaseUrl/barangay/account-request/status'),
        headers: {
          'Authorization': 'Bearer $_token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final ver = data['verification'];
        if (_currentUser != null) {
          final newStatus = ver is Map
              ? (ver['status'] as String? ?? _currentUser!.verificationStatus)
              : (data['verification_status'] as String? ??
                  (data['coordination_verified'] == true ? 'verified' :
                      (_currentUser!.isBarangayAdmin ? 'pending_document' : _currentUser!.verificationStatus)));
          _currentUser = _currentUser!.copyWith(
            verificationStatus: newStatus,
            verificationRefNo: ver is Map ? ver['reference_no'] as String? : null,
            positionDesignation: ver is Map ? ver['position_designation'] as String? : null,
            punongBarangayName: ver is Map ? ver['punong_barangay_name'] as String? : null,
            punongBarangayPosition: ver is Map ? ver['punong_barangay_position'] as String? : null,
            documentUrl: ver is Map ? ver['document_url'] as String? : null,
            submittedAt: ver is Map ? ver['submitted_at'] as String? : null,
            rejectionReason: ver is Map ? ver['rejection_reason'] as String? : null,
            isActive: _currentUser!.isActive,
            verificationHistory: ver is Map ? ver['verification_history'] as List<dynamic>? : null,
            coordinationVerified: data['coordination_verified'] == true,
            clearDocumentUrl: ver is Map && ver['document_url'] == null,
            clearSubmittedAt: ver is Map && ver['submitted_at'] == null,
            clearRejectionReason: ver is Map && ver['rejection_reason'] == null,
          );

          final box = Hive.box(_authBoxName);
          await box.put('user', _currentUser!.toJson());
          notifyListeners();
        }
      }
    } catch (e) {
      // Ignored during background status refresh
    }
  }

  Future<Map<String, dynamic>> loadCoordinationRequest() async {
    final response = await http.get(
      Uri.parse('$_apiBaseUrl/barangay/account-request'),
      headers: {'Authorization': 'Bearer $_token', 'ngrok-skip-browser-warning': 'true'},
    );
    final data = Map<String, dynamic>.from(jsonDecode(response.body));
    if (response.statusCode != 200) throw Exception(data['error'] ?? 'Could not load Barangay Account Request');
    final verification = data['verification'];
    if (_currentUser != null) {
      _currentUser = _currentUser!.copyWith(
        verificationRefNo: verification is Map ? verification['reference_no'] as String? : null,
        positionDesignation: verification is Map ? verification['position_designation'] as String? : null,
        verificationStatus: verification is Map
            ? verification['status'] as String? ?? 'pending_document'
            : (data['coordination_verified'] == true ? 'verified' : 'pending_document'),
        punongBarangayName: verification is Map ? verification['punong_barangay_name'] as String? : null,
        punongBarangayPosition: verification is Map ? verification['punong_barangay_position'] as String? : null,
        documentUrl: verification is Map ? verification['document_url'] as String? : null,
        submittedAt: verification is Map ? verification['submitted_at'] as String? : null,
        rejectionReason: verification is Map ? verification['rejection_reason'] as String? : null,
        verificationHistory: verification is Map ? verification['verification_history'] as List<dynamic>? : null,
        coordinationVerified: data['coordination_verified'] == true,
        clearDocumentUrl: verification is Map && verification['document_url'] == null,
        clearSubmittedAt: verification is Map && verification['submitted_at'] == null,
        clearRejectionReason: verification is Map && verification['rejection_reason'] == null,
      );
      await Hive.box(_authBoxName).put('user', _currentUser!.toJson());
      notifyListeners();
    }
    return data;
  }

  Future<Map<String, dynamic>> saveCoordinationRequest({
    required String officialName,
    required String officialPosition,
    required String positionDesignation,
  }) async {
    final response = await http.put(
      Uri.parse('$_apiBaseUrl/barangay/account-request'),
      headers: {
        'Authorization': 'Bearer $_token',
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: jsonEncode({
        'official_name': officialName,
        'official_position': officialPosition,
        'position_designation': positionDesignation,
      }),
    );
    final data = Map<String, dynamic>.from(jsonDecode(response.body));
    if (response.statusCode != 200) throw Exception(data['error'] ?? 'Could not save Barangay Account Request');
    final verification = Map<String, dynamic>.from(data['verification'] as Map);
    if (_currentUser != null) {
      _currentUser = _currentUser!.copyWith(
        verificationRefNo: verification['reference_no'] as String?,
        verificationStatus: verification['status'] as String?,
        punongBarangayName: verification['punong_barangay_name'] as String?,
        punongBarangayPosition: verification['punong_barangay_position'] as String?,
        positionDesignation: verification['position_designation'] as String?,
        documentUrl: verification['document_url'] as String?,
        submittedAt: verification['submitted_at'] as String?,
        rejectionReason: verification['rejection_reason'] as String?,
        verificationHistory: verification['verification_history'] as List<dynamic>?,
        coordinationVerified: data['coordination_verified'] == true,
        clearDocumentUrl: verification['document_url'] == null,
        clearSubmittedAt: verification['submitted_at'] == null,
        clearRejectionReason: verification['rejection_reason'] == null,
      );
      await Hive.box(_authBoxName).put('user', _currentUser!.toJson());
      notifyListeners();
    }
    return verification;
  }

  Future<Map<String, dynamic>> requestBarangayActivation() async {
    final response = await http.post(
      Uri.parse('$_apiBaseUrl/barangay/account-request/activation'),
      headers: {'Authorization': 'Bearer $_token', 'ngrok-skip-browser-warning': 'true'},
    );
    final data = Map<String, dynamic>.from(jsonDecode(response.body));
    if (response.statusCode != 200) {
      throw Exception(data['error'] ?? 'Could not request barangay activation');
    }
    final verification = Map<String, dynamic>.from(data['verification'] as Map);
    if (_currentUser != null) {
      _currentUser = _currentUser!.copyWith(
        verificationStatus: verification['status'] as String? ?? 'activation_pending',
        verificationRefNo: verification['reference_no'] as String?,
        submittedAt: verification['submitted_at'] as String?,
        rejectionReason: null,
        verificationHistory: verification['verification_history'] as List<dynamic>?,
        coordinationVerified: false,
        clearRejectionReason: true,
      );
      await Hive.box(_authBoxName).put('user', _currentUser!.toJson());
      notifyListeners();
    }
    return verification;
  }

  void onCoordinationAccessUpdate(bool isVerified) {
    if (_currentUser == null) return;
    _currentUser = _currentUser!.copyWith(coordinationVerified: isVerified);
    Hive.box(_authBoxName).put('user', _currentUser!.toJson());
    notifyListeners();
  }

  Future<void> dismissCoordinationPrompt() async {
    if (_currentUser == null) return;
    _currentUser = _currentUser!.copyWith(coordinationPromptPending: false);
    await Hive.box(_authBoxName).put('user', _currentUser!.toJson());
    notifyListeners();
  }

  Future<void> updateOwnProfile({
    required String fullName,
    required String phone,
  }) async {
    if (_token == null || _currentUser == null) {
      throw Exception('Sign in again to update your information.');
    }

    final response = await http.patch(
      Uri.parse('$_apiBaseUrl/barangay/profile'),
      headers: {
        'Authorization': 'Bearer $_token',
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: jsonEncode({'full_name': fullName, 'phone': phone}),
    );
    final data = Map<String, dynamic>.from(jsonDecode(response.body));
    if (response.statusCode != 200) {
      throw Exception(data['error'] ?? 'Could not update your information.');
    }

    final savedPhone = data['phone'] as String?;
    _currentUser = _currentUser!.copyWith(
      fullName: data['full_name'] as String? ?? fullName,
      phone: savedPhone,
    );
    await Hive.box(_authBoxName).put('user', _currentUser!.toJson());
    notifyListeners();
  }

  // URL for the prefilled Barangay Account Request PDF
  String getAuthorizationPdfUrl({bool download = false}) {
    final dlParam = download ? '&download=true' : '';
    final userParam = _currentUser?.id != null ? '&userId=${_currentUser!.id}' : '';
    return '$_apiBaseUrl/barangay/account-request/certificate?token=$_token$userParam$dlParam';
  }

  // Fetch prefilled certification data for in-app viewing & preview
  Future<Map<String, dynamic>> fetchCertificationData() async {
    final nowStr = DateTime.now().toIso8601String().substring(0, 10);
    final fallbackBarangay = _currentUser?.barangayName ?? 'Barangay';
    final fallbackName = _currentUser?.fullName ?? 'Barangay Administrator';
    final storedPosition = _currentUser?.positionDesignation?.trim() ?? '';
    final fallbackPosition = storedPosition.isEmpty || storedPosition.toLowerCase() == 'barangay dispatcher'
        ? 'Not provided'
        : storedPosition;
    final fallbackOfficial = _currentUser?.punongBarangayName ?? '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]';

    final defaultData = {
      'title': 'BARANGAY ACCOUNT REQUEST',
      'date': nowStr,
      'full_name': fallbackName,
      'position_designation': fallbackPosition,
      'barangay': fallbackBarangay,
      'municipality': 'Municipality of Norzagaray, Bulacan',
      'contact_info': _currentUser?.phone ?? '',
      'official_name': fallbackOfficial,
      'official_position': 'Punong Barangay / Authorized Barangay Official',
      'reference_no': '',
      'paragraphs': [
        fallbackPosition == 'Not provided'
            ? 'This is to certify that $fallbackName is the barangay administrator and an authorized representative of Barangay $fallbackBarangay, Municipality of Norzagaray, Bulacan, submitting a Barangay Account Request to the NorzAgapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay $fallbackBarangay.'
            : 'This is to certify that $fallbackName, serving as $fallbackPosition at Barangay $fallbackBarangay, is the barangay administrator submitting a Barangay Account Request to the NorzAgapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay $fallbackBarangay.',
        'The barangay administrator is responsible for managing authorized team accounts and ensuring they are used only for official emergency preparedness, incident reporting, and response coordination.',
        'All accounts belonging to the barangay will remain restricted until the MDRRMO verifies and activates this request. MDRRMO may deactivate barangay access at any time; the administrator may then submit a request to restore access.',
      ],
    };

    if (_token == null && _currentUser?.id == null) return defaultData;

    try {
      final userParam = _currentUser?.id != null ? '&userId=${_currentUser!.id}' : '';
      final res = await http.get(
        Uri.parse('$_apiBaseUrl/barangay/account-request/certificate-data?token=$_token$userParam'),
        headers: {
          if (_token != null) 'Authorization': 'Bearer $_token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
    } catch (_) {}

    return defaultData;
  }

  // Download PDF bytes directly and save to device local storage
  Future<File> downloadAuthorizationPdf() async {
    final url = getAuthorizationPdfUrl(download: true);
    final res = await http.get(
      Uri.parse(url),
      headers: {
        if (_token != null) 'Authorization': 'Bearer $_token',
        'ngrok-skip-browser-warning': 'true',
      },
    );

    if (res.statusCode != 200) {
      // Try to parse error message from server JSON
      String errMsg = 'Server returned status ${res.statusCode}';
      try {
        final json = jsonDecode(res.body);
        errMsg = json['error'] ?? errMsg;
      } catch (_) {}
      throw Exception(errMsg);
    }

    // Validate that the response is actually a PDF (not an error JSON)
    final contentType = res.headers['content-type'] ?? '';
    if (!contentType.contains('application/pdf')) {
      String errMsg = 'Unexpected response format from server';
      try {
        final json = jsonDecode(res.body);
        errMsg = json['error'] ?? errMsg;
      } catch (_) {}
      throw Exception(errMsg);
    }

    // Request storage permission on Android < 10
    if (Platform.isAndroid) {
      final status = await Permission.storage.status;
      if (status.isDenied) {
        await Permission.storage.request();
      }
    }

    // Use downloads dir if available, else fall back to app documents dir
    // (app documents dir never requires a storage permission)
    Directory? dir;
    try {
      dir = await getDownloadsDirectory();
    } catch (_) {}
    dir ??= await getApplicationDocumentsDirectory();

    final safeName =
        (_currentUser?.fullName ?? 'Administrator').replaceAll(RegExp(r'[^a-zA-Z0-9_]'), '_');
    final filePath = '${dir.path}/Barangay_Account_Request_$safeName.pdf';
    final file = File(filePath);
    await file.writeAsBytes(res.bodyBytes, flush: true);
    return file;
  }

  // Open a downloaded PDF file using the device's native PDF viewer
  Future<void> openPdfFile(String filePath) async {
    final result = await OpenFile.open(filePath, type: 'application/pdf');
    if (result.type != ResultType.done) {
      throw Exception('Could not open PDF: ${result.message}');
    }
  }

  // Barangay administrator submits the signed and sealed account request.
  Future<bool> submitCertificationFile({
    required String filePath,
    String? fileName,
  }) async {
    _isLoading = true;
    notifyListeners();

    try {
      final uri = Uri.parse('$_apiBaseUrl/barangay/account-request/certificate');
      final request = http.MultipartRequest('POST', uri);
      request.headers['Authorization'] = 'Bearer $_token';
      request.headers['ngrok-skip-browser-warning'] = 'true';

      request.files.add(
        await http.MultipartFile.fromPath('file', filePath, filename: fileName),
      );

      final streamedRes = await request.send();
      final res = await http.Response.fromStream(streamedRes);

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final ver = data['verification'];

        if (ver != null && _currentUser != null) {
          _currentUser = _currentUser!.copyWith(
            verificationStatus: ver['status'] ?? 'under_review',
            documentUrl: ver['document_url'],
            submittedAt: ver['submitted_at'],
            rejectionReason: null,
            verificationHistory: ver['verification_history'],
            clearRejectionReason: true,
          );

          final box = Hive.box(_authBoxName);
          await box.put('user', _currentUser!.toJson());
        }

        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        final data = jsonDecode(res.body);
        throw Exception(data['error'] ?? 'Submission failed');
      }
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  // Support submitting base64 (e.g. for web or when file bytes are directly in memory)
  Future<bool> submitCertificationBase64({
    required String base64Data,
    required String fileName,
  }) async {
    _isLoading = true;
    notifyListeners();

    try {
      final res = await http.post(
        Uri.parse('$_apiBaseUrl/barangay/account-request/certificate'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
          'ngrok-skip-browser-warning': 'true',
        },
        body: jsonEncode({
          'file_base64': base64Data,
          'file_name': fileName,
        }),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final ver = data['verification'];

        if (ver != null && _currentUser != null) {
          _currentUser = _currentUser!.copyWith(
            verificationStatus: ver['status'] ?? 'under_review',
            documentUrl: ver['document_url'],
            submittedAt: ver['submitted_at'],
            rejectionReason: null,
            verificationHistory: ver['verification_history'],
            clearRejectionReason: true,
          );

          final box = Hive.box(_authBoxName);
          await box.put('user', _currentUser!.toJson());
        }

        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        final data = jsonDecode(res.body);
        throw Exception(data['error'] ?? 'Submission failed');
      }
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  // Resubmit certification after rejection
  Future<bool> resubmitCertification() async {
    _isLoading = true;
    notifyListeners();

    try {
      final res = await http.post(
        Uri.parse('$_apiBaseUrl/barangay/account-request/resubmit'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_token',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final ver = data['verification'];

        if (ver != null && _currentUser != null) {
          _currentUser = _currentUser!.copyWith(
            verificationStatus: 'pending_document',
            rejectionReason: null,
            verificationHistory: ver['verification_history'],
            clearRejectionReason: true,
          );

          final box = Hive.box(_authBoxName);
          await box.put('user', _currentUser!.toJson());
        }

        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        final data = jsonDecode(res.body);
        throw Exception(data['error'] ?? 'Resubmission request failed');
      }
    } catch (e) {
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  // Real-time verification update from socket
  void onRealtimeVerificationUpdate(String status, {String? reason}) {
    if (_currentUser == null) return;
    _currentUser = _currentUser!.copyWith(
      verificationStatus: status,
      isActive: _currentUser!.isActive,
      rejectionReason: reason,
    );
    final box = Hive.box(_authBoxName);
    box.put('user', _currentUser!.toJson());
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      final box = Hive.box(_authBoxName);
      await box.clear();
    } catch (e) {
      debugPrint('Logout clear error: $e');
    }
    _token = null;
    _currentUser = null;
    notifyListeners();
    // AuthGate reacts to the state change above and redirects to LoginScreen.
    // No manual navigator.pop needed — it would conflict with the reactive rebuild.
  }
}
