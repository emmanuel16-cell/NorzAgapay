import 'package:flutter/material.dart';

class LegalDialogs {
  static void showTermsAndConditions(BuildContext context) => _show(
        context,
        title: 'Terms and Conditions',
        subtitle: 'Norz-Agapay Barangay App',
        icon: Icons.gavel_rounded,
        color: const Color(0xFF1B4F72),
        content: '''
1. Use of the Barangay App
The Barangay App is for authorized barangay personnel to view public advisories and support local emergency response. Use the account and functions assigned to your role. Do not share your credentials or attempt to access another person's account.

2. Public Posts and Incident Reports
Use the reporting and posting tools for legitimate public safety and barangay response purposes. Provide accurate information, and only upload media that you are authorized to share. Do not post unlawful, misleading, abusive, or unrelated material.

3. Information Handling
Access personal information and incident details only as needed for your official duties. Do not copy, disclose, or use information outside the response purpose. Follow your barangay's records-handling and security procedures.

4. Account Security
Keep your device and sign-in credentials secure. Notify your administrator if you suspect unauthorized access, loss of a device, or exposure of information.

5. Service Availability
The app depends on device, network, and municipal services. Information may be delayed or unavailable during outages. Follow official emergency procedures and contact the appropriate response office directly when urgent action is required.

6. Updates
These terms may be updated when app functions or applicable requirements change. Continued use after an update means you acknowledge the revised terms.
''',
      );

  static void showPrivacyPolicy(BuildContext context) => _show(
        context,
        title: 'Privacy Policy',
        subtitle: 'Barangay personnel data and incident information',
        icon: Icons.privacy_tip_rounded,
        color: const Color(0xFF0D9488),
        content: '''
This notice describes how personal information is handled when you use Norz-Agapay's Barangay App. Processing must follow applicable requirements, including the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).

1. Information Processed
Depending on the feature used, the app may process account and profile details such as your name, email address, phone number, barangay, role, and sign-in status. Incident records may include descriptions, photos or videos, location coordinates, submission details, and response updates.

2. Purposes
Information is used to authenticate authorized personnel, display public alerts and reports, coordinate incident response, manage evacuation information, and maintain the security and operation of the service.

3. Access and Sharing
Information is available to authorized personnel according to their roles. Incident information may be shared with the relevant barangay or MDRRMO responders and other authorized public safety agencies when needed for response or required by law. The app does not authorize unrelated disclosure or commercial use.

4. Storage and Retention
Information may be stored on the device or municipal systems, depending on the feature and connection status. Locally stored hotline entries remain on the device. Records should be retained and disposed of according to applicable government records and data protection requirements.

5. Security
Use role-based access and reasonable device and account security practices. No electronic service can guarantee that data transmission or storage is completely risk-free. Report suspected loss, unauthorized access, or disclosure through your barangay's established channels.

6. Your Rights and Questions
Data subjects may exercise rights available under applicable privacy law, subject to its conditions and exceptions. For a privacy concern or request, contact the municipality or MDRRMO through its official channels, or contact the National Privacy Commission at privacy.gov.ph.
''',
      );

  static void _show(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required String content,
  }) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _LegalModal(
        title: title,
        subtitle: subtitle,
        icon: icon,
        color: color,
        content: content,
      ),
    );
  }
}

class _LegalModal extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final String content;

  const _LegalModal({required this.title, required this.subtitle, required this.icon, required this.color, required this.content});

  @override
  Widget build(BuildContext context) => Container(
        height: MediaQuery.sizeOf(context).height * .82,
        decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
        child: Column(children: [
          const SizedBox(height: 12),
          Container(width: 44, height: 5, decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(8))),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
            child: Row(children: [
              Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)), child: Icon(icon, color: color, size: 24)),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))), const SizedBox(height: 2), Text(subtitle, style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)))])),
              IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close, color: Colors.grey)),
            ]),
          ),
          const Divider(height: 1),
          Expanded(child: SingleChildScrollView(padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 16), child: Text(content, style: const TextStyle(fontSize: 13.5, height: 1.55, color: Color(0xFF334155))))),
          SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(20, 8, 20, 14), child: SizedBox(width: double.infinity, height: 48, child: ElevatedButton(onPressed: () => Navigator.pop(context), style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1B4F72), foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), elevation: 0), child: const Text('I Understand & Close'))))),
        ]),
      );
}
