import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../../services/auth_service.dart';
import '../../services/api_service.dart';
import '../../core/phone_number_utils.dart';
import '../core/constants.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  String? _pendingMessage;

  @override
  void dispose() {
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    FocusScope.of(context).unfocus();
    setState(() => _pendingMessage = null);
    final auth = context.read<AuthProvider>();
    try {
      await auth.login(
        PhoneNumberUtils.digitsOnly(_phoneController.text),
        _passwordController.text,
      );
      await context.read<AuthService>().logout();
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (error) {
      final message = error.toString().replaceFirst('Exception: ', '');
      if (!mounted) return;
      if (message.toLowerCase().contains('pending') ||
          message.toLowerCase().contains('verification')) {
        setState(() => _pendingMessage = message);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(message),
            backgroundColor: const Color(AppColors.danger),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  Future<void> _showForgotPasswordDialog() async {
    final phone = TextEditingController(
      text: PhoneNumberUtils.digitsOnly(_phoneController.text),
    );
    final otp = TextEditingController();
    final newPassword = TextEditingController();
    final confirmPassword = TextEditingController();
    var otpSent = false;
    var busy = false;
    String? error;
    String? info;

    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            backgroundColor: const Color(AppColors.bgSecondary),
            title: const Text('Reset password', style: TextStyle(color: Colors.white)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'We will send a verification code by SMS to your mobile number.',
                    style: TextStyle(color: Colors.white70),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: phone,
                    enabled: !otpSent,
                    keyboardType: TextInputType.phone,
                    inputFormatters: PhoneNumberUtils.inputFormatters,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Mobile number',
                      hintText: '09XXXXXXXXX',
                      labelStyle: TextStyle(color: Colors.white70),
                      prefixIcon: Icon(Icons.phone_outlined, color: Colors.white70),
                    ),
                  ),
                  if (otpSent) ...[
                    const SizedBox(height: 12),
                    Text(info ?? 'Enter the SMS code and choose a new password.',
                        style: const TextStyle(color: Color(AppColors.success))),
                    TextField(
                      controller: otp,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: '6-digit SMS code'),
                    ),
                    TextField(
                      controller: newPassword,
                      obscureText: true,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'New password (8+ characters)'),
                    ),
                    TextField(
                      controller: confirmPassword,
                      obscureText: true,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Confirm new password'),
                    ),
                  ],
                  if (error != null) ...[
                    const SizedBox(height: 10),
                    Text(error!, style: const TextStyle(color: Color(AppColors.danger))),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: busy ? null : () => Navigator.pop(dialogContext),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: busy ? null : () async {
                  setDialogState(() { busy = true; error = null; });
                  try {
                    final normalizedPhone = PhoneNumberUtils.digitsOnly(phone.text);
                    if (!PhoneNumberUtils.isValid(normalizedPhone)) {
                      throw 'Enter an 11-digit mobile number starting with 09.';
                    }
                    if (!otpSent) {
                      info = await ApiService.sendResponderForgotPasswordOtp(phone: normalizedPhone);
                      setDialogState(() { otpSent = true; busy = false; });
                      return;
                    }
                    if (otp.text.trim().length != 6) throw 'Enter the 6-digit SMS code.';
                    if (newPassword.text.length < 8) throw 'Password must be at least 8 characters.';
                    if (newPassword.text != confirmPassword.text) throw 'Passwords do not match.';
                    await ApiService.resetResponderPassword(
                      phone: normalizedPhone,
                      otp: otp.text.trim(),
                      newPassword: newPassword.text,
                    );
                    if (dialogContext.mounted) Navigator.pop(dialogContext);
                    if (mounted) {
                      _phoneController.text = normalizedPhone;
                      _passwordController.clear();
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Password reset. Sign in with your new password.')),
                      );
                    }
                  } catch (e) {
                    setDialogState(() {
                      busy = false;
                      error = e.toString().replaceFirst('Exception: ', '');
                    });
                  }
                },
                child: busy
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(otpSent ? 'Reset password' : 'Send SMS code'),
              ),
            ],
          ),
        ),
      );
    } finally {
      phone.dispose();
      otp.dispose();
      newPassword.dispose();
      confirmPassword.dispose();
    }
  }

  Future<void> _showDebugAccounts() async {
    final auth = context.read<AuthProvider>();
    try {
      final accounts = await auth.getDebugAccounts();
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: const Color(AppColors.bgSecondary),
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: [
              const ListTile(title: Text('Debug quick login')),
              if (accounts.isEmpty) const ListTile(title: Text('No active accounts')),
              ...accounts.map((account) => ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                title: Text(account['full_name']?.toString() ?? 'Responder'),
                subtitle: Text(account['phone']?.toString() ?? 'No mobile number'),
                onTap: () async {
                  try {
                    await auth.debugQuickLogin(account['id'].toString());
                    await context.read<AuthService>().logout();
                    if (sheetContext.mounted) Navigator.pop(sheetContext);
                    if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
                  } catch (e) {
                    if (mounted) ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Quick login failed: ' + e.toString())),
                    );
                  }
                },
              )),
            ],
          ),
        ),
      );
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Debug accounts unavailable: ' + e.toString())),
      );
    }
  }

  InputDecoration _inputDecoration(String label, IconData icon) => InputDecoration(
    labelText: label,
    labelStyle: const TextStyle(color: Colors.grey),
    prefixIcon: Icon(icon, color: Colors.grey),
    filled: true,
    fillColor: const Color(AppColors.bgSecondary),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: Color(AppColors.border)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: Color(AppColors.accent), width: 1.5),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(AppColors.bgPrimary),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 28),
              Center(
                child: GestureDetector(
                  onTap: _showDebugAccounts,
                  child: Container(
                    width: 88,
                    height: 88,
                    decoration: BoxDecoration(
                      color: const Color(AppColors.bgSecondary),
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(AppColors.primary).withOpacity(0.4), width: 2),
                    ),
                    child: ClipOval(child: Image.asset('assets/NA-icon.png', fit: BoxFit.contain)),
                  ),
                ),
              ),
              const SizedBox(height: 28),
              const Text('Welcome Back', textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              const Text('MDRRMO Responder Portal', textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey, fontSize: 14)),
              const SizedBox(height: 32),
              if (_pendingMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(AppColors.warning).withOpacity(0.12),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(AppColors.warning).withOpacity(0.5)),
                  ),
                  child: Text(_pendingMessage!, style: const TextStyle(color: Color(AppColors.warning))),
                ),
                const SizedBox(height: 16),
              ],
              TextField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                inputFormatters: PhoneNumberUtils.inputFormatters,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration('Mobile number', Icons.phone_outlined).copyWith(hintText: '09XXXXXXXXX'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                obscureText: _obscurePassword,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration('Password', Icons.lock_outlined).copyWith(
                  suffixIcon: IconButton(
                    icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility, color: Colors.grey),
                    onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                  ),
                ),
                onSubmitted: (_) => _login(),
              ),
              const SizedBox(height: 24),
              Consumer<AuthProvider>(
                builder: (context, auth, _) => ElevatedButton(
                  onPressed: auth.isLoading ? null : _login,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(AppColors.primary),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: auth.isLoading
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Sign in', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ),
              TextButton(
                onPressed: _showForgotPasswordDialog,
                child: const Text('Forgot password?', style: TextStyle(color: Color(AppColors.accent))),
              ),
              const SizedBox(height: 18),
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
                icon: const Icon(Icons.arrow_back_rounded),
                label: const Text('Back to account selection'),
              ),
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text(
                  'Responder accounts are created by an MDRRMO administrator.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
