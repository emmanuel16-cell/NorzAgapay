import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';
import '../widgets/legal_dialogs.dart';

class BarangayOnboardingScreen extends StatefulWidget {
  final VoidCallback onFinish;

  const BarangayOnboardingScreen({super.key, required this.onFinish});

  @override
  State<BarangayOnboardingScreen> createState() => _BarangayOnboardingScreenState();
}

class _BarangayOnboardingScreenState extends State<BarangayOnboardingScreen> {
  final _pageController = PageController();
  int _page = 0;
  final List<bool> _consents = [false, false, false];

  static const _slides = [
    _IntroSlide(
      title: 'Receive Public Alerts & Advisories',
      description: 'View safety broadcasts and advisories shared by your Barangay and MDRRMO.',
      icon: Icons.campaign_rounded,
      color: Color(0xFF0284C7),
      background: Color(0xFFE0F2FE),
      note: 'Stay current on emergency alerts, safety guidance, and community updates.',
      consent: 'I agree to receive and view public posts from Barangay and MDRRMO.',
    ),
    _IntroSlide(
      title: 'Coordinate Incident Reports',
      description: 'Review incident reports with the details responders need to coordinate a timely response.',
      icon: Icons.camera_alt_rounded,
      color: Color(0xFFD97706),
      background: Color(0xFFFEF3C7),
      note: 'Incident records can include descriptions, photo or video evidence, and location information.',
      consent: 'I agree to handle incident details only for authorized response purposes.',
    ),
    _IntroSlide(
      title: 'Support Responder Follow-ups',
      description: 'Barangay and MDRRMO responders may contact your team to clarify incident details or coordinate response.',
      icon: Icons.phone_in_talk_rounded,
      color: Color(0xFF7C3AED),
      background: Color(0xFFEDE9FE),
      note: 'Use verified official contacts and follow your barangay response procedures.',
      consent: 'I agree to receive official response-related calls or messages.',
    ),
  ];

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  bool get _canContinue => _page == 3 || _consents[_page];

  void _next() {
    if (!_canContinue) return;
    _pageController.nextPage(duration: const Duration(milliseconds: 300), curve: Curves.easeInOutCubic);
  }

