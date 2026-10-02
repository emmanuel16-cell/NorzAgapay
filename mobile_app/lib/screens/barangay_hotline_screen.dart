import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../core/phone_number_utils.dart';

class BarangayHotlineScreen extends StatefulWidget {
  const BarangayHotlineScreen({super.key});

  @override
  State<BarangayHotlineScreen> createState() => _BarangayHotlineScreenState();
}

class _BarangayHotlineScreenState extends State<BarangayHotlineScreen> {
  List<Map<String, dynamic>> _hotlineEntries = [];
  bool _hasLoadedNumbers = false;
  bool _isLoadingHotlines = false;
  String? _hotlineSyncError;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final user = context.read<AuthService>().currentUser;
    if (user == null || _hasLoadedNumbers) return;
    _hasLoadedNumbers = true;
    _isLoadingHotlines = true;
    _loadHotlineNumbers(user.barangayId);
  }

  Future<void> _loadHotlineNumbers(String barangayId) async {
    try {
      final entries = await ApiService.getBarangayHotlines(barangayId);
      if (mounted) {
        setState(() {
          _hotlineEntries = entries;
          _hotlineSyncError = null;
          _isLoadingHotlines = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _hotlineSyncError = 'Could not load hotline numbers from the database. Check your connection and try again.';
          _isLoadingHotlines = false;
          _hotlineEntries = [];
        });
      }
    }
  }

  Future<void> _persistNumbers(List<Map<String, dynamic>> entries) async {
    final auth = context.read<AuthService>();
    if (auth.currentUser == null || auth.token == null) return;
    try {
      final saved = await ApiService.saveBarangayHotlines(auth.token!, entries);
      if (mounted) {
        setState(() {
          _hotlineEntries = saved;
          _hotlineSyncError = null;
        });
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save hotline to the server: $error')));
      }
    }
  }

  Future<void> _addHotlineNumber() async {
    final purposeController = TextEditingController();
    final numberControllers = <TextEditingController>[TextEditingController()];
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Add Hotline Number'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: purposeController,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Purpose of this hotline',
                    hintText: 'e.g. Medical emergency',
                  ),
                ),
                const SizedBox(height: 12),
                ...numberControllers.asMap().entries.map((entry) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: entry.value,
                              autofocus: entry.key == 0,
                              keyboardType: TextInputType.phone,
                              inputFormatters: PhoneNumberUtils.inputFormatters,
                              decoration: InputDecoration(
                                labelText: numberControllers.length > 1 ? 'Mobile number ${entry.key + 1}' : 'Mobile number',
                                hintText: '09xx xxx xxxx',
                              ),
                            ),
                          ),
                          if (numberControllers.length > 1)
                            IconButton(
                              tooltip: 'Remove number',
                              onPressed: () => setDialogState(() => numberControllers.removeAt(entry.key).dispose()),
                              icon: const Icon(Icons.remove_circle_outline),
                            ),
                        ],
                      ),
                    )),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => setDialogState(() => numberControllers.add(TextEditingController())),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Add another number'),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, {
                'purpose': purposeController.text.trim(),
                'numbers': numberControllers.map((controller) => controller.text.trim()).where((number) => number.isNotEmpty).toList(),
              }),
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
    purposeController.dispose();
    for (final controller in numberControllers) {
      controller.dispose();
    }
    if (result == null) return;
    final purpose = result['purpose'] as String;
    final numbers = (result['numbers'] as List).cast<String>();
    if (purpose.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter the purpose of this hotline.')));
      return;
    }
    if (numbers.isEmpty || numbers.any((number) => !PhoneNumberUtils.isValid(number))) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter at least one valid mobile number.')));
      return;
    }
    await _persistNumbers([
      ..._hotlineEntries,
      {'purpose': purpose, 'numbers': numbers},
    ]);
  }

  Future<void> _editHotlineEntry(int entryIndex) async {
    final entry = _hotlineEntries[entryIndex];
    final purposeController = TextEditingController(text: entry['purpose']?.toString() ?? '');
    final numberControllers = List<String>.from(entry['numbers'] as List)
        .map((number) => TextEditingController(text: PhoneNumberUtils.digitsOnly(number)))
        .toList();
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Edit Hotline'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: purposeController,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(labelText: 'Purpose of this hotline'),
                ),
                const SizedBox(height: 12),
                ...numberControllers.asMap().entries.map((numberEntry) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: numberEntry.value,
                              keyboardType: TextInputType.phone,
                              inputFormatters: PhoneNumberUtils.inputFormatters,
                              decoration: InputDecoration(
                                labelText: numberControllers.length > 1 ? 'Mobile number ${numberEntry.key + 1}' : 'Mobile number',
                                hintText: '09xx xxx xxxx',
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Remove number',
                            onPressed: () => setDialogState(() => numberControllers.removeAt(numberEntry.key).dispose()),
                            icon: const Icon(Icons.remove_circle_outline),
                          ),
                        ],
                      ),
                    )),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => setDialogState(() => numberControllers.add(TextEditingController())),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Add another number'),
                  ),
                ),
              ],
            ),
          ),
          actionsAlignment: MainAxisAlignment.spaceBetween,
          actions: [
            TextButton.icon(
              onPressed: () => Navigator.pop(dialogContext, {'delete': true}),
              icon: const Icon(Icons.delete_outline_rounded),
              label: const Text('Delete'),
              style: TextButton.styleFrom(foregroundColor: const Color(0xFFDC2626)),
            ),
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, {
                'purpose': purposeController.text.trim(),
                'numbers': numberControllers.map((controller) => controller.text.trim()).where((number) => number.isNotEmpty).toList(),
              }),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    purposeController.dispose();
    for (final controller in numberControllers) {
      controller.dispose();
    }
    if (result == null || !mounted) return;
    if (result['delete'] == true) {
      final updated = List<Map<String, dynamic>>.from(_hotlineEntries)..removeAt(entryIndex);
      await _persistNumbers(updated);
      return;
    }

    final purpose = result['purpose'] as String;
    final numbers = (result['numbers'] as List).cast<String>();
    if (purpose.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter the purpose of this hotline.')));
      return;
    }
    if (numbers.isEmpty || numbers.any((number) => !PhoneNumberUtils.isValid(number))) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Keep at least one valid mobile number.')));
      return;
    }
    final updated = List<Map<String, dynamic>>.from(_hotlineEntries);
    updated[entryIndex] = {'purpose': purpose, 'numbers': numbers};
    await _persistNumbers(updated);
  }

  Future<void> _call(String number) async {
    final uri = Uri(scheme: 'tel', path: number.replaceAll(RegExp(r'[^0-9+]'), ''));
    if (!await launchUrl(uri) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Unable to open the phone app.')));
    }
  }

  Future<void> _launch(Uri uri) async {
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Unable to open that link.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthService>().currentUser;
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FB),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        foregroundColor: Colors.white,
        flexibleSpace: Container(
          width: double.infinity,
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)], begin: Alignment.topLeft, end: Alignment.bottomRight),
          ),
        ),
        title: const Text('Emergency Hotlines', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
        children: [
          _nationalEmergency(),
          const SizedBox(height: 20),
          _sectionHeader('MDRRMO Norzagaray', 'Municipal Command Desk', const Color(0xFF1B4F72)),
          const SizedBox(height: 10),
          _mdrrmoCard(),
          const SizedBox(height: 22),
          _sectionHeader('Philippine National Police (PNP)', 'Norzagaray Station', const Color(0xFF1E3A8A)),
          const SizedBox(height: 10),
          _contactCard(
            icon: Icons.local_police_rounded,
            color: const Color(0xFF1E3A8A),
            title: 'Norzagaray Municipal Police Station',
            description: 'Patrol base, criminal emergency, and 24/7 law enforcement assistance.',
            number: '0998-598-5389',
          ),
          const SizedBox(height: 22),
          _sectionHeader('Bureau of Fire Protection (BFP)', 'Norzagaray Fire Station', const Color(0xFFEA580C)),
          const SizedBox(height: 10),
          _contactCard(
            icon: Icons.local_fire_department_rounded,
            color: const Color(0xFFEA580C),
            title: 'Norzagaray Fire Station',
            description: 'Fire suppression, hazardous materials containment, and search & rescue.',
            number: '0943-348-1854',
          ),
          const SizedBox(height: 24),
          _sectionHeader('Barangay Emergency Hotline', user?.barangayName ?? 'Your Barangay', const Color(0xFF0D9488)),
          const SizedBox(height: 10),
          _dispatcherCard(canEdit: user?.canManageContent == true),
          const SizedBox(height: 12),
          if (_hotlineSyncError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_hotlineSyncError!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Color(0xFFB45309))),
            ),
          const Text(
            'Hotline numbers are shared with residents who select this barangay.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
          ),
        ],
      ),
    );
  }

  Widget _nationalEmergency() => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [Color(0xFFDC2626), Color(0xFFB91C1C)], begin: Alignment.topLeft, end: Alignment.bottomRight),
          borderRadius: BorderRadius.circular(18),
          boxShadow: [BoxShadow(color: const Color(0xFFDC2626).withValues(alpha: .25), blurRadius: 14, offset: const Offset(0, 6))],
        ),
        child: Column(children: [
          Row(children: [
            Container(width: 56, height: 56, decoration: BoxDecoration(color: Colors.white.withValues(alpha: .2), shape: BoxShape.circle), child: const Icon(Icons.emergency_share_rounded, color: Colors.white, size: 32)),
            const SizedBox(width: 16),
            const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('NATIONAL EMERGENCY', style: TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.1)),
              SizedBox(height: 2),
              Text('Dial 911', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900)),
              SizedBox(height: 2),
              Text('Toll-Free Nationwide 24/7 Dispatch', style: TextStyle(color: Colors.white, fontSize: 11.5)),
            ])),
          ]),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: () => _call('911'),
              icon: const Icon(Icons.call_rounded, size: 20),
              label: const Text('Call 911'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: const Color(0xFFDC2626),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                elevation: 0,
                textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
              ),
            ),
          ),
        ]),
      );

  Widget _mdrrmoCard() => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: _cardDecoration(),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Municipal Disaster Risk Reduction & Management Office (Rescue Ng Garay)', style: TextStyle(fontSize: 13, color: Color(0xFF475569), height: 1.35)),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.center,
              children: [
                _actionChip(Icons.phone_rounded, 'Call MDRRMO Hotline', const Color(0xFFE6F4EA), const Color(0xFF1E8E3E), () => _call('0905-247-0355')),
                _actionChip(Icons.facebook_rounded, 'Rescue Ng Garay', const Color(0xFFE8F2FE), const Color(0xFF1A73E8), () => _launch(Uri.parse('https://www.facebook.com/RescueNgGaray'))),
                _actionChip(Icons.mail_rounded, 'Email MDRRMO', const Color(0xFFE8EEF5), const Color(0xFF1B4F72), () => _launch(Uri(scheme: 'mailto', path: 'norzagarayrescue2015@gmail.com'))),
              ],
            ),
          ),
          const SizedBox(height: 10),
          const Divider(height: 16),
          const Row(children: [Icon(Icons.info_outline, size: 14, color: Color(0xFF64748B)), SizedBox(width: 6), Text('Direct Mobile: 0905-247-0355', style: TextStyle(fontSize: 11.5, color: Color(0xFF64748B)))]),
        ]),
      );

  Widget _contactCard({required IconData icon, required Color color, required String title, required String description, required String number}) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: _cardDecoration(),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(width: 44, height: 44, decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)), child: Icon(icon, color: color, size: 24)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))), const SizedBox(height: 2), Text(description, style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B)))])),
          ]),
          const SizedBox(height: 14),
          Center(child: _actionChip(Icons.phone_rounded, 'Mobile: ${PhoneNumberUtils.formatForDisplay(number)}', color.withValues(alpha: .1), color, () => _call(number))),
        ]),
      );

  Widget _dispatcherCard({required bool canEdit}) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: _cardDecoration(),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Add hotline numbers and their purpose for your barangay:', style: TextStyle(fontSize: 12.5, color: Color(0xFF64748B), fontWeight: FontWeight.w500)),
          const SizedBox(height: 12),
          if (_isLoadingHotlines)
            const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: Center(child: CircularProgressIndicator(color: Color(0xFF0D9488))),
            )
          else if (_hotlineEntries.isEmpty)
            const Padding(padding: EdgeInsets.only(bottom: 12), child: Text('No hotline numbers added yet.', style: TextStyle(fontSize: 13, color: Color(0xFF64748B)))),
          ..._hotlineEntries.asMap().entries.map((entry) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.info_outline_rounded, color: Color(0xFF0D9488), size: 17),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              entry.value['purpose']?.toString() ?? 'Emergency Hotline',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                            ),
                          ),
                          if (canEdit)
                            IconButton(
                              tooltip: 'Edit hotline',
                              visualDensity: VisualDensity.compact,
                              onPressed: () => _editHotlineEntry(entry.key),
                              icon: const Icon(Icons.edit_outlined, color: Color(0xFF64748B), size: 20),
                            ),
                        ],
                      ),
                      ...List<String>.from(entry.value['numbers'] as List).map((number) => Padding(
                            padding: const EdgeInsets.only(top: 5),
                            child: Center(child: _actionChip(Icons.phone_rounded, 'Mobile: ${PhoneNumberUtils.formatForDisplay(number)}', const Color(0xFFE6F4EA), const Color(0xFF0D9488), () => _call(number))),
                          )),
                    ],
                  ),
                ),
              )),
          if (canEdit)
            SizedBox(width: double.infinity, child: OutlinedButton.icon(onPressed: _addHotlineNumber, icon: const Icon(Icons.add_rounded), label: const Text('Add Hotline Number'), style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFF0D9488), side: const BorderSide(color: Color(0xFF0D9488)), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))))),
        ]),
      );

  Widget _sectionHeader(String title, String badge, Color color) => Row(children: [
        Expanded(child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)))),
        Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), decoration: BoxDecoration(color: color.withValues(alpha: .1), borderRadius: BorderRadius.circular(6)), child: Text(badge, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: color))),
      ]);

  Widget _actionChip(IconData icon, String label, Color background, Color foreground, VoidCallback onPressed) => ElevatedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 18),
        label: Text(label),
        style: ElevatedButton.styleFrom(backgroundColor: background, foregroundColor: foreground, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)), padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11), textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
      );

  BoxDecoration _cardDecoration() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: .03), blurRadius: 10, offset: const Offset(0, 4))],
      );
}
