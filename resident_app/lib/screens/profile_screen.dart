import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../services/offline_service.dart';
import '../services/resident_push_service.dart';
import '../core/barangay_names.dart';
import '../core/constants.dart';
import '../core/phone_number_utils.dart';
import '../widgets/legal_dialogs.dart';
import '../widgets/resident_gradient_app_bar.dart';
import 'my_reports_screen.dart';

class ProfileScreen extends StatefulWidget {
  final bool isInitialSetup;
  final VoidCallback? onAuthStateChanged;

  const ProfileScreen({
    super.key,
    this.isInitialSetup = false,
    this.onAuthStateChanged,
  });

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _isLoggedIn = false;
  Map<String, dynamic>? _userProfile;

  // Sign In / Register toggle for guests
  bool _isRegisterMode = false;
  bool _isSubmitting = false;
  int _registrationCooldownSeconds = 0;
  Timer? _registrationCooldownTimer;

  // Form Controllers
  final _signInFormKey = GlobalKey<FormState>();
  final _regFormKey = GlobalKey<FormState>();

  final _signInPhoneController = TextEditingController();
  final _signInPasswordController = TextEditingController();

  final _regNameController = TextEditingController();
  final _regContactController = TextEditingController();
  final _regPasswordController = TextEditingController();

  String? _selectedBarangayId;
  String? _selectedBarangayName;
  List<Map<String, dynamic>> _verifiedBarangays = [];

  @override
  void initState() {
    super.initState();
    _loadProfileState();
    _loadVerifiedBarangays();
  }

  void _loadProfileState() {
    final profile = OfflineService.getProfile();
    final loggedIn = OfflineService.isLoggedIn();
    setState(() {
      _isLoggedIn = loggedIn;
      _userProfile = profile;
      if (profile != null) {
        _selectedBarangayId = profile['barangay_id'];
        _selectedBarangayName = profile['barangay_name'];
      }
      _selectedBarangayName ??= 'Poblacion';
    });
  }

  Future<void> _saveBarangayPreference(String barangayName) async {
    final matches = _verifiedBarangays.where(
      (barangay) => barangay['name']?.toString().toLowerCase() == barangayName.toLowerCase(),
    );
    final match = matches.isEmpty ? null : matches.first;
    if (match == null) return;
    final currentProfile = OfflineService.getProfile() ?? {};

    await OfflineService.saveProfile({
      ...currentProfile,
      'barangay_name': barangayName,
      'barangay_id': match['id']?.toString(),
      'is_logged_in': _isLoggedIn,
    });

    if (mounted) {
      setState(() {
        _selectedBarangayName = barangayName;
        _selectedBarangayId = match['id']?.toString();
        _userProfile = OfflineService.getProfile();
      });
      // Rebuild Home so its dropdown default follows the saved Profile value.
      widget.onAuthStateChanged?.call();
    }

    if (_isLoggedIn) {
      final token = currentProfile['token'] as String?;
      if (token == null || token.isEmpty) {
        _showBarangaySaveMessage('Barangay saved on this device; sign in again to sync it to your account.');
        return;
      }
      try {
        final response = await http.patch(
          Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/profile'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: jsonEncode({'barangay_name': barangayName}),
        ).timeout(const Duration(seconds: 20));
        if (response.statusCode != 200) {
          throw Exception('Server returned ${response.statusCode}');
        }
        _showBarangaySaveMessage('Profile barangay updated.');
      } catch (_) {
        _showBarangaySaveMessage('Saved on this device, but could not sync to your account.');
      }
    } else {
      _showBarangaySaveMessage('Profile barangay saved on this device.');
    }
  }

