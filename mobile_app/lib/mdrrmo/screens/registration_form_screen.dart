import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../core/constants.dart';

class RegistrationFormScreen extends StatefulWidget {
  final String role;
  final String roleTitle;

  const RegistrationFormScreen({super.key, required this.role, required this.roleTitle});

  @override
  State<RegistrationFormScreen> createState() => _RegistrationFormScreenState();
}

class _RegistrationFormScreenState extends State<RegistrationFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  final Set<String> _selectedSpecializations = {'Rescue Officer'};

  final List<Map<String, dynamic>> _specializations = [
    {
      'name': 'Rescue Officer',
      'icon': Icons.person_search_rounded,
      'incidents': 'Vehicular Accident, Missing Person, Building Collapse, Entrapment, Landslide',
    },
    {
      'name': 'Swift Water Rescue Officer',
      'icon': Icons.water_rounded,
      'incidents': 'Flood, Flash Flood, River Rescue, Drowning, Rising Water Level',
    },
    {
      'name': 'Mountain Rescue Officer',
      'icon': Icons.terrain_rounded,
      'incidents': 'Missing Person, Mountain Rescue, Landslide, Forest Fire, Upland Evacuation',
    },
    {
      'name': 'Emergency Medical Responder (EMR)',
      'icon': Icons.medical_services_rounded,
      'incidents': 'Medical Emergency, Vehicular Accident, Drowning, Fire-Related Injuries',
    },
    {
      'name': 'Ambulance Officer / EMS Personnel',
      'icon': Icons.local_hospital_rounded,
      'incidents': 'Medical Emergency, Patient Transport, Mass Casualty, Vehicular Accident',
    },
    {
      'name': 'Fire Response Officer',
      'icon': Icons.local_fire_department_rounded,
      'incidents': 'Residential Fire, Grass Fire, Forest Fire, Electrical Fire, Gas Leak',
    },
    {
      'name': 'Evacuation Officer',
      'icon': Icons.exit_to_app_rounded,
      'incidents': 'Flood, Typhoon, Landslide, Strong Wind, Fire, Earthquake',
    },
    {
      'name': 'Safety & Security Officer',
      'icon': Icons.security_rounded,
      'incidents': 'Evacuation, Crowd Control, Hazard Zone Security, Public Safety',
    },
    {
      'name': 'Traffic & Road Clearing Officer',
      'icon': Icons.traffic_rounded,
      'incidents': 'Fallen Tree, Road Obstruction, Vehicular Accident, Landslide Blockage',
    },
    {
      'name': 'Communications Officer',
      'icon': Icons.radio_rounded,
      'incidents': 'All Emergency Incidents, Dispatch Coordination, Hotline Operations',
    },
    {
      'name': 'Logistics Response Officer',
      'icon': Icons.inventory_2_rounded,
      'incidents': 'Relief Distribution, Resource Deployment, Equipment Requests',
    },
    {
      'name': 'Damage Assessment Officer',
      'icon': Icons.assessment_rounded,
      'incidents': 'Earthquake, Flood, Landslide, Strong Wind, Fire Damage Assessment',
    },
  ];

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedSpecializations.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select at least one specialization'),
          backgroundColor: Color(AppColors.danger),
        ),
      );
      return;
    }

    final auth = Provider.of<AuthProvider>(context, listen: false);
    try {
      final unitTypeString = _selectedSpecializations.join(', ');
      final rawPhone = _phoneController.text.trim();
      final sanitizedPhone = rawPhone.isNotEmpty ? rawPhone.replaceAll(RegExp(r'[\s-]'), '') : null;
      final userData = {
        'full_name': _nameController.text.trim(),
        'email': _emailController.text.trim(),
        'phone': sanitizedPhone,
        'password': _passwordController.text,
        'role': 'responder',
        'unit_type': unitTypeString,
      };

      await auth.register(userData);

      if (mounted) {
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(AppColors.bgSecondary),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            icon: Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                color: Color(0xFF064E3B),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle_rounded, color: Color(AppColors.success), size: 48),
            ),
            title: const Text(
              'Registration Submitted!',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            content: const Text(
              'Your Responder account has been submitted.\n\n'
              'Your account is pending verification by the MDRRMO Command Center at the Web Dashboard.\n\n'
              'You will be able to log in once an administrator approves your account.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey, height: 1.5),
            ),
            actions: [
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    Navigator.popUntil(context, (route) => route.isFirst);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(AppColors.primary),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Back to Login'),
                ),
              ),
            ],
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString()),
            backgroundColor: const Color(AppColors.danger),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(AppColors.bgPrimary),
      appBar: AppBar(
        backgroundColor: const Color(AppColors.bgSecondary),
        title: const Text('Officer Registration'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Section: Personal Info
              _buildSectionLabel('PERSONAL INFORMATION'),
              const SizedBox(height: 12),

              TextFormField(
                controller: _nameController,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration('Full Name', Icons.person_outlined),
                textCapitalization: TextCapitalization.words,
                validator: (v) => v == null || v.trim().isEmpty ? 'Full name is required' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _emailController,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration('Email Address', Icons.email_outlined),
                keyboardType: TextInputType.emailAddress,
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return 'Email is required';
                  if (!v.contains('@')) return 'Enter a valid email';
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _phoneController,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration('Phone Number', Icons.phone_outlined),
                keyboardType: TextInputType.phone,
                validator: (v) => v == null || v.trim().isEmpty ? 'Phone number is required' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _passwordController,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration('Password', Icons.lock_outlined).copyWith(
                  suffixIcon: IconButton(
                    icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility, color: Colors.grey),
                    onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                  ),
                ),
                obscureText: _obscurePassword,
                validator: (v) {
                  if (v == null || v.length < 6) return 'Password must be at least 6 characters';
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _confirmPasswordController,
                style: const TextStyle(color: Colors.white),
                decoration: _inputDecoration('Confirm Password', Icons.lock_outlined).copyWith(
                  suffixIcon: IconButton(
                    icon: Icon(_obscureConfirm ? Icons.visibility_off : Icons.visibility, color: Colors.grey),
                    onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                  ),
                ),
                obscureText: _obscureConfirm,
                validator: (v) {
                  if (v != _passwordController.text) return 'Passwords do not match';
                  return null;
                },
              ),
              const SizedBox(height: 28),

              // Section: Specialization
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildSectionLabel('SELECT YOUR SPECIALIZATIONS'),
                  if (_selectedSpecializations.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                      decoration: BoxDecoration(
                        color: const Color(AppColors.accent).withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(AppColors.accent).withValues(alpha: 0.4)),
                      ),
                      child: Text(
                        '${_selectedSpecializations.length} selected',
                        style: const TextStyle(
                          color: Color(AppColors.accent),
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Choose one or more MDRRMO specializations that fit your qualifications.',
                style: TextStyle(color: Colors.grey[500], fontSize: 12),
              ),
              const SizedBox(height: 12),

              ..._specializations.map((spec) {
                final name = spec['name'] as String;
                final isSelected = _selectedSpecializations.contains(name);
                return GestureDetector(
                  onTap: () {
                    setState(() {
                      if (isSelected) {
                        _selectedSpecializations.remove(name);
                      } else {
                        _selectedSpecializations.add(name);
                      }
                    });
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? const Color(AppColors.primary).withValues(alpha: 0.2)
                          : const Color(AppColors.bgSecondary),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected
                            ? const Color(AppColors.accent)
                            : const Color(AppColors.border),
                        width: isSelected ? 1.5 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? const Color(AppColors.accent).withValues(alpha: 0.2)
                                : Colors.white.withValues(alpha: 0.05),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Icon(
                            spec['icon'] as IconData,
                            size: 20,
                            color: isSelected ? const Color(AppColors.accent) : Colors.grey,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                  color: isSelected ? Colors.white : Colors.white70,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                spec['incidents'] as String,
                                style: const TextStyle(fontSize: 10, color: Colors.grey),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 150),
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: isSelected ? const Color(AppColors.accent) : Colors.transparent,
                            border: Border.all(
                              color: isSelected ? const Color(AppColors.accent) : Colors.grey[600]!,
                              width: 1.5,
                            ),
                          ),
                          child: isSelected
                              ? const Icon(Icons.check, color: Colors.white, size: 15)
                              : null,
                        ),
                      ],
                    ),
                  ),
                );
              }),

              const SizedBox(height: 32),

              Consumer<AuthProvider>(
                builder: (context, auth, _) {
                  return ElevatedButton(
                    onPressed: auth.isLoading ? null : _submit,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(AppColors.primary),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: auth.isLoading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text(
                            'Submit Registration',
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                  );
                },
              ),
              const SizedBox(height: 24),

              // Verification note
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(AppColors.warning).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(AppColors.warning).withValues(alpha: 0.3)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline_rounded, color: Color(AppColors.warning), size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Your account will be reviewed and approved by the MDRRMO Command Center before you can log in.',
                        style: TextStyle(color: Color(AppColors.warning), fontSize: 12, height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionLabel(String label) {
    return Text(
      label,
      style: const TextStyle(
        fontSize: 11,
        color: Colors.grey,
        fontWeight: FontWeight.bold,
        letterSpacing: 1.5,
      ),
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Colors.grey),
      prefixIcon: Icon(icon, color: Colors.grey),
      filled: true,
      fillColor: const Color(AppColors.bgSecondary),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(AppColors.border)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(AppColors.border)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(AppColors.accent), width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(AppColors.danger)),
      ),
    );
  }
}
