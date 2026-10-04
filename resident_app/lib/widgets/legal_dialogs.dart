import 'package:flutter/material.dart';

class LegalDialogs {
  static void showTermsAndConditions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _LegalModal(
        title: 'Terms and Conditions',
        subtitle: 'NorzAgapay Disaster & Incident Management System',
        icon: Icons.gavel_rounded,
        iconColor: const Color(0xFF1B4F72),
        content: '''
Welcome to NorzAgapay, the official citizen portal for the Municipality of Norzagaray Disaster Risk Reduction and Management Office (MDRRMO) and partner Barangays.

1. Acceptance of Terms
By accessing or using the NorzAgapay Resident Application, you agree to comply with and be bound by these Terms and Conditions and our Privacy Policy. If you do not agree with any part of these terms, you should refrain from using the incident reporting services.

2. Public Broadcasts & Advisories
MDRRMO and Barangay administrators broadcast verified public safety advisories, disaster alerts (Red, Orange, Yellow), relief distributions, and all-clear notices. While information is provided with utmost urgency and accuracy, citizens should follow official evacuation orders and emergency responder directives at all times.

3. Incident Reporting & Proof Requirement
Citizens reporting emergencies or community concerns are required to provide genuine photo or video proof alongside real-time GPS location data. Submitting fraudulent reports, prank calls, or fabricated disaster media is strictly prohibited under Philippine Law (including Republic Act 10121 and Cybercrime Prevention Act) and will be reported to the Philippine National Police (PNP).

4. Responder Follow-ups & Interviews
To facilitate rapid assessment and rescue documentation, MDRRMO dispatchers and Barangay responders may contact you via phone or SMS for additional context or post-incident interviews. By submitting reports, you consent to receiving verified responder inquiries.

5. Account Responsibility
Residents must provide valid contact details and true identity information when creating an account. You are responsible for safeguarding your login credentials and ensuring all reports submitted under your profile are authentic.

6. Limitation of Liability
NorzAgapay aims for maximum server availability and offline resiliency. In cases of acute carrier outages or physical disconnection, users are urged to directly dial national hotline 911, MDRRMO hotline 0905-247-0355, or their local Barangay emergency landlines.
''',
      ),
    );
  }

  static void showPrivacyPolicy(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _LegalModal(
        title: 'Privacy Policy',
        subtitle: 'Data Protection & Citizen Privacy Commitment',
        icon: Icons.privacy_tip_rounded,
        iconColor: const Color(0xFF0D9488),
        content: '''
The Municipality of Norzagaray and MDRRMO are committed to protecting your privacy in full compliance with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).

1. Information We Collect
• Contact Information: Your full name, active mobile number, and email address.
• Residential Details: Your registered Barangay within Norzagaray.
• Location Data: Device GPS coordinates captured when you choose to share your location for an incident report or nearest-station lookup.
• Multimedia Evidence: Photos and recorded video clips submitted as incident documentation.

2. Purpose of Processing
Your data is used strictly for:
• Dispatching emergency medical, rescue, and police units to your exact reported location.
• Verifying the legitimacy and severity of incidents.
• Sending official public storm, flood, and safety advisories.
• Showing nearby evacuation stations with estimated distance and travel time.

3. Data Sharing & Security
We do not sell, rent, or commercialize your personal information. Incident data is only shared with verified first responders, including:
• Norzagaray MDRRMO Command & Dispatch Center
• Local Barangay Incident Response Teams (BDRRMC)
• Philippine National Police (PNP) and Bureau of Fire Protection (BFP) when required for life-saving operations.

4. Offline Data Protection
Reports saved while offline are securely cached on your device storage and synced only when connection to our secured municipal servers is restored.

5. Your Rights
Under Republic Act 10173, you have the right to access your personal data, rectify inaccuracies, and request account termination by contacting the Norzagaray MDRRMO Data Protection Officer at norzagarayrescue2015@gmail.com.
''',
      ),
    );
  }
}

class _LegalModal extends StatelessWidget {
  final String title;
  final String subtitle;
  final String content;
  final IconData icon;
  final Color iconColor;

  const _LegalModal({
    required this.title,
    required this.subtitle,
    required this.content,
    required this.icon,
    required this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.82,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          const SizedBox(height: 12),
          Container(
            width: 44,
            height: 5,
            decoration: BoxDecoration(
              color: Colors.grey.shade300,
              borderRadius: BorderRadius.circular(10),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 16, 20, 12),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: iconColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: iconColor, size: 24),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, color: Colors.grey),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Text(
                content,
                style: const TextStyle(
                  fontSize: 13.5,
                  height: 1.55,
                  color: Color(0xFF334155),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
              child: SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1B4F72),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    elevation: 0,
                  ),
                  child: const Text(
                    'I Understand & Close',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