  Future<void> _loadVerifiedBarangays() async {
    final cached = OfflineService.getCachedBarangays()
        .where((barangay) => barangay['is_verified'] == true)
        .toList();
    if (mounted && cached.isNotEmpty) {
      setState(() => _verifiedBarangays = cached);
      _selectAvailableBarangay();
    }
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/barangay/list?verified_only=true'),
        headers: {'ngrok-skip-browser-warning': 'true'},
      ).timeout(const Duration(seconds: 12));
      if (response.statusCode == 200) {
        final items = (jsonDecode(response.body) as List)
            .map((item) => Map<String, dynamic>.from(item))
            .where((item) => item['is_verified'] == true)
            .toList();
        await OfflineService.saveBarangays(items);
        if (mounted) setState(() => _verifiedBarangays = items);
        _selectAvailableBarangay();
      }
    } catch (_) {
      // Keep local settings usable when offline; the selection can sync later.
    }
  }

  void _selectAvailableBarangay() {
    if (_verifiedBarangays.isEmpty) return;
    final valid = _verifiedBarangays.any((barangay) =>
        barangay['name']?.toString() == _selectedBarangayName &&
        (_selectedBarangayId == null || barangay['id']?.toString() == _selectedBarangayId));
    if (!valid) {
      final first = _verifiedBarangays.first;
      _selectedBarangayName = first['name']?.toString();
      _selectedBarangayId = first['id']?.toString();
    }
  }

  void _showBarangaySaveMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _buildBarangaySelector() {
    if (_verifiedBarangays.isEmpty) {
      return const InputDecorator(
        decoration: InputDecoration(
          labelText: 'Barangay of Residence',
          prefixIcon: Icon(Icons.location_city_rounded, color: Color(0xFF1B4F72)),
          border: OutlineInputBorder(),
        ),
        child: Text('No MDRRMO-verified barangays are available.'),
      );
    }
    final availableNames = _verifiedBarangays.map((barangay) => barangay['name'].toString()).toList();
    final value = availableNames.contains(_selectedBarangayName) ? _selectedBarangayName : availableNames.first;
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: InputDecoration(
        labelText: 'Barangay of Residence',
        prefixIcon: const Icon(Icons.location_city_rounded, color: Color(0xFF1B4F72)),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        filled: true,
        fillColor: Colors.white,
      ),
      items: availableNames
          .map(
            (name) => DropdownMenuItem(
              value: name,
              child: Text(barangayDisplayLabel(name)),
            ),
          )
          .toList(),
      onChanged: (name) {
        if (name != null && name != _selectedBarangayName) {
          _saveBarangayPreference(name);
        }
      },
    );
  }

  Future<void> _handleSignIn() async {
    if (!_signInFormKey.currentState!.validate()) return;

    final phone = PhoneNumberUtils.digitsOnly(_signInPhoneController.text);
    final password = _signInPasswordController.text;

    setState(() => _isSubmitting = true);
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/login'),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: jsonEncode({
          'phone': phone,
          'password': password,
        }),
      ).timeout(const Duration(seconds: 30));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        final user = data['user'] ?? {};
        final token = data['token'] as String?;
        await OfflineService.saveProfile({
          'user_id': user['id'],
          'contact_number': user['phone'] ?? '',
          'full_name': user['full_name'] ?? 'Resident Citizen',
          'barangay_name': user['barangay_name'] ?? 'Poblacion',
          'token': token,
          'is_logged_in': true,
        });
        _onLoginSuccess('Logged in successfully!');
        return;
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(data['error'] ?? 'Invalid mobile number or password.'),
              backgroundColor: const Color(0xFFEF4444),
            ),
          );
        }
        return;
      }
    } catch (e) {
      debugPrint('Resident login request failed: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not sign in. Check your internet connection and try again.'),
            backgroundColor: Color(0xFFEF4444),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _showForgotPasswordDialog() async {
    final phoneController = TextEditingController(text: _signInPhoneController.text.trim());
    final otpController = TextEditingController();
    final passwordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    var otpSent = false;
    var isSubmitting = false;
    String? errorMessage;
    String? deliveryMessage;

    try {
      final reset = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('Forgot Password'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('We will send a verification code by SMS to your mobile number.'),
                  const SizedBox(height: 14),
                  TextField(
                    controller: phoneController,
                    keyboardType: TextInputType.phone,
                    inputFormatters: PhoneNumberUtils.inputFormatters,
                    enabled: !otpSent,
                    decoration: const InputDecoration(labelText: 'Mobile number', hintText: '09XXXXXXXXX', prefixIcon: Icon(Icons.phone_outlined)),
                  ),
                  if (otpSent) ...[
                    const SizedBox(height: 12),
                    Text(deliveryMessage ?? 'Enter the verification code sent by SMS.'),
                    TextField(controller: otpController, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: '6-digit SMS code')),
                    TextField(controller: passwordController, obscureText: true, decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 8 characters')),
                    TextField(controller: confirmPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm new password')),
                  ],
                  if (errorMessage != null) ...[
                    const SizedBox(height: 10),
                    Text(errorMessage!, style: const TextStyle(color: Color(0xFFDC2626))),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: isSubmitting ? null : () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
              FilledButton(
                onPressed: isSubmitting ? null : () async {
                  final phone = PhoneNumberUtils.digitsOnly(phoneController.text);
                  setDialogState(() { isSubmitting = true; errorMessage = null; });
                  var completed = false;
                  try {
                    if (!otpSent) {
                      if (!PhoneNumberUtils.isValid(phone)) throw 'Enter a valid 11-digit mobile number starting with 09.';
                      final response = await http.post(
                        Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/forgot-password-otp'),
                        headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
                        body: jsonEncode({'phone': phone}),
                      ).timeout(const Duration(seconds: 30));
                      final data = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
                      if (response.statusCode != 200) throw data['error'] ?? 'Could not send the code.';
                      setDialogState(() { otpSent = true; deliveryMessage = data['message']?.toString() ?? 'A verification code was sent by SMS.'; });
                    } else {
                      final otp = otpController.text.trim();
                      final password = passwordController.text;
                      if (otp.length != 6) throw 'Enter the 6-digit verification code.';
                      if (password.length < 8) throw 'Password must be at least 8 characters.';
                      if (password != confirmPasswordController.text) throw 'The passwords do not match.';
                      final response = await http.post(
                        Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/forgot-password'),
                        headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
                        body: jsonEncode({'phone': phone, 'otp': otp, 'new_password': password}),
                      ).timeout(const Duration(seconds: 30));
                      final data = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
                      if (response.statusCode != 200) throw data['error'] ?? 'Could not reset password.';
                      completed = true;
                    }
                  } catch (error) {
                    errorMessage = error.toString();
                  } finally {
                    if (dialogContext.mounted) setDialogState(() => isSubmitting = false);
                  }
                  if (completed && dialogContext.mounted) Navigator.pop(dialogContext, true);
                },
                child: isSubmitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(otpSent ? 'Reset Password' : 'Send SMS Code'),
              ),
            ],
          ),
        ),
      );
      if (reset == true && mounted) {
        _signInPhoneController.text = PhoneNumberUtils.digitsOnly(phoneController.text);
        _signInPasswordController.clear();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password reset. Sign in with your new password.'), backgroundColor: Color(0xFF16A34A)));
      }
    } finally {
      phoneController.dispose();
      otpController.dispose();
      passwordController.dispose();
      confirmPasswordController.dispose();
    }
  }
  Future<void> _handleRegister() async {
    if (_registrationCooldownSeconds > 0 || !_regFormKey.currentState!.validate()) return;
    final fullName = _regNameController.text.trim();
    final phone = PhoneNumberUtils.digitsOnly(_regContactController.text);
    final password = _regPasswordController.text;
    final barangayName = _selectedBarangayName ?? 'Poblacion';
    setState(() => _isSubmitting = true);
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/register-otp'),
        headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
        body: jsonEncode({'full_name': fullName, 'phone': phone, 'password': password, 'barangay_name': barangayName}),
      ).timeout(const Duration(seconds: 30));
      final data = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
      if (response.statusCode != 200) throw data['error'] ?? 'Failed to send verification code';
      if (!mounted) return;
      await _showRegistrationOtpDialog(phone: phone, fullName: fullName, barangayName: barangayName);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not send the verification code: $error'), backgroundColor: const Color(0xFFDC2626)));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _showRegistrationOtpDialog({
    required String phone,
    required String fullName,
    required String barangayName,
  }) async {
    final otpController = TextEditingController();
    bool isVerifying = false;
    bool isResending = false;
    bool timerStarted = false;
    int cooldown = 60;
    Timer? resendTimer;
    String? errorMessage;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          if (!timerStarted) {
            timerStarted = true;
            resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
              if (!ctx.mounted) { timer.cancel(); return; }
              if (cooldown <= 1) { timer.cancel(); setDialogState(() => cooldown = 0); }
              else { setDialogState(() => cooldown--); }
            });
          }
          return AlertDialog(
            title: const Text('SMS Verification'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Enter the 6-digit verification code sent to ${PhoneNumberUtils.formatForDisplay(phone)}.'),
                const SizedBox(height: 12),
                TextField(controller: otpController, keyboardType: TextInputType.number, maxLength: 6, textAlign: TextAlign.center, decoration: const InputDecoration(labelText: 'Verification code')),
                if (errorMessage != null) Text(errorMessage!, style: const TextStyle(color: Color(0xFFDC2626))),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: isVerifying || isResending || cooldown > 0 ? null : () async {
                      setDialogState(() { isResending = true; errorMessage = null; });
                      try {
                        final response = await http.post(
                          Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/register-otp'),
                          headers: {'Content-Type': 'application/json'},
                          body: jsonEncode({'full_name': fullName, 'phone': phone, 'password': _regPasswordController.text, 'barangay_name': barangayName}),
                        ).timeout(const Duration(seconds: 30));
                        final data = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
                        if (response.statusCode != 200) throw data['error'] ?? 'Failed to resend verification code';
                        setDialogState(() { isResending = false; cooldown = 60; errorMessage = 'A new SMS code was sent.'; });
                        resendTimer?.cancel();
                        resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
                          if (!ctx.mounted) { timer.cancel(); return; }
                          if (cooldown <= 1) { timer.cancel(); setDialogState(() => cooldown = 0); }
                          else { setDialogState(() => cooldown--); }
                        });
                      } catch (error) { setDialogState(() { isResending = false; errorMessage = 'Could not resend code: $error'; }); }
                    },
                    child: Text(cooldown > 0 ? 'Resend code (${cooldown}s)' : 'Resend code'),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: isVerifying || isResending ? null : () { _startRegistrationCooldown(); Navigator.pop(dialogContext); }, child: const Text('Cancel')),
              FilledButton(
                onPressed: isVerifying || isResending ? null : () async {
                  final otp = otpController.text.trim();
                  if (otp.length != 6) { setDialogState(() => errorMessage = 'Enter the complete 6-digit code.'); return; }
                  setDialogState(() { isVerifying = true; errorMessage = null; });
                  try {
                    final response = await http.post(
                      Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/verify-register-otp'),
                      headers: {'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true'},
                      body: jsonEncode({'phone': phone, 'otp': otp}),
                    ).timeout(const Duration(seconds: 30));
                    final data = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
                    if (response.statusCode != 200 && response.statusCode != 201) throw data['error'] ?? 'Verification failed';
                    final token = data['token']?.toString();
                    final user = Map<String, dynamic>.from(data['user'] ?? {});
                    await OfflineService.saveProfile({
                      'user_id': user['id'],
                      'full_name': user['full_name'] ?? fullName,
                      'contact_number': user['phone'] ?? phone,
                      'barangay_name': user['barangay_name'] ?? barangayName,
                      'token': token,
                      'is_logged_in': true,
                    });
                    if (!dialogContext.mounted) return;
                    Navigator.pop(dialogContext);
                    _onLoginSuccess('Resident account created.');
                  } catch (error) {
                    if (!dialogContext.mounted) return;
                    setDialogState(() { isVerifying = false; errorMessage = error.toString(); });
                  }
                },
                child: isVerifying ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Verify and create account'),
              ),
            ],
          );
        },
      ),
    );
    resendTimer?.cancel();
    otpController.dispose();
  }
  void _startRegistrationCooldown() {
    _registrationCooldownTimer?.cancel();
    if (!mounted) return;
    setState(() => _registrationCooldownSeconds = 60);
    _registrationCooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted || _registrationCooldownSeconds <= 1) {
        timer.cancel();
        if (mounted) setState(() => _registrationCooldownSeconds = 0);
      } else {
        setState(() => _registrationCooldownSeconds--);
      }
    });
  }

  Future<void> _showChangePasswordDialog() async {
    final otpController = TextEditingController();
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    var otpSent = false;
    var isSubmitting = false;
    String? errorMessage;
    String? successMessage;
    final token = _userProfile?['token']?.toString() ?? '';

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Change Password'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Verify your current password with a code sent by SMS.'),
                const SizedBox(height: 12),
                if (!otpSent) TextField(controller: currentPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')),
                if (otpSent) ...[
                  if (successMessage != null) Text(successMessage!, style: const TextStyle(color: Color(0xFF15803D))),
                  TextField(controller: currentPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')),
                  TextField(controller: otpController, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: '6-digit SMS code')),
                  TextField(controller: newPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 8 characters')),
                  TextField(controller: confirmPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm new password')),
                ],
                if (errorMessage != null) ...[
                  const SizedBox(height: 10),
                  Text(errorMessage!, style: const TextStyle(color: Color(0xFFDC2626))),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: isSubmitting ? null : () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            if (!otpSent)
              FilledButton(
                onPressed: isSubmitting ? null : () async {
                  final currentPassword = currentPasswordController.text;
                  if (currentPassword.isEmpty || token.isEmpty) { setDialogState(() => errorMessage = 'Sign in again and enter your current password.'); return; }
                  setDialogState(() { isSubmitting = true; errorMessage = null; });
                  try {
                    final response = await http.post(
                      Uri.parse('${AppConstants.apiBaseUrl}/auth/profile/password-otp'),
                      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'},
                      body: jsonEncode({'current_password': currentPassword}),
                    ).timeout(const Duration(seconds: 30));
                    final data = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
                    if (response.statusCode != 200) throw data['error'] ?? 'Could not send the verification code.';
                    setDialogState(() { otpSent = true; isSubmitting = false; successMessage = data['message']?.toString() ?? 'SMS verification code sent.'; });
                  } catch (error) { setDialogState(() { isSubmitting = false; errorMessage = error.toString(); }); }
                },
                child: isSubmitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Send SMS code'),
              )
            else
              FilledButton(
                onPressed: isSubmitting ? null : () async {
                  final currentPassword = currentPasswordController.text;
                  final otp = otpController.text.trim();
                  final newPassword = newPasswordController.text;
                  if (otp.length != 6) { setDialogState(() => errorMessage = 'Enter the 6-digit verification code.'); return; }
                  if (newPassword.length < 8) { setDialogState(() => errorMessage = 'New password must be at least 8 characters.'); return; }
                  if (newPassword != confirmPasswordController.text) { setDialogState(() => errorMessage = 'New passwords do not match.'); return; }
                  setDialogState(() { isSubmitting = true; errorMessage = null; });
                  try {
                    final response = await http.post(
                      Uri.parse('${AppConstants.apiBaseUrl}/auth/profile/change-password'),
                      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'},
                      body: jsonEncode({'otp': otp, 'current_password': currentPassword, 'new_password': newPassword}),
                    ).timeout(const Duration(seconds: 30));
                    final data = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
                    if (response.statusCode != 200) throw data['error'] ?? 'Failed to update password.';
                    if (!dialogContext.mounted) return;
                    Navigator.pop(dialogContext);
                    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password updated successfully.'), backgroundColor: Color(0xFF16A34A)));
                  } catch (error) { setDialogState(() { isSubmitting = false; errorMessage = error.toString(); }); }
                },
                child: isSubmitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Update password'),
              ),
          ],
        ),
      ),
    );
    otpController.dispose();
    currentPasswordController.dispose();
    newPasswordController.dispose();
    confirmPasswordController.dispose();
  }
  void _onLoginSuccess(String message) {
    _loadProfileState();
    widget.onAuthStateChanged?.call();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: const Color(0xFF27AE60),
        ),
      );
    }
  }

  Future<void> _handleLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Log Out', style: TextStyle(fontWeight: FontWeight.bold)),
        content: const Text('Are you sure you want to log out of your resident account?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF64748B))),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              elevation: 0,
            ),
            child: const Text('Log Out'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final authToken = OfflineService.getProfile()?['token']?.toString();
      if (authToken != null && authToken.isNotEmpty) {
        await ResidentPushService.instance.unregisterForResident(authToken);
      }
      await OfflineService.logout();
      _loadProfileState();
      widget.onAuthStateChanged?.call();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Logged out of resident account')),
        );
      }
    }
  }

  Future<void> _showDebugAccounts() async {
    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/debug/accounts?audience=resident'),
        headers: {'ngrok-skip-browser-warning': 'true'},
      ).timeout(const Duration(seconds: 15));
      final data = jsonDecode(response.body);
      if (response.statusCode != 200) throw data['error'] ?? 'Debug quick login unavailable';
      final accounts = (data['accounts'] as List)
          .map((account) => Map<String, dynamic>.from(account))
          .toList();

      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
          child: SizedBox(
            height: 380,
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'Quick Test Accounts',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: accounts.length,
                    itemBuilder: (_, index) {
                      final acc = accounts[index];
                      return ListTile(
                        leading: const CircleAvatar(
                          backgroundColor: Color(0xFF1B4F72),
                          child: Icon(Icons.person, color: Colors.white),
                        ),
                        title: Text(acc['full_name'] ?? 'Resident'),
                        subtitle: Text(acc['phone'] ?? 'No mobile number'),
                        onTap: () async {
                          try {
                            final loginResponse = await http.post(
                              Uri.parse('${AppConstants.apiBaseUrl}/debug/quick-login'),
                              headers: {
                                'Content-Type': 'application/json',
                                'ngrok-skip-browser-warning': 'true',
                              },
                              body: jsonEncode({
                                'accountId': acc['id'],
                                'audience': 'resident',
                              }),
                            ).timeout(const Duration(seconds: 15));
                            final loginData = jsonDecode(loginResponse.body);
                            if (loginResponse.statusCode != 200) {
                              throw loginData['error'] ?? 'Quick login failed';
                            }

                            final user = Map<String, dynamic>.from(loginData['user'] ?? acc);
                            await OfflineService.saveProfile({
                              'user_id': user['id'] ?? acc['id'],
                              'full_name': user['full_name'] ?? 'Resident',
                              'contact_number': user['phone'] ?? '',
                              'barangay_name': user['barangay_name'] ?? 'Poblacion',
                              'token': loginData['token'],
                              'is_logged_in': true,
                            });
                            if (!sheetContext.mounted) return;
                            Navigator.pop(sheetContext);
                            _onLoginSuccess('Logged in as ${user['full_name'] ?? 'Resident'}');
                          } catch (error) {
                            if (!sheetContext.mounted) return;
                            ScaffoldMessenger.of(sheetContext).showSnackBar(
                              SnackBar(content: Text('Quick login failed: $error')),
                            );
                          }
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Debug quick login unavailable: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: ResidentGradientAppBar(
        title: Text(
          _isLoggedIn ? 'Profile' : 'Resident Portal',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 19),
        ),
      ),
      body: _isLoggedIn ? _buildLoggedInView() : _buildLoggedOutView(),
    );
  }

  // ── 1. Logged In Profile View ──────────────────────────────────────────────
  // User personal details: Name, Mobile number, Barangay
  // Below is My Reports
  // Below is Settings with 2 buttons (Terms and Conditions & Privacy Policy)
  // Below is Log Out
  Widget _buildLoggedInView() {
    final name = _userProfile?['full_name'] ?? 'Resident Citizen';
    final storedContact = _userProfile?['contact_number']?.toString() ?? '';
    final contact = storedContact.isEmpty
        ? 'Not specified'
        : PhoneNumberUtils.formatForDisplay(storedContact);

    final initials = name.isNotEmpty
        ? name.trim().split(' ').map((s) => s.isNotEmpty ? s[0] : '').take(2).join()
        : 'RZ';

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── User Header Card ───────────────────────────────────────────────
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1B4F72), Color(0xFF0F3249)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF1B4F72).withValues(alpha: 0.25),
                  blurRadius: 14,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundColor: Colors.white.withValues(alpha: 0.2),
                  child: Text(
                    initials.toUpperCase(),
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF22C55E).withValues(alpha: 0.25),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFF22C55E).withValues(alpha: 0.4)),
                        ),
                        child: const Text(
                          'Verified Resident',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF86EFAC),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),

          // ── Personal Details Section ───────────────────────────────────────
          const Text(
            'Personal Details',
            style: TextStyle(
              fontSize: 15.5,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 10),
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              children: [
                _DetailRow(icon: Icons.person_rounded, label: 'Full Name', value: name),
                const Divider(height: 1),
                _DetailRow(icon: Icons.phone_rounded, label: 'Contact Number', value: contact),
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
                  child: Column(children: [
                    _buildBarangaySelector(),
                  ]),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),

          // ── My Reports Section ─────────────────────────────────────────────
          const Text(
            'Incident Activity',
            style: TextStyle(
              fontSize: 15.5,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 10),
          Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const MyReportsScreen()),
              ),
              borderRadius: BorderRadius.circular(16),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: Color(0xFFEFF6FF),
                      child: Icon(Icons.assignment_rounded, color: Color(0xFF2563EB)),
                    ),
                    SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'My Submitted Reports',
                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'View status, evidence, and responder action on your reports',
                            style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right_rounded, color: Color(0xFF94A3B8)),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // ── Settings (Terms and Conditions, Privacy Policy, Change Password)
          _buildSettingsSection(isLoggedIn: true),
          const SizedBox(height: 28),

          // ── Log Out Button ─────────────────────────────────────────────────
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton.icon(
              onPressed: _handleLogout,
              icon: const Icon(Icons.logout_rounded, size: 18),
              label: const Text('Log Out'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFEF2F2),
                foregroundColor: const Color(0xFFDC2626),
                elevation: 0,
                side: const BorderSide(color: Color(0xFFFCA5A5)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14.5),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── 2. Logged Out View (Login & Account Creation) ──────────────────────────
  Widget _buildLoggedOutView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      child: Column(
        children: [
          // Header Illustration / Logo
          InkWell(
            onTap: _showDebugAccounts,
            borderRadius: BorderRadius.circular(20),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.account_circle_rounded,
                size: 64,
                color: Color(0xFF1B4F72),
              ),
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'Sign In to Report Incidents',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Login is required before reporting emergencies to MDRRMO.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Color(0xFF64748B), height: 1.4),
          ),
          const SizedBox(height: 20),

          _buildBarangaySelector(),
          const SizedBox(height: 20),

          // Sign In / Create Account Toggle
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: const Color(0xFFE2E8F0),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => _isRegisterMode = false),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: !_isRegisterMode ? Colors.white : Colors.transparent,
                        borderRadius: BorderRadius.circular(10),
                        boxShadow: !_isRegisterMode
                            ? [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.05),
                                  blurRadius: 4,
                                )
                              ]
                            : null,
                      ),
                      child: Text(
                        'Sign In',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: !_isRegisterMode ? const Color(0xFF1B4F72) : const Color(0xFF64748B),
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => _isRegisterMode = true),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: _isRegisterMode ? Colors.white : Colors.transparent,
                        borderRadius: BorderRadius.circular(10),
                        boxShadow: _isRegisterMode
                            ? [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.05),
                                  blurRadius: 4,
                                )
                              ]
                            : null,
                      ),
                      child: Text(
                        'Create Account',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: _isRegisterMode ? const Color(0xFF1B4F72) : const Color(0xFF64748B),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),

          // Render Selected Form
          if (!_isRegisterMode) _buildSignInForm() else _buildRegisterForm(),

          const SizedBox(height: 24),
          // ── Settings (Visible also when not logged in)
          _buildSettingsSection(isLoggedIn: false),

          const SizedBox(height: 20),
          // Quick Debug Accounts Button for testing
          TextButton.icon(
            onPressed: _showDebugAccounts,
            icon: const Icon(Icons.bolt_rounded, size: 18),
            label: const Text('Quick Test Account Login'),
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFF0D9488),
            ),
          ),
        ],
      ),
    );
  }

  // ── Settings Section (Accessible both logged in and logged out) ────────────
  Widget _buildSettingsSection({required bool isLoggedIn}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Settings & Policies',
          style: TextStyle(
            fontSize: 15.5,
            fontWeight: FontWeight.bold,
            color: Color(0xFF0F172A),
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            children: [
              // Button 1: Terms and Conditions
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton.icon(
                  onPressed: () => LegalDialogs.showTermsAndConditions(context),
                  icon: const Icon(Icons.description_outlined, size: 18),
                  label: const Text('Terms and Conditions'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF1B4F72),
                    side: const BorderSide(color: Color(0xFFCBD5E1)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                ),
              ),
              const SizedBox(height: 10),

              // Button 2: Privacy Policy
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton.icon(
                  onPressed: () => LegalDialogs.showPrivacyPolicy(context),
                  icon: const Icon(Icons.privacy_tip_outlined, size: 18),
                  label: const Text('Privacy Policy'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF0D9488),
                    side: const BorderSide(color: Color(0xFFCBD5E1)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                ),
              ),

              // Password changes require SMS verification.
              if (isLoggedIn) ...[
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: OutlinedButton.icon(
                    onPressed: _showChangePasswordDialog,
                    icon: const Icon(Icons.lock_reset_rounded, size: 18),
                    label: const Text('Change Password'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFD97706),
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      alignment: Alignment.centerLeft,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ── Sign In Form ───────────────────────────────────────────────────────────
  Widget _buildSignInForm() {
    return Form(
      key: _signInFormKey,
      child: Column(
        children: [
          TextFormField(
            controller: _signInPhoneController,
            keyboardType: TextInputType.phone,
            inputFormatters: PhoneNumberUtils.inputFormatters,
            decoration: InputDecoration(
              labelText: 'Mobile number',
              hintText: '09XXXXXXXXX',
              prefixIcon: const Icon(Icons.phone_rounded, color: Color(0xFF1B4F72)),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            validator: (v) {
              return PhoneNumberUtils.validationMessage(v);
            },
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _signInPasswordController,
            obscureText: true,
            decoration: InputDecoration(
              labelText: 'Password',
              hintText: 'Enter your password',
              prefixIcon: const Icon(Icons.lock_rounded, color: Color(0xFF1B4F72)),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            validator: (v) => v == null || v.isEmpty ? 'Password is required' : null,
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton(
              onPressed: _isSubmitting ? null : _handleSignIn,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1B4F72),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                elevation: 1,
              ),
              child: _isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Sign In', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: _isSubmitting ? null : _showForgotPasswordDialog,
              child: const Text('Forgot password?'),
            ),
          ),
        ],
      ),
    );
  }

  // ── Create Account Form ──────────────────────────────────────────────────
  Widget _buildRegisterForm() {
    return Form(
      key: _regFormKey,
      child: Column(
        children: [
          TextFormField(
            controller: _regNameController,
            decoration: InputDecoration(
              labelText: 'Full Name',
              hintText: 'e.g. Juan Dela Cruz',
              prefixIcon: const Icon(Icons.person_outline, color: Color(0xFF1B4F72)),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            validator: (value) => value == null || value.trim().length < 2 ? 'Enter your full name' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _regContactController,
            keyboardType: TextInputType.phone,
            inputFormatters: PhoneNumberUtils.inputFormatters,
            decoration: InputDecoration(
              labelText: 'Mobile number',
              hintText: '09XXXXXXXXX',
              prefixIcon: const Icon(Icons.phone_rounded, color: Color(0xFF1B4F72)),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            validator: PhoneNumberUtils.validationMessage,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _regPasswordController,
            obscureText: true,
            decoration: InputDecoration(
              labelText: 'Password',
              helperText: 'At least 8 characters',
              prefixIcon: const Icon(Icons.lock_rounded, color: Color(0xFF1B4F72)),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            validator: (value) => value == null || value.length < 8 ? 'Password must be at least 8 characters' : null,
          ),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerLeft,
            child: Text('We will send a one-time verification code by SMS.', style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton(
              onPressed: _isSubmitting || _registrationCooldownSeconds > 0 ? null : _handleRegister,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1B4F72),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                elevation: 1,
              ),
              child: _isSubmitting
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(_registrationCooldownSeconds > 0 ? 'Create Account (${_registrationCooldownSeconds}s)' : 'Create Account', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }
  @override
  void dispose() {
    _signInPhoneController.dispose();
    _signInPasswordController.dispose();
    _regNameController.dispose();
    _regContactController.dispose();
    _regPasswordController.dispose();
    _registrationCooldownTimer?.cancel();
    super.dispose();
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Icon(icon, size: 20, color: const Color(0xFF1B4F72)),
          const SizedBox(width: 14),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF0F172A)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
