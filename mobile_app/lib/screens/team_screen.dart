import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../models/barangay_user.dart';
import '../core/phone_number_utils.dart';
import 'barangay_account_request_screen.dart';

class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key});

  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  List<BarangayUser> _members = [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _fetchTeam();
  }

  Future<void> _fetchTeam() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final auth = Provider.of<AuthService>(context, listen: false);
    if (auth.token == null) return;

    try {
      final team = await ApiService.getTeam(auth.token!);
      const roleOrder = {'admin': 0, 'dispatcher': 1, 'responder': 2, 'staff': 3};
      team.sort((a, b) {
        final byRole = (roleOrder[a.role] ?? 4).compareTo(roleOrder[b.role] ?? 4);
        return byRole != 0 ? byRole : a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase());
      });
      if (mounted) setState(() => _members = team);
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _showMemberDetails(BarangayUser member, BarangayUser? currentUser) async {
    final canManage = currentUser?.isBarangayAdmin == true &&
        !member.isBarangayAdmin && member.id != currentUser?.id;
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        title: Text(member.fullName, style: const TextStyle(color: Color(0xFF111827))),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _memberDetail('Role', member.isDispatcher ? 'Dispatcher' : member.isBarangayAdmin ? 'Administrator' : member.isStaff ? 'Staff' : member.isResponder ? 'Responder' : member.role),
            const SizedBox(height: 10),
            _memberDetail('Email', member.email),
            if ((member.phone ?? '').isNotEmpty) ...[
              const SizedBox(height: 10),
              _memberDetail('Phone', PhoneNumberUtils.formatForDisplay(member.phone)),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
          if (canManage) ...[
            TextButton(onPressed: () => Navigator.pop(ctx, 'edit'), child: const Text('Edit')),
            TextButton(onPressed: () => Navigator.pop(ctx, 'remove'), child: const Text('Remove', style: TextStyle(color: Color(0xFFF87171)))),
          ],
        ],
      ),
    );
    if (action == 'edit') await _editMember(member);
    if (action == 'remove') await _removeMember(member);
  }

  Widget _memberDetail(String label, String value) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
      const SizedBox(height: 2),
      Text(value, style: const TextStyle(color: Color(0xFF111827), fontSize: 14)),
    ],
  );

  Future<void> _editMember(BarangayUser member) async {
    final auth = Provider.of<AuthService>(context, listen: false);
    final name = TextEditingController(text: member.fullName);
    final email = TextEditingController(text: member.email);
    final phone = TextEditingController(text: PhoneNumberUtils.digitsOnly(member.phone));
    final password = TextEditingController();
    var role = member.role;
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setModalState) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Text('Edit Member', style: TextStyle(color: Color(0xFF111827))),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, style: const TextStyle(color: Color(0xFF111827)), decoration: _modalInputDecoration('Full Name', Icons.person)),
          const SizedBox(height: 10),
          TextField(controller: email, keyboardType: TextInputType.emailAddress, style: const TextStyle(color: Color(0xFF111827)), decoration: _modalInputDecoration('Email', Icons.email)),
          const SizedBox(height: 10),
          TextField(controller: phone, keyboardType: TextInputType.phone, inputFormatters: PhoneNumberUtils.inputFormatters, style: const TextStyle(color: Color(0xFF111827)), decoration: _modalInputDecoration('Phone', Icons.phone)),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: role,
            dropdownColor: Colors.white,
            style: const TextStyle(color: Color(0xFF111827)),
            decoration: _modalInputDecoration('Role', Icons.badge_outlined),
            items: const [
              DropdownMenuItem(value: 'dispatcher', child: Text('Dispatcher')),
              DropdownMenuItem(value: 'responder', child: Text('Responder')),
              DropdownMenuItem(value: 'staff', child: Text('Staff')),
            ],
            onChanged: (value) => setModalState(() => role = value ?? role),
          ),
          const SizedBox(height: 10),
          TextField(controller: password, obscureText: true, style: const TextStyle(color: Color(0xFF111827)), decoration: _modalInputDecoration('New password (leave blank to keep)', Icons.lock_reset)),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () async {
            if (name.text.trim().length < 2 ||
                !email.text.contains('@') ||
                (phone.text.isNotEmpty && !PhoneNumberUtils.isValid(phone.text)) ||
                (password.text.isNotEmpty && password.text.length < 8)) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Check the name, email, phone number, and password fields.')));
              return;
            }
            try {
              await ApiService.updateTeamMember(auth.token!, member.id, fullName: name.text.trim(), email: email.text.trim(), phone: PhoneNumberUtils.digitsOnly(phone.text), role: role, password: password.text);
              if (ctx.mounted) Navigator.pop(ctx, true);
            } catch (e) {
              if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not update member: $e')));
            }
          }, child: const Text('Save')),
        ],
      )),
    );
    if (saved == true) await _fetchTeam();
  }

  Future<void> _removeMember(BarangayUser member) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Text('Remove member?', style: TextStyle(color: Color(0xFF111827))),
        content: Text('Remove ${member.fullName} from the Barangay team? Their account will be deactivated.', style: const TextStyle(color: Color(0xFF475569))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Remove', style: TextStyle(color: Color(0xFFF87171)))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      final token = Provider.of<AuthService>(context, listen: false).token!;
      await ApiService.deactivateMember(token, member.id);
      await _fetchTeam();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Member removed.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not remove member: $e')));
    }
  }

  Future<bool> _hasActiveCoordinationRequest(AuthService auth) async {
    try {
      final data = await auth.loadCoordinationRequest();
      return data['coordination_verified'] == true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> _showCoordinationRequiredDialog() async {
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            backgroundColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: const Text(
              'Barangay Account Request Required',
              style: TextStyle(color: Color(0xFF111827), fontWeight: FontWeight.bold),
            ),
            content: const Text(
              'Your barangay needs an approved and active Barangay Account Request before you can add a dispatcher account.',
              style: TextStyle(color: Color(0xFF475569), height: 1.45),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel'),
              ),
              FilledButton.icon(
                onPressed: () => Navigator.pop(dialogContext, true),
                icon: const Icon(Icons.assignment_outlined, size: 18),
                label: const Text('View Account Request'),
                style: FilledButton.styleFrom(backgroundColor: const Color(0xFF1B4F72)),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _openCoordinationRequestFromSheet(BuildContext sheetContext) async {
    Navigator.pop(sheetContext);
    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const BarangayAccountRequestScreen()),
    );
  }

  void _showAddMemberModal() {
    final auth = Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;
    if (user == null || !user.isBarangayAdmin) return;

    final nameController = TextEditingController();
    final emailController = TextEditingController();
    final passwordController = TextEditingController();
    final phoneController = TextEditingController();
    String selectedRole = user.isBarangayAdmin ? 'responder' : 'staff';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => Padding(
          padding: EdgeInsets.only(
            top: 24,
            left: 24,
            right: 24,
            bottom: MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    user.isBarangayAdmin ? 'Add Barangay Team Member' : 'Add Staff Member',
                    style: const TextStyle(color: Color(0xFF111827), fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.grey),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              if (user.isBarangayAdmin) ...[
                const Text('Role', style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFDCE4EF)),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      isExpanded: true,
                      dropdownColor: Colors.white,
                      style: const TextStyle(color: Color(0xFF111827)),
                      value: selectedRole,
                      items: const [
                        DropdownMenuItem(value: 'dispatcher', child: Text('Dispatcher')),
                        DropdownMenuItem(value: 'responder', child: Text('Responder')),
                        DropdownMenuItem(value: 'staff', child: Text('Staff')),
                      ],
                      onChanged: (v) async {
                        if (v != 'dispatcher') {
                          setModalState(() => selectedRole = v ?? 'responder');
                          return;
                        }
                        final hasActiveRequest = await _hasActiveCoordinationRequest(auth);
                        if (!mounted) return;
                        if (hasActiveRequest) {
                          setModalState(() => selectedRole = 'dispatcher');
                          return;
                        }
                        final wantsRequest = await _showCoordinationRequiredDialog();
                        if (wantsRequest && mounted && context.mounted) {
                          await _openCoordinationRequestFromSheet(context);
                        }
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],

              TextField(
                controller: nameController,
                style: const TextStyle(color: Color(0xFF111827)),
                decoration: _modalInputDecoration('Full Name', Icons.person),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: emailController,
                keyboardType: TextInputType.emailAddress,
                style: const TextStyle(color: Color(0xFF111827)),
                decoration: _modalInputDecoration('Email Address', Icons.email),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phoneController,
                keyboardType: TextInputType.phone,
                inputFormatters: PhoneNumberUtils.inputFormatters,
                style: const TextStyle(color: Color(0xFF111827)),
                decoration: _modalInputDecoration('Phone Number (Optional)', Icons.phone),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: passwordController,
                obscureText: true,
                style: const TextStyle(color: Color(0xFF111827)),
                decoration: _modalInputDecoration('Password (Min 8 chars)', Icons.lock),
              ),
              const SizedBox(height: 24),

              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: () async {
                    final name = nameController.text.trim();
                    final email = emailController.text.trim();
                    final password = passwordController.text;
                    if (name.isEmpty || email.isEmpty || password.length < 8) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Enter a name, valid email, and password with at least 8 characters.')),
                      );
                      return;
                    }
                    if (phoneController.text.isNotEmpty && !PhoneNumberUtils.isValid(phoneController.text)) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Enter an 11-digit phone number starting with 09.')),
                      );
                      return;
                    }
                    try {
                      await ApiService.addTeamMember(
                        auth.token!,
                        fullName: name,
                        email: email,
                        password: password,
                        phone: PhoneNumberUtils.digitsOnly(phoneController.text),
                        role: selectedRole,
                      );
                      Navigator.pop(ctx);
                      _fetchTeam();
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('${selectedRole.replaceAll('_', ' ').toUpperCase()} added successfully!'),
                            backgroundColor: const Color(0xFF10B981),
                          ),
                        );
                      }
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
                      );
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0284C7),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Add Member', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _modalInputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
      prefixIcon: Icon(icon, color: const Color(0xFF0087C7), size: 18),
      filled: true,
      fillColor: const Color(0xFFF8FAFC),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFFDCE4EF)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFFDCE4EF)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);
    final user = auth.currentUser;

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5F9),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Barangay Management', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            Text('${_members.length} members', style: const TextStyle(fontSize: 12, color: Color(0xFFD6E3F0))),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchTeam),
        ],
      ),
      body: _buildMembersContent(user),
      floatingActionButton: user?.canManageTeam == true
          ? FloatingActionButton.extended(
              backgroundColor: const Color(0xFF0284C7),
              foregroundColor: Colors.white,
              onPressed: _showAddMemberModal,
              icon: const Icon(Icons.person_add),
              label: const Text('Add Member'),
            )
          : null,
    );
  }

  Widget _buildMembersContent(BarangayUser? user) {
    if (_isLoading) return const Center(child: CircularProgressIndicator(color: Color(0xFF0087C7)));
    if (_errorMessage != null) {
      return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 12),
                      ElevatedButton(onPressed: _fetchTeam, child: const Text('Try Again')),
                    ],
                  ),
                );
    }
    if (_members.isEmpty) {
      return const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.group, size: 60, color: Color(0xFF94A3B8)),
                          SizedBox(height: 12),
                          Text('No team members found', style: TextStyle(color: Color(0xFF64748B))),
                        ],
                      ),
                    );
    }
    return RefreshIndicator(
                      onRefresh: _fetchTeam,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _members.length,
                        itemBuilder: (context, index) {
                          final m = _members[index];
                          return _buildMemberCard(m, user);
                        },
                      ),
                    );
  }

  Widget _buildMemberCard(BarangayUser member, BarangayUser? currentUser) {
    Color badgeColor = const Color(0xFF0087C7);
    String roleLabel = member.role.toUpperCase().replaceAll('_', ' ');

    if (member.isDispatcher) {
      badgeColor = const Color(0xFFF59E0B);
      roleLabel = 'DISPATCHER';
    } else if (member.isBarangayAdmin) {
      badgeColor = const Color(0xFF0284C7);
      roleLabel = 'ADMINISTRATOR';
    } else if (member.isResponder) {
      badgeColor = const Color(0xFF10B981);
      roleLabel = 'RESPONDER';
    } else if (member.role == 'staff') {
      badgeColor = const Color(0xFF7C3AED);
      roleLabel = 'STAFF';
    }

    return Card(
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFFDCE4EF)),
      ),
      child: InkWell(
        onTap: () => _showMemberDetails(member, currentUser),
        borderRadius: BorderRadius.circular(14),
        child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: badgeColor.withOpacity(0.2),
              child: Text(
                member.fullName.isNotEmpty ? member.fullName[0].toUpperCase() : '?',
                style: TextStyle(color: badgeColor, fontWeight: FontWeight.bold, fontSize: 18),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    member.fullName,
                    style: const TextStyle(
                      color: const Color(0xFF111827),
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    member.email,
                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                  ),
                  if (member.phone != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      PhoneNumberUtils.formatForDisplay(member.phone),
                      style: const TextStyle(color: Color(0xFF0087C7), fontSize: 12),
                    ),
                  ],
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: badgeColor.withOpacity(0.2),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: badgeColor.withOpacity(0.6)),
              ),
              child: Text(
                roleLabel,
                style: TextStyle(color: badgeColor, fontSize: 10, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        ),
      ),
    );
  }
}
