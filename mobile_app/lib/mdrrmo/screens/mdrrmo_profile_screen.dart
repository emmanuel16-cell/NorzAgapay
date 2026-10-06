import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../widgets/legal_dialogs.dart';
import '../providers/auth_provider.dart';
import '../../widgets/demo_data_switch_card.dart';

const _profileSpecializations = <String>[
  'Rescue Officer',
  'Swift Water Rescue Officer',
  'Mountain Rescue Officer',
  'Emergency Medical Responder (EMR)',
  'Ambulance Officer / EMS Personnel',
  'Fire Response Officer',
  'Evacuation Officer',
  'Safety & Security Officer',
  'Traffic & Road Clearing Officer',
  'Communications Officer',
  'Logistics Response Officer',
  'Damage Assessment Officer',
];

class MdrrmoProfileScreen extends StatefulWidget {
  const MdrrmoProfileScreen({super.key});

  @override
  State<MdrrmoProfileScreen> createState() => _MdrrmoProfileScreenState();
}

class _MdrrmoProfileScreenState extends State<MdrrmoProfileScreen> {
  static const _navy = Color(0xFF0C243B);
  static const _teal = Color(0xFF0D9488);

  Future<void> _editInformation() async {
    final auth = context.read<AuthProvider>();
    final user = auth.user;
    if (user == null) return;
    final name = TextEditingController(text: user.fullName);
    final phone = TextEditingController(text: user.phone ?? '');
    final formKey = GlobalKey<FormState>();
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Edit Information'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: name,
                textCapitalization: TextCapitalization.words,
                maxLength: 120,
                decoration: const InputDecoration(labelText: 'Full name'),
                validator: (value) => (value?.trim().length ?? 0) < 2
                    ? 'Enter your full name.'
                    : null,
              ),
              TextFormField(
                controller: phone,
                keyboardType: TextInputType.phone,
                maxLength: 30,
                decoration: const InputDecoration(
                  labelText: 'Contact number (optional)',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate())
                Navigator.pop(dialogContext, true);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (saved == true && mounted) {
      try {
        await auth.updateMyProfile(fullName: name.text, phone: phone.text);
        _showMessage('Profile updated.');
      } catch (error) {
        _showMessage('$error', error: true);
      }
    }
    name.dispose();
    phone.dispose();
  }

  Future<void> _editSpecializations() async {
    final auth = context.read<AuthProvider>();
    final selected = <String>{
      ...(auth.user?.specializations ?? const <String>[]),
    };
    final updated = await showDialog<List<String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Specializations'),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: _profileSpecializations
                    .map(
                      (specialization) => CheckboxListTile(
                        dense: true,
                        value: selected.contains(specialization),
                        title: Text(
                          specialization,
                          style: const TextStyle(fontSize: 13),
                        ),
                        activeColor: _teal,
                        contentPadding: EdgeInsets.zero,
                        onChanged: (value) => setDialogState(() {
                          if (value == true)
                            selected.add(specialization);
                          else
                            selected.remove(specialization);
                        }),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, selected.toList()),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (updated == null || !mounted) return;
    try {
      await auth.updateMyProfile(specializations: updated);
      _showMessage(
        updated.isEmpty
            ? 'Specializations cleared.'
            : 'Specializations updated.',
      );
    } catch (error) {
      _showMessage('$error', error: true);
    }
  }

  Future<void> _changePassword() async {
    final current = TextEditingController();
    final next = TextEditingController();
    final confirm = TextEditingController();
    final formKey = GlobalKey<FormState>();
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Change Password'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: current,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Current password',
                ),
                validator: (value) => (value?.isEmpty ?? true)
                    ? 'Enter your current password.'
                    : null,
              ),
              TextFormField(
                controller: next,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'New password'),
                validator: (value) => (value?.length ?? 0) < 8
                    ? 'Use at least 8 characters.'
                    : null,
              ),
              TextFormField(
                controller: confirm,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Confirm new password',
                ),
                validator: (value) =>
                    value != next.text ? 'Passwords do not match.' : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate())
                Navigator.pop(dialogContext, true);
            },
            child: const Text('Update'),
          ),
        ],
      ),
    );
    if (saved == true && mounted) {
      try {
        await context.read<AuthProvider>().changeMyPassword(
          current.text,
          next.text,
        );
        _showMessage('Password updated.');
      } catch (error) {
        _showMessage('$error', error: true);
      }
    }
    current.dispose();
    next.dispose();
    confirm.dispose();
  }

  Future<void> _signOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted)
      await context.read<AuthProvider>().logout();
  }

  void _showMessage(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? const Color(0xFFEF4444) : _teal,
      ),
    );
  }

  Widget _setting({
    required IconData icon,
    required Color color,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(13),
      border: Border.all(color: const Color(0xFFE2E8F0)),
    ),
    child: ListTile(
      leading: Icon(icon, color: color),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 12)),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    if (user == null)
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: _navy,
        foregroundColor: Colors.white,
        title: const Text(
          'Profile',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [_navy, Color(0xFF1E3A5F)],
              ),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: const Color(0xFF0D9488),
                  child: Text(
                    user.fullName.isEmpty
                        ? 'R'
                        : user.fullName[0].toUpperCase(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user.fullName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        user.email,
                        style: const TextStyle(
                          color: Color(0xFFCBD5E1),
                          fontSize: 12,
                        ),
                      ),
                      if ((user.phone ?? '').isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          user.phone!,
                          style: const TextStyle(
                            color: Color(0xFFCBD5E1),
                            fontSize: 12,
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      const Text(
                        'MDRRMO Responder',
                        style: TextStyle(
                          color: Color(0xFF5EEAD4),
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          if (user.specializations.isNotEmpty) ...[
            const Text(
              'SPECIALIZATION',
              style: TextStyle(
                color: Color(0xFF64748B),
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.1,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: user.specializations
                  .map(
                    (value) => Chip(
                      label: Text(value),
                      backgroundColor: const Color(0xFFE6F6F3),
                      side: BorderSide.none,
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 14),
          ],
          const Text(
            'Settings',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 17,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 10),
          const DemoDataSwitchCard(margin: EdgeInsets.zero),
          const SizedBox(height: 10),
          _setting(
            icon: Icons.manage_accounts_outlined,
            color: const Color(0xFF7C3AED),
            title: 'Edit Information',
            subtitle: 'Update your name and contact number',
            onTap: _editInformation,
          ),
          _setting(
            icon: Icons.badge_outlined,
            color: _teal,
            title: 'Specialization',
            subtitle: 'Edit your response specialization',
            onTap: _editSpecializations,
          ),
          _setting(
            icon: Icons.lock_reset_rounded,
            color: const Color(0xFFD97706),
            title: 'Change Password',
            subtitle: 'Securely update your account password',
            onTap: _changePassword,
          ),
          const SizedBox(height: 5),
          _setting(
            icon: Icons.gavel_rounded,
            color: _navy,
            title: 'Terms and Conditions',
            subtitle: 'Review the mobile app terms',
            onTap: () => LegalDialogs.showTermsAndConditions(context),
          ),
          _setting(
            icon: Icons.privacy_tip_rounded,
            color: _teal,
            title: 'Privacy Policy',
            subtitle: 'How account and incident information is handled',
            onTap: () => LegalDialogs.showPrivacyPolicy(context),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _signOut,
            icon: const Icon(Icons.logout_rounded),
            label: const Text('Sign Out'),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFEF4444),
              side: const BorderSide(color: Color(0xFFEF4444)),
              padding: const EdgeInsets.symmetric(vertical: 13),
            ),
          ),
        ],
      ),
    );
  }
}