  Future<void> _finish() async {
    await Hive.box('barangay_settings').put('barangay_onboarding_completed', true);
    if (mounted) widget.onFinish();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFE2E8F0),
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 440),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(30), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: .08), blurRadius: 24, offset: const Offset(0, 10))]),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(30),
                  child: Column(children: [
                    Expanded(
                      child: PageView.builder(
                        controller: _pageController,
                        physics: const NeverScrollableScrollPhysics(),
                        onPageChanged: (page) => setState(() => _page = page),
                        itemCount: 4,
                        itemBuilder: (context, index) => index < 3 ? _consentPage(index) : _loginPage(),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: List.generate(
                            4,
                            (index) => AnimatedContainer(
                              duration: const Duration(milliseconds: 220),
                              margin: const EdgeInsets.symmetric(horizontal: 4),
                              width: _page == index ? 30 : 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: _page == index
                                    ? const Color(0xFF1B4F72)
                                    : const Color(0xFFCBD5E1),
                                borderRadius: BorderRadius.circular(6),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: ElevatedButton(
                            onPressed: _canContinue ? (_page == 3 ? _finish : _next) : null,
                            style: ElevatedButton.styleFrom(backgroundColor: _page == 3 ? const Color(0xFF281140) : const Color(0xFF1B4F72), disabledBackgroundColor: const Color(0xFFE2E8F0), foregroundColor: Colors.white, disabledForegroundColor: const Color(0xFF94A3B8), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)), elevation: _canContinue ? 2 : 0),
                            child: Text(_page == 3 ? 'Get started' : 'Next  →', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                          ),
                        ),
                      ]),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );

  Widget _consentPage(int index) {
    final slide = _slides[index];
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 22, 24, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _hero(slide.icon, slide.color, slide.background),
        const SizedBox(height: 24),
        Text(slide.title, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold, color: Color(0xFF0F172A), letterSpacing: -.3)),
        const SizedBox(height: 12),
        Text(slide.description, style: const TextStyle(fontSize: 14, height: 1.45, color: Color(0xFF626262))),
        const SizedBox(height: 16),
        Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: slide.background.withValues(alpha: .4), border: Border.all(color: slide.color.withValues(alpha: .4)), borderRadius: BorderRadius.circular(12)), child: Row(children: [Icon(slide.icon, size: 19, color: slide.color), const SizedBox(width: 10), Expanded(child: Text(slide.note, style: TextStyle(fontSize: 12.5, height: 1.35, color: slide.color.withValues(alpha: .95))))])),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.fromLTRB(10, 10, 12, 8),
          decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFCBD5E1))),
          child: Column(children: [
            InkWell(
              onTap: () => setState(() => _consents[index] = !_consents[index]),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Checkbox(value: _consents[index], onChanged: (value) => setState(() => _consents[index] = value ?? false), activeColor: const Color(0xFF1B4F72), visualDensity: VisualDensity.compact),
                Expanded(child: Padding(padding: const EdgeInsets.only(top: 9), child: Text(slide.consent, style: const TextStyle(fontSize: 13.5, height: 1.35, fontWeight: FontWeight.w600, color: Color(0xFF1E293B))))),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 44, bottom: 2),
              child: Wrap(children: [
                const Text('Review our ', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                GestureDetector(onTap: () => LegalDialogs.showTermsAndConditions(context), child: const Text('Terms and Conditions', style: TextStyle(fontSize: 12, color: Color(0xFF1B4F72), decoration: TextDecoration.underline, fontWeight: FontWeight.w600))),
                const Text(' and ', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                GestureDetector(onTap: () => LegalDialogs.showPrivacyPolicy(context), child: const Text('Privacy Policy', style: TextStyle(fontSize: 12, color: Color(0xFF0D9488), decoration: TextDecoration.underline, fontWeight: FontWeight.w600))),
              ]),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _loginPage() => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 22, 24, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.center, children: [
          _hero(Icons.verified_user_rounded, const Color(0xFF1B4F72), const Color(0xFFF1F5F9), badge: 'Authorized Barangay Access'),
          const SizedBox(height: 24),
          const Text('Barangay Account Required', textAlign: TextAlign.center, style: TextStyle(fontSize: 21, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
          const SizedBox(height: 12),
          const Text('Sign in with the account assigned to your barangay role to manage public alerts, review incident reports, and coordinate local response.', textAlign: TextAlign.center, style: TextStyle(fontSize: 14, height: 1.5, color: Color(0xFF626262))),
          const SizedBox(height: 18),
          Container(padding: const EdgeInsets.all(13), decoration: BoxDecoration(color: const Color(0xFFF8FAFC), border: Border.all(color: const Color(0xFFE2E8F0)), borderRadius: BorderRadius.circular(14)), child: const Row(children: [Icon(Icons.info_outline_rounded, color: Color(0xFF1B4F72)), SizedBox(width: 10), Expanded(child: Text('Tap “Get started” to continue to the staff login page.', style: TextStyle(fontSize: 12.5, height: 1.4, color: Color(0xFF475569))))])),
        ]),
      );

  Widget _hero(IconData icon, Color color, Color background, {String? badge}) => Container(
        width: double.infinity,
        height: 210,
        decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(24)),
        child: Center(child: Stack(alignment: Alignment.center, children: [
          Container(width: 142, height: 142, decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: .1))),
          Container(width: 88, height: 88, decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white, boxShadow: [BoxShadow(color: color.withValues(alpha: .15), blurRadius: 14, offset: const Offset(0, 5))]), child: Icon(icon, color: color, size: 42)),
          if (badge != null) Positioned(bottom: 18, child: Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFCBD5E1))), child: Text(badge, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF334155))))),
        ])),
      );
}

class _IntroSlide {
  final String title;
  final String description;
  final IconData icon;
  final Color color;
  final Color background;
  final String note;
  final String consent;

  const _IntroSlide({required this.title, required this.description, required this.icon, required this.color, required this.background, required this.note, required this.consent});
}
