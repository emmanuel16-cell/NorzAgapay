import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../core/phone_number_utils.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../mdrrmo/screens/login_screen.dart' as mdrrmo;

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _position = TextEditingController();
  final _otp = TextEditingController();
  final _barangayFormKey = GlobalKey<FormState>();
  bool _registering = false;
  bool _otpSent = false;
  bool _busy = false;
  bool _obscurePassword = true;
  String? _selectedBarangayId;
  List<Map<String, dynamic>> _barangays = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadBarangays();
  }

  Future<void> _loadBarangays() async {
    try {
      final rows = await ApiService.getBarangays(adminSignup: true);
      if (!mounted) return;
      setState(() {
        _barangays = rows;
        _selectedBarangayId ??= rows.isNotEmpty ? rows.first['id']?.toString() : null;
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'Eligible barangays could not be loaded.');
    }
  }

  Future<void> _submitLogin() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<AuthService>().login(PhoneNumberUtils.digitsOnly(_phone.text), _password.text);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendRegistrationCode() async {
    if (!_barangayFormKey.currentState!.validate()) return;
    if (_selectedBarangayId == null) { setState(() => _error = 'Choose a barangay.'); return; }
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<AuthService>().sendBarangayRegistrationOtp(
        fullName: _name.text.trim(),
        phone: _phone.text.trim(),
        password: _password.text,
        barangayId: _selectedBarangayId!,
        positionDesignation: _position.text.trim(),
      );
      if (mounted) setState(() => _otpSent = true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyRegistrationCode() async {
    if (_otp.text.trim().length != 6) { setState(() => _error = 'Enter the 6-digit SMS code.'); return; }
    setState(() { _busy = true; _error = null; });
    try {
      final result = await context.read<AuthService>().verifyBarangayRegistrationOtp(
        phone: PhoneNumberUtils.digitsOnly(_phone.text),
        otp: _otp.text.trim(),
      );
      await context.read<AuthService>().activateRegisteredAccount(result);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showForgotPassword() async {
    final phoneController = TextEditingController(text: PhoneNumberUtils.digitsOnly(_phone.text));
    final otpController = TextEditingController();
    final newPassword = TextEditingController();
    final confirmPassword = TextEditingController();
    bool otpSent = false;
    bool submitting = false;
    String? error;
    String? message;
    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Reset password'),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('We will send a verification code by SMS to your mobile number.'),
            const SizedBox(height: 12),
            TextField(controller: phoneController, enabled: !otpSent, keyboardType: TextInputType.phone, inputFormatters: PhoneNumberUtils.inputFormatters, decoration: const InputDecoration(labelText: 'Mobile number', hintText: '09XXXXXXXXX')),
            if (otpSent) ...[
              if (message != null) Align(alignment: Alignment.centerLeft, child: Text(message!, style: const TextStyle(color: Color(0xFF15803D)))),
              TextField(controller: otpController, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: '6-digit SMS code')),
              TextField(controller: newPassword, obscureText: true, decoration: const InputDecoration(labelText: 'New password (8+ characters)')),
              TextField(controller: confirmPassword, obscureText: true, decoration: const InputDecoration(labelText: 'Confirm new password')),
            ],
            if (error != null) Align(alignment: Alignment.centerLeft, child: Text(error!, style: const TextStyle(color: Colors.red))),
          ])),
          actions: [
            TextButton(onPressed: submitting ? null : () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            FilledButton(onPressed: submitting ? null : () async {
              setDialogState(() { submitting = true; error = null; });
              try {
                final phone = PhoneNumberUtils.digitsOnly(phoneController.text);
                if (!PhoneNumberUtils.isValid(phone)) throw 'Enter an 11-digit mobile number starting with 09.';
                if (!otpSent) {
                  message = await ApiService.sendBarangayForgotPasswordOtp(phone: phone);
                  setDialogState(() { otpSent = true; submitting = false; });
                } else {
                  if (otpController.text.trim().length != 6) throw 'Enter the 6-digit SMS code.';
                  if (newPassword.text.length < 8) throw 'Password must be at least 8 characters.';
                  if (newPassword.text != confirmPassword.text) throw 'Passwords do not match.';
                  await ApiService.resetBarangayPassword(phone: phone, otp: otpController.text.trim(), newPassword: newPassword.text);
                  if (dialogContext.mounted) Navigator.pop(dialogContext);
                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password reset. Sign in with your new password.')));
                }
              } catch (e) {
                setDialogState(() { submitting = false; error = e.toString().replaceFirst('Exception: ', ''); });
              }
            }, child: submitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(otpSent ? 'Reset password' : 'Send SMS code')),
          ],
        )),
      );
    } finally {
      phoneController.dispose(); otpController.dispose(); newPassword.dispose(); confirmPassword.dispose();
    }
  }

  Future<void> _showDebugAccounts() async {
    try {
      final accounts = await context.read<AuthService>().getDebugAccounts();
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Quick test accounts')),
            ...accounts.map((account) => ListTile(
              title: Text(account['full_name']?.toString() ?? 'Account'),
              subtitle: Text(account['phone']?.toString() ?? 'No mobile number'),
              onTap: () async {
                try {
                  await context.read<AuthService>().debugQuickLogin(account['id'].toString());
                  if (sheetContext.mounted) Navigator.pop(sheetContext);
                } catch (error) {
                  if (mounted) setState(() => _error = error.toString());
                }
              },
            )),
          ],
        )),
      );
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  InputDecoration _decoration(String label, IconData icon) => InputDecoration(
    labelText: label,
    prefixIcon: Icon(icon, color: const Color(0xFF1B4F72)),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    filled: true,
    fillColor: Colors.white,
  );

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7FA),
      body: SafeArea(child: Center(child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 460), child: Card(
          elevation: 2,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
          child: Padding(padding: const EdgeInsets.all(24), child: Form(
            key: _registering ? _barangayFormKey : _formKey,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Icon(Icons.shield_moon_rounded, size: 44, color: Color(0xFF1B4F72)),
              const SizedBox(height: 12),
              Text(_registering ? (_otpSent ? 'Verify your mobile number' : 'Barangay account registration') : 'Barangay sign in', textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
              const SizedBox(height: 8),
              Text(_otpSent ? 'Enter the 6-digit SMS code sent to ${PhoneNumberUtils.formatForDisplay(_phone.text)}.' : 'Sign in or create an account using a mobile number and password.', textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B))),
              if (_error != null) ...[const SizedBox(height: 14), Text(_error!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center)],
              const SizedBox(height: 18),
              if (_registering && !_otpSent) ...[
                TextFormField(controller: _name, decoration: _decoration('Full name', Icons.person_outline), validator: (v) => v == null || v.trim().length < 2 ? 'Enter your full name.' : null),
                const SizedBox(height: 12),
                TextFormField(controller: _phone, keyboardType: TextInputType.phone, inputFormatters: PhoneNumberUtils.inputFormatters, decoration: _decoration('Mobile number', Icons.phone_outlined), validator: PhoneNumberUtils.validationMessage),
                const SizedBox(height: 12),
                TextFormField(controller: _password, obscureText: _obscurePassword, decoration: _decoration('Password', Icons.lock_outline).copyWith(helperText: 'At least 8 characters', suffixIcon: IconButton(icon: Icon(_obscurePassword ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _obscurePassword = !_obscurePassword))), validator: (v) => v == null || v.length < 8 ? 'Password must be at least 8 characters.' : null),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _selectedBarangayId,
                  decoration: _decoration('Barangay', Icons.location_city),
                  items: _barangays.map((barangay) => DropdownMenuItem(value: barangay['id']?.toString(), child: Text(barangay['name']?.toString() ?? 'Barangay'))).toList(),
                  onChanged: (value) => setState(() => _selectedBarangayId = value),
                  validator: (value) => value == null ? 'Choose a barangay.' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(controller: _position, decoration: _decoration('Official designation', Icons.badge_outlined), validator: (v) => v == null || v.trim().length < 2 ? 'Enter your official designation.' : null),
              ] else if (_registering) ...[
                TextFormField(controller: _otp, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)], decoration: _decoration('6-digit SMS code', Icons.sms_outlined)),
              ] else ...[
                TextFormField(controller: _phone, keyboardType: TextInputType.phone, inputFormatters: PhoneNumberUtils.inputFormatters, decoration: _decoration('Mobile number', Icons.phone_outlined), validator: PhoneNumberUtils.validationMessage),
                const SizedBox(height: 12),
                TextFormField(controller: _password, obscureText: _obscurePassword, decoration: _decoration('Password', Icons.lock_outline).copyWith(suffixIcon: IconButton(icon: Icon(_obscurePassword ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _obscurePassword = !_obscurePassword))), validator: (v) => v == null || v.isEmpty ? 'Enter your password.' : null),
              ],
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: _busy || auth.isLoading ? null : () => _registering ? (_otpSent ? _verifyRegistrationCode() : _sendRegistrationCode()) : _submitLogin(),
                icon: (_busy || auth.isLoading) ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Icon(_registering ? (_otpSent ? Icons.verified_user_outlined : Icons.sms_outlined) : Icons.login),
                label: Text(_busy || auth.isLoading ? 'Please wait…' : _registering ? (_otpSent ? 'Verify and create account' : 'Send SMS verification code') : 'Sign in'),
              ),
              if (!_registering) ...[
                TextButton(onPressed: _busy ? null : _showForgotPassword, child: const Text('Forgot password?')),
                TextButton(onPressed: _busy ? null : _showDebugAccounts, child: const Text('Quick test account')),
              ],
              TextButton(onPressed: _busy ? null : () => setState(() { _registering = !_registering; _otpSent = false; _error = null; _otp.clear(); }), child: Text(_registering ? 'Back to sign in' : 'Create barangay account')),
              const Divider(height: 26),
              OutlinedButton.icon(onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const mdrrmo.LoginScreen())), icon: const Icon(Icons.groups_2_outlined), label: const Text('MDRRMO responder sign in')),
            ]),
          )),
        )),
      ))),
    );
  }

  @override
  void dispose() {
    _phone.dispose(); _password.dispose(); _name.dispose(); _position.dispose(); _otp.dispose();
    super.dispose();
  }
}
