import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../../services/auth_service.dart';
import '../core/constants.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  String? _pendingMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    setState(() => _pendingMessage = null);
    final auth = Provider.of<AuthProvider>(context, listen: false);
    try {
      await auth.login(_emailController.text.trim(), _passwordController.text);
      await Provider.of<AuthService>(context, listen: false).logout();
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      final errorStr = e.toString();
      if (mounted) {
        // Check if it's a pending verification error
        if (errorStr.toLowerCase().contains('pending') || errorStr.toLowerCase().contains('verification')) {
          setState(() => _pendingMessage = errorStr);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(errorStr),
              backgroundColor: const Color(AppColors.danger),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          );
        }
      }
    }
  }

  Future<void> _showDebugAccounts() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    try {
      final accounts = await auth.getDebugAccounts();
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: const Color(AppColors.bgSecondary),
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
          child: SizedBox(
            height: 420,
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  child: Row(
                    children: [
                      Icon(Icons.bug_report_rounded, color: Colors.grey),
                      SizedBox(width: 8),
                      Text('Debug Quick Login', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                Expanded(
                  child: accounts.isEmpty
                      ? const Center(child: Text('No active accounts', style: TextStyle(color: Colors.grey)))
                      : ListView.builder(
                          itemCount: accounts.length,
                          itemBuilder: (_, index) {
                            final account = accounts[index];
                            return ListTile(
                              leading: CircleAvatar(
                                backgroundColor: const Color(AppColors.primary).withOpacity(0.2),
                                child: Text(
                                  (account['full_name'] as String? ?? 'U')[0].toUpperCase(),
                                  style: const TextStyle(color: Color(AppColors.accent), fontWeight: FontWeight.bold),
                                ),
                              ),
                              title: Text(account['full_name'] ?? ''),
                              subtitle: Text('${account['email']} • ${account['role']}'),
                              onTap: () async {
                                Navigator.pop(sheetContext);
                                try {
                                  await auth.debugQuickLogin(account['id'] as String);
                                  await Provider.of<AuthService>(context, listen: false).logout();
                                  if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
                                } catch (error) {
                                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Quick login failed: $error')));
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
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Debug accounts unavailable: $error')));
    }
  }

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
              const SizedBox(height: 32),

              // Logo
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
                      boxShadow: [BoxShadow(color: const Color(AppColors.primary).withOpacity(0.2), blurRadius: 20)],
                    ),
                    child: ClipOval(
                      child: Image.asset('assets/NA-icon.png', fit: BoxFit.contain),
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 28),
              const Text(
                'Welcome Back',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 6),
              const Text(
                'MDRRMO Responder Portal',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey, fontSize: 14),
              ),

              const SizedBox(height: 40),

              // Pending verification alert (shown after failed login)
              if (_pendingMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(AppColors.warning).withOpacity(0.12),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(AppColors.warning).withOpacity(0.5)),
                  ),
                  child: Column(
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.hourglass_top_rounded, color: Color(AppColors.warning)),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Account Pending Verification',
                              style: TextStyle(color: Color(AppColors.warning), fontWeight: FontWeight.bold, fontSize: 15),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'Your MDRRMO Responder account has been submitted and is awaiting review by the MDRRMO Command Center at the Web Dashboard.\n\nYou will be able to log in once your account has been approved.',
                        style: TextStyle(color: Colors.white60, fontSize: 13, height: 1.5),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          const Icon(Icons.info_outline, size: 14, color: Colors.grey),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Contact your MDRRMO administrator if you need urgent assistance.',
                              style: TextStyle(color: Colors.grey[500], fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
              ],

              // Email
              TextField(
                controller: _emailController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Email Address',
                  labelStyle: const TextStyle(color: Colors.grey),
                  prefixIcon: const Icon(Icons.email_outlined, color: Colors.grey),
                  filled: true,
                  fillColor: const Color(AppColors.bgSecondary),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(AppColors.border)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(AppColors.border)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(AppColors.accent), width: 1.5),
                  ),
                ),
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 16),

              // Password
              TextField(
                controller: _passwordController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Password',
                  labelStyle: const TextStyle(color: Colors.grey),
                  prefixIcon: const Icon(Icons.lock_outlined, color: Colors.grey),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscurePassword ? Icons.visibility_off : Icons.visibility,
                      color: Colors.grey,
                    ),
                    onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                  ),
                  filled: true,
                  fillColor: const Color(AppColors.bgSecondary),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(AppColors.border)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(AppColors.border)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(AppColors.accent), width: 1.5),
                  ),
                ),
                obscureText: _obscurePassword,
                onSubmitted: (_) => _login(),
              ),

              const SizedBox(height: 28),

              // Sign In button
              Consumer<AuthProvider>(
                builder: (context, auth, _) {
                  return ElevatedButton(
                    onPressed: auth.isLoading ? null : _login,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(AppColors.primary),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 4,
                      shadowColor: const Color(AppColors.primary).withOpacity(0.4),
                    ),
                    child: auth.isLoading
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Sign In', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  );
                },
              ),

              const SizedBox(height: 24),

              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
                icon: const Icon(Icons.arrow_back_rounded),
                label: const Text('Back to account selection'),
              ),

              const Padding(
                padding: EdgeInsets.only(top: 8),
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
