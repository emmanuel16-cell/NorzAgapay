import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../core/phone_number_utils.dart';
import '../mdrrmo/screens/login_screen.dart' as mdrrmo;
import '../mdrrmo/providers/auth_provider.dart' as global_auth;

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _positionController = TextEditingController();

  bool _isRegisterMode = false;
  String? _selectedBarangayId;
  List<Map<String, dynamic>> _barangays = [];
  bool _loadingBarangays = false;
  bool _obscurePassword = true;
  int _registrationCooldownSeconds = 0;
  Timer? _registrationCooldownTimer;

  @override
  void initState() {
    super.initState();
    _fetchBarangays();
  }

  void _startRegistrationCooldown() {
    _registrationCooldownTimer?.cancel();
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

  Future<void> _fetchBarangays() async {
    if (!mounted) return;
    setState(() => _loadingBarangays = true);
    try {
      final list = await ApiService.getBarangays();
      if (!mounted) return;
      setState(() => _barangays = list);
    } catch (_) {}
    if (mounted) setState(() => _loadingBarangays = false);
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    final auth = Provider.of<AuthService>(context, listen: false);
    final mdrrmoAuth = Provider.of<global_auth.AuthProvider>(context, listen: false);

    try {
      if (_isRegisterMode) {
        if (_selectedBarangayId == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Please select your Barangay')),
          );
          return;
        }
        await auth.sendBarangayRegistrationOtp(
          fullName: _nameController.text.trim(),
          email: _emailController.text.trim(),
          phone: _phoneController.text.trim(),
          barangayId: _selectedBarangayId!,
          positionDesignation: _positionController.text.trim(),
        );
        if (!mounted) return;
        final result = await _showRegistrationOtpDialog(auth);
        if (result == null || !mounted) return;
        final password = result['temporaryPassword']?.toString() ?? '';
        final continueToAccount = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) => AlertDialog(
            backgroundColor: const Color(0xFFE5E7EB),
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
            titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
            contentPadding: const EdgeInsets.fromLTRB(24, 18, 24, 8),
            actionsPadding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0FDF4),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 28),
                ),
                const SizedBox(width: 14),
                const Expanded(
                  child: Text(
                    'Email Verified',
                    style: TextStyle(fontSize: 21, fontWeight: FontWeight.bold, color: Color(0xFF1F2937)),
                  ),
                ),
              ],
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(16),
                    border: const Border(left: BorderSide(color: Color(0xFF1B4F72), width: 5)),
                  ),
                  child: const Text(
                    'NorzAgapay sent a temporary password. Don’t share it with anyone. If you didn’t request it, please ignore this message.',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, height: 1.5, color: Color(0xFF0F172A)),
                  ),
                ),
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFF93C5FD)),
                  ),
                  child: Column(
                    children: [
                      const Text('Your Temporary Login Password:', style: TextStyle(fontSize: 14, color: Color(0xFF1E40AF), fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      SelectableText(
                        password,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 27, fontWeight: FontWeight.bold, letterSpacing: 2, color: Color(0xFF1D4ED8)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  'A temporary password was also sent to ${_emailController.text.trim()}. You can use it to sign in and change it later in your account settings.',
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade700, height: 1.5),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () => Clipboard.setData(ClipboardData(text: password)),
                    icon: const Icon(Icons.content_copy_rounded, size: 18),
                    label: const Text('Copy password'),
                    style: TextButton.styleFrom(foregroundColor: const Color(0xFF1B4F72), textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
            actions: [
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF1B4F72),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  minimumSize: const Size(double.infinity, 54),
                  textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                ),
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Continue to Barangay Account Request'),
              ),
            ],
          ),
        );
        if (continueToAccount == true) {
          await auth.activateRegisteredAccount(result);
          await mdrrmoAuth.logout();
        }
      } else {
        await auth.login(
          _emailController.text.trim(),
          _passwordController.text,
        );
        await mdrrmoAuth.logout();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<Map<String, dynamic>?> _showRegistrationOtpDialog(AuthService auth) async {
    final otpController = TextEditingController();
    var verifying = false;
    var resending = false;
    var resendCooldownSeconds = 60;
    Timer? resendTimer;
    String? error;
    try {
      return await showDialog<Map<String, dynamic>>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            if (resendTimer == null) {
              resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
                if (!dialogContext.mounted) {
                  timer.cancel();
                } else if (resendCooldownSeconds <= 1) {
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
                    decoration: BoxDecoration(color: const Color(0xFFF5F8FC), borderRadius: BorderRadius.circular(14)),
                    child: const Icon(Icons.mark_email_read_rounded, color: Color(0xFF1B4F72), size: 27),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(child: Text('Email Verification', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 21, color: Color(0xFF171B20)))),
                ],
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('We sent a 6-digit verification code to:', style: TextStyle(fontSize: 15, color: Color(0xFF70757C))),
                    const SizedBox(height: 3),
                    Text(_emailController.text.trim(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Color(0xFF1B4F72))),
                    const SizedBox(height: 18),
                    TextField(
                      controller: otpController,
                      autofocus: true,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      maxLength: 6,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: 9, color: Color(0xFF0F172A)),
                      decoration: InputDecoration(
                        hintText: '••••••', counterText: '', filled: true, fillColor: const Color(0xFFF8FAFC),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF555B63), width: 1.4)),
                        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFF1B4F72), width: 2)),
                      ),
                    ),
                    if (error != null) ...[
                      const SizedBox(height: 8),
                      Text(error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12.5, fontWeight: FontWeight.w600)),
                    ],
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Code expires in 10 mins', style: TextStyle(fontSize: 12, color: Color(0xFF92979E))),
                        TextButton(
                          onPressed: verifying || resending || resendCooldownSeconds > 0 ? null : () async {
                            setDialogState(() { resending = true; error = null; });
                            try {
                              await auth.sendBarangayRegistrationOtp(
                                fullName: _nameController.text.trim(),
                                email: _emailController.text.trim(),
                                barangayId: _selectedBarangayId!,
                                positionDesignation: _positionController.text.trim(),
                                phone: _phoneController.text.trim(),
                              );
                              if (!dialogContext.mounted) return;
                              setDialogState(() { resending = false; resendCooldownSeconds = 60; error = 'A new code has been sent to your email.'; });
                              resendTimer?.cancel();
                              resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
                                if (!dialogContext.mounted) { timer.cancel(); return; }
                                if (resendCooldownSeconds <= 1) { timer.cancel(); setDialogState(() => resendCooldownSeconds = 0); }
                                else { setDialogState(() => resendCooldownSeconds--); }
                              });
                            } catch (exception) {
                              if (dialogContext.mounted) setDialogState(() { resending = false; error = exception.toString().replaceFirst('Exception: ', ''); });
                            }
                          },
                          child: Text(resendCooldownSeconds > 0 ? 'Resend Code (${resendCooldownSeconds}s)' : 'Resend Code'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: verifying || resending ? null : () async {
                    final cancel = await showDialog<bool>(
                      context: dialogContext,
                      builder: (confirmContext) => AlertDialog(
                        title: const Text('Cancel account creation?'),
                        content: const Text('If you close email verification, you’ll need to wait 60 seconds before requesting another code.'),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(confirmContext, false), child: const Text('Keep verifying')),
                          FilledButton(onPressed: () => Navigator.pop(confirmContext, true), child: const Text('Cancel registration')),
                        ],
                      ),
                    );
                    if (cancel == true && dialogContext.mounted) {
                      _startRegistrationCooldown();
                      Navigator.pop(dialogContext);
                    }
                  },
                  child: const Text('Cancel', style: TextStyle(color: Color(0xFF1B4F72))),
                ),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFF1B4F72), foregroundColor: Colors.white, shape: const StadiumBorder(), padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12)),
                  onPressed: verifying || resending ? null : () async {
                    if (otpController.text.trim().length != 6) {
                      setDialogState(() => error = 'Enter the 6-digit code from your email.');
                      return;
                    }
                    setDialogState(() { verifying = true; error = null; });
                    try {
                      final result = await auth.verifyBarangayRegistrationOtp(email: _emailController.text.trim(), otp: otpController.text.trim());
                      if (dialogContext.mounted) Navigator.pop(dialogContext, result);
                    } catch (exception) {
                      if (dialogContext.mounted) setDialogState(() { verifying = false; error = exception.toString().replaceFirst('Exception: ', ''); });
                    }
                  },
                  child: verifying ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Confirm OTP', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            );
          },
        ),
      );
    } finally {
      resendTimer?.cancel();
      otpController.dispose();
    }
  }

  Future<void> _showDebugAccounts() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    try {
      final accounts = await auth.getDebugAccounts();
      if (!mounted) return;
      if (_barangays.isEmpty) await _fetchBarangays();
      if (!mounted) return;
      final accountsByBarangay = <String, List<Map<String, dynamic>>>{};
      for (final account in accounts) {
        final barangayId = account['barangay_id'] as String?;
        final groupKey = (barangayId == null || barangayId.isEmpty)
            ? 'unassigned'
            : barangayId;
        accountsByBarangay.putIfAbsent(groupKey, () => []).add(account);
      }
      final barangayGroups = accountsByBarangay.entries.toList()
        ..sort((a, b) => _debugBarangayName(a.value.first)
            .toLowerCase()
            .compareTo(_debugBarangayName(b.value.first).toLowerCase()));
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: Colors.white,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
          child: SizedBox(
            height: 420,
            child: Column(children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Debug quick login', style: TextStyle(color: Color(0xFF0F172A), fontSize: 18, fontWeight: FontWeight.bold)),
              ),
              Expanded(
                child: accounts.isEmpty
                    ? const Center(child: Text('No active barangay accounts', style: TextStyle(color: Color(0xFF64748B))))
                    : ListView(
                        children: [
                          for (final group in barangayGroups) ...[
                            Padding(
                              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                              child: Text(
                                _debugBarangayName(group.value.first),
                                style: const TextStyle(
                                  color: Color(0xFF475569),
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            for (final account in group.value)
                              ListTile(
                                leading: const Icon(Icons.account_circle, color: Color(0xFF38BDF8)),
                                title: Text(account['full_name'] ?? '', style: const TextStyle(color: Color(0xFF0F172A))),
                                subtitle: Text('${account['email']} • ${account['role']}', style: const TextStyle(color: Color(0xFF64748B))),
                                onTap: () async {
                                  Navigator.pop(sheetContext);
                                  try {
                                    await auth.debugQuickLogin(account['id'] as String);
                                    await Provider.of<global_auth.AuthProvider>(context, listen: false).logout();
                                  } catch (error) {
                                    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Quick login failed: $error'), backgroundColor: Colors.red));
                                  }
                                },
                              ),
                          ],
                        ],
                      ),
              ),
            ]),
          ),
        ),
      );
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Debug accounts unavailable: $error')));
    }
  }

  String _debugBarangayName(Map<String, dynamic> account) {
    var name = (account['barangay_name'] as String?)?.trim();
    final barangayId = account['barangay_id'] as String?;
    if ((name == null || name.isEmpty) && barangayId != null) {
      for (final barangay in _barangays) {
        if (barangay['id'] == barangayId) {
          name = (barangay['name'] as String?)?.trim();
          break;
        }
      }
    }
    if (name == null || name.isEmpty) {
      return barangayId == null || barangayId.isEmpty
          ? 'Unassigned Barangay'
          : 'Barangay $barangayId';
    }
    return name.toLowerCase().startsWith('barangay') ? name : 'Barangay $name';
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Card(
              color: Colors.white,
              elevation: 3,
              shadowColor: const Color(0x1A0F172A),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(28.0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Logo / Header
                      InkWell(
                        onTap: _showDebugAccounts,
                        borderRadius: BorderRadius.circular(48),
                        child: SizedBox(
                          width: 88,
                          height: 88,
                          child: Image.asset('assets/NA-icon.png', fit: BoxFit.contain),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'NorzAgapay Barangay',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _isRegisterMode
                        ? 'Register your Barangay'
                            : 'Sign in to your Barangay account',
                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                      ),
                      const SizedBox(height: 24),

                      if (_isRegisterMode) ...[
                        TextFormField(
                          controller: _nameController,
                          style: const TextStyle(color: Color(0xFF0F172A)),
                          decoration: _inputDecoration('Full Name', Icons.person),
                          validator: (v) => v == null || v.isEmpty ? 'Name required' : null,
                        ),
                        const SizedBox(height: 14),
                        // Barangay Dropdown
                        DropdownButtonFormField<String>(
                          dropdownColor: Colors.white,
                          style: const TextStyle(color: Color(0xFF0F172A)),
                          value: _selectedBarangayId,
                          decoration: _inputDecoration('Select Barangay', Icons.location_city),
                          hint: Text(
                            _loadingBarangays ? 'Loading...' : 'Select Barangay',
                            style: const TextStyle(color: Color(0xFF64748B)),
                          ),
                          items: _barangays.map((b) {
                            return DropdownMenuItem<String>(
                              value: b['id'],
                              child: Text(b['name']),
                            );
                          }).toList(),
                          onChanged: (v) => setState(() => _selectedBarangayId = v),
                          validator: (v) => _isRegisterMode && v == null ? 'Barangay required' : null,
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _phoneController,
                          keyboardType: TextInputType.phone,
                          inputFormatters: PhoneNumberUtils.inputFormatters,
                          style: const TextStyle(color: Color(0xFF0F172A)),
                          decoration: _inputDecoration('Contact Number', Icons.phone),
                          validator: (v) => !_isRegisterMode
                              ? null
                              : PhoneNumberUtils.validationMessage(v),
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _positionController,
                          style: const TextStyle(color: Color(0xFF0F172A)),
                          decoration: _inputDecoration('Position at Your Barangay', Icons.badge),
                          validator: (v) => _isRegisterMode && (v == null || v.trim().isEmpty) ? 'Position required' : null,
                        ),
                        const SizedBox(height: 14),
                      ],

                      TextFormField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        style: const TextStyle(color: Color(0xFF0F172A)),
                        decoration: _inputDecoration('Email Address', Icons.email),
                        validator: (v) => v == null || !v.contains('@') ? 'Valid email required' : null,
                      ),
                      const SizedBox(height: 14),
                      if (!_isRegisterMode) ...[
                        TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          style: const TextStyle(color: Color(0xFF0F172A)),
                          decoration: _inputDecoration('Password', Icons.lock).copyWith(
                            suffixIcon: IconButton(
                              icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility, color: const Color(0xFF64748B)),
                              onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                            ),
                          ),
                          validator: (v) => !_isRegisterMode && (v == null || v.length < 8) ? 'Min 8 characters' : null,
                        ),
                        const SizedBox(height: 24),
                      ] else
                        const SizedBox(height: 10),

                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton(
                          onPressed: auth.isLoading || (_isRegisterMode && _registrationCooldownSeconds > 0) ? null : _handleSubmit,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0284C7),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          child: auth.isLoading
                              ? const CircularProgressIndicator(color: Colors.white)
                              : Text(
                                  _isRegisterMode && _registrationCooldownSeconds > 0
                                      ? 'Create Admin Account (${_registrationCooldownSeconds}s)'
                                      : _isRegisterMode ? 'Create Admin Account' : 'Sign In',
                                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                                ),
                        ),
                      ),
                      const SizedBox(height: 16),

                      TextButton(
                        onPressed: () {
                          setState(() {
                            _isRegisterMode = !_isRegisterMode;
                            _formKey.currentState?.reset();
                          });
                        },
                        child: Text(
                          _isRegisterMode
                              ? 'Already have an account? Sign In'
                              : 'Don’t have a NorzAgapay barangay admin account? Create one',
                          style: const TextStyle(color: Color(0xFF0284C7), fontSize: 13),
                        ),
                      ),
                      if (!_isRegisterMode) ...[
                        const SizedBox(height: 6),
                        OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const mdrrmo.LoginScreen())),
                          icon: const Icon(Icons.admin_panel_settings_outlined),
                          label: const Text('MDRRMO responder sign in'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Color(0xFF64748B)),
      floatingLabelStyle: const TextStyle(color: Color(0xFF0284C7)),
      prefixIcon: Icon(icon, color: const Color(0xFF0284C7), size: 20),
      filled: true,
      fillColor: const Color(0xFFF8FAFC),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFF0284C7), width: 1.5),
      ),
    );
  }

  @override
  void dispose() {
    _registrationCooldownTimer?.cancel();
    _emailController.dispose();
    _passwordController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    _positionController.dispose();
    super.dispose();
  }
}
