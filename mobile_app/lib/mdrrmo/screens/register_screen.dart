import 'package:flutter/material.dart';
import '../core/constants.dart';
import 'registration_form_screen.dart';

/// Responders register through the mobile app and await administrator review.
class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(AppColors.bgPrimary),
      appBar: AppBar(
        backgroundColor: const Color(AppColors.bgSecondary),
        title: const Text('Create Responder Account'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 16),
            // Header banner
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    const Color(AppColors.primary).withOpacity(0.3),
                    const Color(AppColors.bgSecondary),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(AppColors.primary).withOpacity(0.4)),
              ),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(AppColors.primary).withOpacity(0.2),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.shield_rounded, color: Color(AppColors.accent), size: 48),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Responder Registration',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Create a Responder account. Your account will be reviewed and verified by an administrator in the Web Dashboard before you can log in.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey[400], fontSize: 13, height: 1.5),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),

            // Info cards
            _buildInfoRow(Icons.assignment_ind_rounded, const Color(0xFF0EA5E9),
                'For Response Personnel',
                'Rescue, EMR, Ambulance, Fire, Evacuation, Communications, and other specialized units'),
            const SizedBox(height: 12),
            _buildInfoRow(Icons.verified_user_rounded, const Color(AppColors.success),
                'Account Verification Required',
                'Accounts are reviewed by the MDRRMO Command Center before activation'),
            const SizedBox(height: 12),
            _buildInfoRow(Icons.notifications_active_rounded, const Color(AppColors.warning),
                'Dispatch Ready',
                'Once verified, you will receive real-time dispatch alerts and incident response assignments'),
            const SizedBox(height: 40),

            // Register button
            ElevatedButton.icon(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => const RegistrationFormScreen(
                    role: 'responder',
                    roleTitle: 'Responder',
                  ),
                ),
              ),
              icon: const Icon(Icons.arrow_forward_rounded),
              label: const Text(
                'Begin Registration',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(AppColors.primary),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(IconData icon, Color color, String title, String subtitle) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(AppColors.bgSecondary),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                const SizedBox(height: 3),
                Text(subtitle, style: TextStyle(fontSize: 12, color: Colors.grey[400])),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
