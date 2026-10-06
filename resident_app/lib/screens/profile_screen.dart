import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../services/offline_service.dart';
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
  String _registrationOtpChannel = 'email';

  // Form Controllers
  final _signInFormKey = GlobalKey<FormState>();
  final _regFormKey = GlobalKey<FormState>();

  final _signInContactController = TextEditingController();
  final _signInPasswordController = TextEditingController();

  final _regNameController = TextEditingController();
  final _regContactController = TextEditingController();
  final _regEmailController = TextEditingController();

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
      'barangay_id': match?['id']?.toString(),
      'is_logged_in': _isLoggedIn,
    });

    if (mounted) {
      setState(() {
        _selectedBarangayName = barangayName;
        _selectedBarangayId = match?['id']?.toString();
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

    final email = _signInContactController.text.trim().toLowerCase();
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
          'email': email,
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
          'email': user['email'] ?? email,
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
              content: Text(data['error'] ?? 'Invalid email or password.'),
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

  Future<void> _handleRegister() async {
    if (_registrationCooldownSeconds > 0) return;
    if (!_regFormKey.currentState!.validate()) return;

    final fullName = _regNameController.text.trim();
    final contact = _regContactController.text.trim();
    final email = _regEmailController.text.trim().toLowerCase();
    final barangayName = _selectedBarangayName ?? 'Poblacion';

    setState(() => _isSubmitting = true);

    try {
      final response = await http.post(
        Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/register-otp'),
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: jsonEncode({
          'full_name': fullName,
          'contact_number': contact,
          'email': email,
          'barangay_name': barangayName,
          'barangay_id': _selectedBarangayId,
          'delivery_method': _registrationOtpChannel,
        }),
      ).timeout(const Duration(seconds: 30));

      final data = jsonDecode(response.body);
      if (response.statusCode != 200) {
        throw data['error'] ?? 'Failed to send verification code';
      }

      if (!mounted) return;
      _showRegistrationOtpDialog(
        email: email,
        fullName: fullName,
        contact: contact,
        barangayName: barangayName,
        deliveryMethod: _registrationOtpChannel,
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not send the verification code: $e'),
          backgroundColor: const Color(0xFFDC2626),
        ),
      );
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _showRegistrationOtpDialog({
    required String email,
    required String fullName,
    required String contact,
    required String barangayName,
    required String deliveryMethod,
  }) async {
    final isSms = deliveryMethod == 'sms';
    final destination = isSms ? contact : email;
    final otpController = TextEditingController();
    bool isVerifying = false;
    bool isResending = false;
    bool resendTimerStarted = false;
    int resendCooldownSeconds = 60;
    Timer? resendTimer;
    String? errorMessage;

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          if (!resendTimerStarted) {
            resendTimerStarted = true;
            resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
              if (!ctx.mounted) {
                timer.cancel();
                return;
              }
              if (resendCooldownSeconds <= 1) {
                timer.cancel();
                setDialogState(() => resendCooldownSeconds = 0);
              } else {
                setDialogState(() => resendCooldownSeconds--);
              }
            });
          }
          return AlertDialog(
            backgroundColor: const Color(0xFFE7EAF1),
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            contentPadding: const EdgeInsets.fromLTRB(24, 18, 24, 24),
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF5F8FC),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    isSms ? Icons.sms_rounded : Icons.mark_email_read_rounded,
                    color: const Color(0xFF1B4F72),
                    size: 27,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    isSms ? 'SMS Verification' : 'Email Verification',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 21, color: Color(0xFF171B20)),
                  ),
                ),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'We sent a 6-digit verification code to your ${isSms ? 'mobile number' : 'email address'}:',
                    style: TextStyle(fontSize: 15, color: Color(0xFF70757C)),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    destination,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Color(0xFF1B4F72)),
                  ),
                  const SizedBox(height: 18),
                  TextFormField(
                    controller: otpController,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 9,
                      color: Color(0xFF0F172A),
                    ),
                    decoration: InputDecoration(
                      hintText: '••••••',
                      counterText: '',
                      filled: true,
                      fillColor: const Color(0xFFF8FAFC),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: const BorderSide(color: Color(0xFF555B63), width: 1.4),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: const BorderSide(color: Color(0xFF1B4F72), width: 2),
                      ),
                    ),
                  ),
                  if (errorMessage != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      errorMessage!,
                      style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12.5, fontWeight: FontWeight.w600),
                    ),
                  ],
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Code expires in 10 mins',
                        style: const TextStyle(fontSize: 12, color: Color(0xFF92979E)),
                      ),
                      TextButton(
                        onPressed: isVerifying || isResending || resendCooldownSeconds > 0
                            ? null
                            : () async {
                                setDialogState(() {
                                  errorMessage = null;
                                  isResending = true;
                                });
                                try {
                                  final response = await http.post(
                                    Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/register-otp'),
                                    headers: {'Content-Type': 'application/json'},
                                    body: jsonEncode({
                                      'full_name': fullName,
                                      'contact_number': contact,
                                      'email': email,
                                      'barangay_name': barangayName,
                                      'barangay_id': _selectedBarangayId,
                                      'delivery_method': deliveryMethod,
                                    }),
                                  ).timeout(const Duration(seconds: 30));
                                  final data = jsonDecode(response.body);
                                  if (response.statusCode != 200) {
                                    throw data['error'] ?? 'Failed to resend verification code';
                                  }
                                  setDialogState(() {
                                    isResending = false;
                                    resendCooldownSeconds = 60;
                                    errorMessage = 'A new code has been sent to your ${isSms ? 'mobile number' : 'email'}.';
                                  });
                                  resendTimer?.cancel();
                                  resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
                                    if (!ctx.mounted) {
                                      timer.cancel();
                                      return;
                                    }
                                    if (resendCooldownSeconds <= 1) {
                                      timer.cancel();
                                      setDialogState(() => resendCooldownSeconds = 0);
                                    } else {
                                      setDialogState(() => resendCooldownSeconds--);
                                    }
                                  });
                                } catch (e) {
                                  setDialogState(() {
                                    isResending = false;
                                    errorMessage = 'Could not resend code: $e';
                                  });
                                }
                              },
                        child: Text(
                          resendCooldownSeconds > 0
                              ? 'Resend Code (${resendCooldownSeconds}s)'
                              : 'Resend Code',
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: isVerifying || isResending
                              ? null
                              : () async {
                                  final shouldCancel = await showDialog<bool>(
                                    context: dialogCtx,
                                    builder: (confirmCtx) => AlertDialog(
                                      title: const Text('Cancel account creation?'),
                                      content: const Text(
                                        'If you close verification, you’ll need to wait 60 seconds before requesting another code.',
                                      ),
                                      actions: [
                                        TextButton(
                                          onPressed: () => Navigator.pop(confirmCtx, false),
                                          child: const Text('Keep verifying'),
                                        ),
                                        FilledButton(
                                          onPressed: () => Navigator.pop(confirmCtx, true),
                                          child: const Text('Cancel registration'),
                                        ),
                                      ],
                                    ),
                                  );
                                  if (shouldCancel == true && dialogCtx.mounted) {
                                    _startRegistrationCooldown();
                                    Navigator.pop(dialogCtx);
                                  }
                                },
                          style: OutlinedButton.styleFrom(
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: const Text('Cancel'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: isVerifying || isResending
                              ? null
                              : () async {
                                  final code = otpController.text.trim();
                                  if (code.length != 6) {
                                    setDialogState(() => errorMessage = 'Please enter the complete 6-digit code.');
                                    return;
                                  }

                                  setDialogState(() {
                                    isVerifying = true;
                                    errorMessage = null;
                                  });

                                  try {
                                    final response = await http.post(
                                      Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/verify-register-otp'),
                                      headers: {
                                        'Content-Type': 'application/json',
                                        'ngrok-skip-browser-warning': 'true',
                                      },
                                      body: jsonEncode({'email': email, 'otp': code}),
                                    ).timeout(const Duration(seconds: 30));

                                    final data = jsonDecode(response.body);

                                    if (response.statusCode != 200 && response.statusCode != 201) {
                                      setDialogState(() {
                                        isVerifying = false;
                                        errorMessage = data['error'] ?? 'Verification failed';
                                      });
                                      return;
                                    }

                                    final token = data['token'] as String?;
                                    final tempPass = data['temporaryPassword'] as String?;
                                    final u = data['user'] ?? {};

                                    await OfflineService.saveProfile({
                                      'user_id': u['id'],
                                      'full_name': fullName,
                                      'contact_number': contact,
                                      'email': email,
                                      'barangay_name': barangayName,
                                      'token': token,
                                      'is_logged_in': true,
                                    });

                                    if (!dialogCtx.mounted) return;
                                    Navigator.pop(dialogCtx);

                                    _showTemporaryPasswordNoticeDialog(
                                      email: email,
                                      contact: contact,
                                      deliveryMethod: data['temporaryPasswordDeliveryMethod']?.toString() ?? deliveryMethod,
                                      passwordSent: data['temporaryPasswordSent'] == true,
                                      tempPassword: tempPass,
                                    );
                                  } catch (err) {
                                    if (!dialogCtx.mounted) return;
                                    setDialogState(() {
                                      isVerifying = false;
                                      errorMessage = 'Could not verify the code. Check your connection and try again.';
                                    });
                                  }
                                },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF1B4F72),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: isVerifying
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Text('Confirm OTP', style: TextStyle(fontWeight: FontWeight.bold)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
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

  void _showTemporaryPasswordNoticeDialog({
    required String email,
    required String contact,
    required String deliveryMethod,
    required bool passwordSent,
    String? tempPassword,
  }) {
    final isSms = deliveryMethod == 'sms';
    final deliveryChannel = isSms ? 'SMS' : 'email';
    final deliveryDestination = isSms ? contact : email;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
        contentPadding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFFF0FDF4),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 26),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Registration Verified',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(12),
                border: const Border(
                  left: BorderSide(color: Color(0xFF1B4F72), width: 4),
                ),
              ),
              child: Text(
                passwordSent
                    ? 'NorzAgapay sent your temporary password by $deliveryChannel. Don\'t share it with anyone.'
                    : 'We could not send the temporary password by $deliveryChannel. It is shown below; save it securely.',
                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Color(0xFF0F172A), height: 1.45),
              ),
            ),
            if (tempPassword != null && tempPassword.isNotEmpty) ...[
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFF93C5FD)),
                ),
                child: Column(
                  children: [
                    const Text('Your Temporary Login Password:', style: TextStyle(fontSize: 12, color: Color(0xFF1E40AF), fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    SelectableText(
                      tempPassword,
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, letterSpacing: 2, color: Color(0xFF1D4ED8)),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 14),
            Text(
              passwordSent
                  ? 'The temporary password was sent to $deliveryDestination by $deliveryChannel.'
                  : 'The temporary password could not be sent to $deliveryDestination. Use the password shown above.',
              style: TextStyle(fontSize: 13, color: Colors.grey.shade700, height: 1.4),
            ),
            const SizedBox(height: 8),
            Text(
              'You can use this temporary password to log in. You can also update your password anytime in Profile Settings.',
              style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600, height: 1.4),
            ),
            const SizedBox(height: 22),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  _onLoginSuccess('Welcome to NorzAgapay!');
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF1B4F72),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  elevation: 1,
                ),
                child: const Text('Proceed to Citizen Portal', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showChangePasswordDialog() async {
    final email = _userProfile?['email'] ?? '';
    final otpController = TextEditingController();
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();

    bool isOtpSent = false;
    bool isSendingOtp = false;
    bool isUpdating = false;
    String? errorMessage;
    String? successMessage;

    await showDialog(
      context: context,
      builder: (dialogCtx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          return AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            contentPadding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFBEB),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.lock_reset_rounded, color: Color(0xFFD97706), size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Change Password',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                  ),
                ),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'An email OTP verification code is required to update your password.',
                    style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600, height: 1.4),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Account: $email',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF1B4F72)),
                  ),
                  const SizedBox(height: 14),

                  if (!isOtpSent)
                    SizedBox(
                      width: double.infinity,
                      height: 44,
                      child: ElevatedButton.icon(
                        onPressed: isSendingOtp
                            ? null
                            : () async {
                                setDialogState(() {
                                  isSendingOtp = true;
                                  errorMessage = null;
                                });
                                try {
                                  final response = await http.post(
                                    Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/password-otp'),
                                    headers: {'Content-Type': 'application/json'},
                                    body: jsonEncode({'email': email}),
                                  ).timeout(const Duration(seconds: 30));

                                  final data = jsonDecode(response.body);
                                  if (response.statusCode != 200) {
                                    throw data['error'] ?? 'Failed to send OTP';
                                  }

                                  setDialogState(() {
                                    isOtpSent = true;
                                    isSendingOtp = false;
                                    successMessage = 'Verification code sent to $email!';
                                  });
                                } catch (e) {
                                  setDialogState(() {
                                    isSendingOtp = false;
                                    errorMessage = 'Could not send verification code: $e';
                                  });
                                }
                              },
                        icon: isSendingOtp
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.send_rounded, size: 16),
                        label: Text(isSendingOtp ? 'Sending Code...' : 'Send OTP to Email'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF1B4F72),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                      ),
                    ),

                  if (isOtpSent) ...[
                    if (successMessage != null) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0FDF4),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFBBF7D0)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.check_circle_outline, size: 16, color: Color(0xFF16A34A)),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                successMessage!,
                                style: const TextStyle(fontSize: 12, color: Color(0xFF15803D), fontWeight: FontWeight.w600),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],

                    TextFormField(
                      controller: otpController,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      decoration: InputDecoration(
                        labelText: '6-Digit Email OTP',
                        prefixIcon: const Icon(Icons.pin_rounded, color: Color(0xFF1B4F72)),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        filled: true,
                        fillColor: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: currentPasswordController,
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: 'Current or Temporary Password',
                        prefixIcon: const Icon(Icons.lock_clock_outlined, color: Color(0xFF1B4F72)),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        filled: true,
                        fillColor: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: newPasswordController,
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: 'New Password',
                        hintText: 'Minimum 6 characters',
                        prefixIcon: const Icon(Icons.lock_outline, color: Color(0xFF1B4F72)),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        filled: true,
                        fillColor: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: confirmPasswordController,
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: 'Confirm New Password',
                        prefixIcon: const Icon(Icons.lock_outline, color: Color(0xFF1B4F72)),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        filled: true,
                        fillColor: Colors.white,
                      ),
                    ),
                  ],

                  if (errorMessage != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      errorMessage!,
                      style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ],

                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: isUpdating ? null : () => Navigator.pop(dialogCtx),
                          style: OutlinedButton.styleFrom(
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: const Text('Cancel'),
                        ),
                      ),
                      if (isOtpSent) ...[
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: isUpdating
                                ? null
                                : () async {
                                    final otp = otpController.text.trim();
                                    final currentPass = currentPasswordController.text;
                                    final newPass = newPasswordController.text;
                                    final confirmPass = confirmPasswordController.text;

                                    if (otp.length != 6) {
                                      setDialogState(() => errorMessage = 'Please enter the 6-digit OTP code.');
                                      return;
                                    }
                                    if (newPass.length < 6) {
                                      setDialogState(() => errorMessage = 'New password must be at least 6 characters.');
                                      return;
                                    }
                                    if (newPass != confirmPass) {
                                      setDialogState(() => errorMessage = 'New passwords do not match.');
                                      return;
                                    }

                                    setDialogState(() {
                                      isUpdating = true;
                                      errorMessage = null;
                                    });

                                    try {
                                      final response = await http.post(
                                        Uri.parse('${AppConstants.apiBaseUrl}/auth/resident/change-password'),
                                        headers: {
                                          'Content-Type': 'application/json',
                                          'ngrok-skip-browser-warning': 'true',
                                        },
                                        body: jsonEncode({
                                          'email': email,
                                          'otp': otp,
                                          'current_password': currentPass,
                                          'new_password': newPass,
                                        }),
                                      ).timeout(const Duration(seconds: 30));

                                      final data = jsonDecode(response.body);
                                      if (response.statusCode != 200) {
                                        throw data['error'] ?? 'Failed to update password';
                                      }

                                      if (!dialogCtx.mounted) return;
                                      Navigator.pop(dialogCtx);

                                      if (mounted) {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          const SnackBar(
                                            content: Text('Password updated successfully! Please keep it secure.'),
                                            backgroundColor: Color(0xFF16A34A),
                                          ),
                                        );
                                      }
                                    } catch (err) {
                                      setDialogState(() {
                                        isUpdating = false;
                                        errorMessage = err.toString();
                                      });
                                    }
                                  },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF1B4F72),
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            child: isUpdating
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                  )
                                : const Text('Update Password', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
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
                        subtitle: Text('${acc['email']} • ${acc['phone'] ?? "No phone"}'),
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
                              'email': user['email'] ?? acc['email'] ?? '',
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
          _isLoggedIn ? 'Citizen Profile' : 'Resident Portal',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 19),
        ),
      ),
      body: _isLoggedIn ? _buildLoggedInView() : _buildLoggedOutView(),
    );
  }

  // ── 1. Logged In Profile View ──────────────────────────────────────────────
  // User personal details: Name, Contact, Email, Barangay
  // Below is My Reports
  // Below is Settings with 2 buttons (Terms and Conditions & Privacy Policy)
  // Below is Log Out
  Widget _buildLoggedInView() {
    final name = _userProfile?['full_name'] ?? 'Resident Citizen';
    final storedContact = _userProfile?['contact_number']?.toString() ?? '';
    final contact = storedContact.isEmpty
        ? 'Not specified'
        : PhoneNumberUtils.formatForDisplay(storedContact);
    final email = _userProfile?['email'] ?? 'Not specified';

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
                _DetailRow(icon: Icons.email_rounded, label: 'Email Address', value: email),
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
            'Login is required before reporting emergencies and community incidents to MDRRMO and Barangay.',
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

              // Button 3: Change Password with Email OTP (visible only when logged in)
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
            controller: _signInContactController,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(
              labelText: 'Email Address',
              hintText: 'citizen@example.com',
              prefixIcon: const Icon(Icons.person_outline_rounded, color: Color(0xFF1B4F72)),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            validator: (v) {
              final identifier = v?.trim() ?? '';
              if (identifier.isEmpty || !identifier.contains('@') || !identifier.contains('.')) {
                return 'Please enter a valid email address';
              }
              return null;
            },
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _signInPasswordController,
            obscureText: true,
            decoration: InputDecoration(
              labelText: 'Password',
              hintText: 'Enter temporary or updated password',
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
        ],
      ),
    );
  }

  // ── Create Account Form (No Password required) ───────────────────────────
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
            validator: (v) => v == null || v.trim().isEmpty ? 'Full name is required' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _regContactController,
            keyboardType: TextInputType.phone,
            inputFormatters: PhoneNumberUtils.inputFormatters,
            decoration: InputDecoration(
              labelText: 'Active Contact Number',
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
            controller: _regEmailController,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(
              labelText: 'Email Address',
              hintText: 'citizen@example.com',
              prefixIcon: const Icon(Icons.email_outlined, color: Color(0xFF1B4F72)),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.white,
            ),
            validator: (v) => v == null || !v.contains('@') ? 'Valid email address is required' : null,
          ),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Send verification code by',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.grey.shade700),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _buildOtpChannelOption(
                  channel: 'email',
                  label: 'Email',
                  icon: Icons.email_outlined,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildOtpChannelOption(
                  channel: 'sms',
                  label: 'SMS',
                  icon: Icons.sms_outlined,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Email is required for your account. The code and temporary password use this selection.',
              style: TextStyle(fontSize: 11.5, color: Colors.grey.shade600),
            ),
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
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Text(
                      _registrationCooldownSeconds > 0
                          ? 'Create Account (${_registrationCooldownSeconds}s)'
                          : 'Create Account',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOtpChannelOption({
    required String channel,
    required String label,
    required IconData icon,
  }) {
    final selected = _registrationOtpChannel == channel;
    return InkWell(
      onTap: _isSubmitting ? null : () => setState(() => _registrationOtpChannel = channel),
      borderRadius: BorderRadius.circular(12),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFEAF3F8) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? const Color(0xFF1B4F72) : const Color(0xFFD1D5DB),
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: const Color(0xFF1B4F72)),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF1B4F72))),
            const SizedBox(width: 7),
            Icon(
              selected ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
              size: 17,
              color: selected ? const Color(0xFF1B4F72) : Colors.grey,
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _signInContactController.dispose();
    _signInPasswordController.dispose();
    _regNameController.dispose();
    _regContactController.dispose();
    _regEmailController.dispose();
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
