import 'package:flutter/material.dart';
import '../services/offline_service.dart';
import '../widgets/legal_dialogs.dart';

class OnboardingScreen extends StatefulWidget {
  final VoidCallback onFinish;
  final VoidCallback onOpenRegistration;

  const OnboardingScreen({
    super.key,
    required this.onFinish,
    required this.onOpenRegistration,
  });

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  // Checkbox states for slides 1, 2, 3
  bool _agreedToAlerts = false;
  bool _agreedToReporting = false;
  bool _agreedToCalls = false;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _nextPage() {
    if (_currentPage < 3) {
      _pageController.animateToPage(
        _currentPage + 1,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOutCubic,
      );
    }
  }

  void _finishOnboarding({bool openRegistration = false}) async {
    await OfflineService.setOnboardingCompleted(true);
    if (!mounted) return;
    if (openRegistration) {
      widget.onOpenRegistration();
    } else {
      widget.onFinish();
    }
  }

  bool _isNextEnabled() {
    switch (_currentPage) {
      case 0:
        return _agreedToAlerts;
      case 1:
        return _agreedToReporting;
      case 2:
        return _agreedToCalls;
      default:
        return true;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFE2E8F0),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 420),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(28),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.08),
                    blurRadius: 24,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(28),
                child: Column(
                  children: [
                    // Carousel Page View
                    Expanded(
                      child: PageView(
                        controller: _pageController,
                        physics: const NeverScrollableScrollPhysics(),
                        onPageChanged: (idx) => setState(() => _currentPage = idx),
                        children: [
                          _buildSlide1(),
                          _buildSlide2(),
                          _buildSlide3(),
                          _buildSlide4(),
                        ],
                      ),
                    ),

                    // Bottom Navigation Footer (matching img 1 dots & actions)
                    Container(
                      padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // Indicators (matching img 1 pill & dots)
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: List.generate(4, (index) {
                              final isActive = _currentPage == index;
                              return AnimatedContainer(
                                duration: const Duration(milliseconds: 250),
                                margin: const EdgeInsets.symmetric(horizontal: 4),
                                width: isActive ? 30 : 8,
                                height: 8,
                                decoration: BoxDecoration(
                                  color: isActive
                                      ? const Color(0xFF1B4F72)
                                      : const Color(0xFFCBD5E1),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                              );
                            }),
                          ),
                          const SizedBox(height: 18),

                          // Dynamic bottom actions
                          if (_currentPage < 3) ...[
                            SizedBox(
                              width: double.infinity,
                              height: 48,
                              child: ElevatedButton(
                                onPressed: _isNextEnabled() ? _nextPage : null,
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF1B4F72),
                                  disabledBackgroundColor: const Color(0xFFE2E8F0),
                                  foregroundColor: Colors.white,
                                  disabledForegroundColor: const Color(0xFF94A3B8),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(24),
                                  ),
                                  elevation: _isNextEnabled() ? 2 : 0,
                                ),
                                child: const Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text('Next', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                                    SizedBox(width: 6),
                                    Icon(Icons.arrow_forward_rounded, size: 18),
                                  ],
                                ),
                              ),
                            ),
                          ] else ...[
                            // Slide 4: account creation and getting started actions
                            Column(
                              children: [
                                SizedBox(
                                  width: double.infinity,
                                  height: 48,
                                  child: ElevatedButton(
                                    onPressed: () => _finishOnboarding(openRegistration: false),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFF281140),
                                      foregroundColor: Colors.white,
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(24),
                                      ),
                                      elevation: 3,
                                    ),
                                    child: const Text(
                                      'Get started',
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 16,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton(
                                        onPressed: () => _finishOnboarding(openRegistration: true),
                                        style: OutlinedButton.styleFrom(
                                          foregroundColor: const Color(0xFF1B4F72),
                                          side: const BorderSide(color: Color(0xFF1B4F72), width: 1.5),
                                          shape: RoundedRectangleBorder(
                                            borderRadius: BorderRadius.circular(24),
                                          ),
                                          padding: const EdgeInsets.symmetric(vertical: 11),
                                        ),
                                        child: const Text(
                                          'Create Account',
                                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                  ],
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── Slide 1: Public Alerts & Advisories ─────────────────────────────────────
  Widget _buildSlide1() {
    return _SlideLayout(
      blobColor: const Color(0xFFE0F2FE),
      illustration: _buildAlertIllustration(),
      title: 'Receive Public Alerts & Advisories',
      description:
          'Stay informed with real-time public broadcasts and life-saving updates from MDRRMO Norzagaray and your Barangay.',
      extraWidget: _buildCategoryPillsRow(),
      checkboxValue: _agreedToAlerts,
      checkboxLabel: 'I agree to receive public posts from Barangay and MDRRMO.',
      onCheckboxChanged: (v) => setState(() => _agreedToAlerts = v ?? false),
    );
  }

  // ── Slide 2: Incident Reporting with Photo/Video & Location ─────────────────
  Widget _buildSlide2() {
    return _SlideLayout(
      blobColor: const Color(0xFFFEF3C7),
      illustration: _buildReportIllustration(),
      title: 'Report Incidents with Proof & GPS',
      description:
          'Submit emergency and community incidents with instant photo or video proof and your exact GPS coordinates attached for rapid dispatch.',
      extraWidget: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFBEB),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFFDE68A)),
        ),
        child: const Row(
          children: [
            Icon(Icons.camera_alt_outlined, color: Color(0xFFD97706), size: 18),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Photo/Video evidence + GPS location ensure verified response',
                style: TextStyle(fontSize: 11.5, color: Color(0xFF92400E), fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
      checkboxValue: _agreedToReporting,
      checkboxLabel:
          'I agree to provide photo/video and location when reporting to Barangay and MDRRMO.',
      onCheckboxChanged: (v) => setState(() => _agreedToReporting = v ?? false),
    );
  }

  // ── Slide 3: Interview and Follow-up Calls ──────────────────────────────────
  Widget _buildSlide3() {
    return _SlideLayout(
      blobColor: const Color(0xFFEDE9FE),
      illustration: _buildCallIllustration(),
      title: 'Responder Verification Calls',
      description:
          'If you submit an incident report, you may occasionally receive a follow-up phone call from MDRRMO or Barangay officers for documentation or situational interview.',
      extraWidget: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFFF5F3FF),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFDDD6FE)),
        ),
        child: const Row(
          children: [
            Icon(Icons.phone_in_talk_outlined, color: Color(0xFF7C3AED), size: 18),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Official MDRRMO/Barangay dispatchers will verify critical details',
                style: TextStyle(fontSize: 11.5, color: Color(0xFF5B21B6), fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
      checkboxValue: _agreedToCalls,
      checkboxLabel: 'I agree to receive calls from MDRRMO and Barangay.',
      onCheckboxChanged: (v) => setState(() => _agreedToCalls = v ?? false),
    );
  }

  // ── Slide 4: Login Required Notice ──────────────────────────────────────────
  Widget _buildSlide4() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Illustration in soft blob
          Container(
            width: double.infinity,
            height: 190,
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Center(
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 130,
                    height: 130,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: const Color(0xFFE2E8F0).withValues(alpha: 0.6),
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1B4F72),
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF1B4F72).withValues(alpha: 0.3),
                              blurRadius: 16,
                              offset: const Offset(0, 6),
                            ),
                          ],
                        ),
                        child: const Icon(
                          Icons.verified_user_rounded,
                          color: Colors.white,
                          size: 44,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFCBD5E1)),
                        ),
                        child: const Text(
                          'Verified Resident Access',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),

          const Text(
            'Resident Account Required',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Please note that residents should be logged in before reporting incidents to Barangay and MDRRMO.\n\nYou can browse public broadcasts and find evacuation centers without an account, but account registration is required to submit incident reports.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              color: Colors.grey.shade700,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 18),

          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline, color: Color(0xFF1B4F72), size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Tap "Get Started" to explore, or "Create Account" to register your citizen profile right now.',
                    style: TextStyle(fontSize: 11.5, color: Colors.grey.shade800),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Category Pills Row for Slide 1 ──────────────────────────────────────────
  Widget _buildCategoryPillsRow() {
    final categories = [
      {'label': 'Disaster Red', 'color': const Color(0xFFEF4444)},
      {'label': 'Orange Alert', 'color': const Color(0xFFF97316)},
      {'label': 'Yellow Alert', 'color': const Color(0xFFEAB308)},
      {'label': 'Safety Advisory', 'color': const Color(0xFF14B8A6)},
      {'label': 'Relief Goods', 'color': const Color(0xFF22C55E)},
      {'label': 'All-Clear', 'color': const Color(0xFF3B82F6)},
    ];

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: categories.map((c) {
        final color = c['color'] as Color;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: color.withValues(alpha: 0.35)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 5),
              Text(
                c['label'] as String,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  // ── Illustration 1 ─────────────────────────────────────────────────────────
  Widget _buildAlertIllustration() {
    return Center(
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFBAE6FD).withValues(alpha: 0.5),
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF0284C7).withValues(alpha: 0.2),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Icon(
              Icons.campaign_rounded,
              color: Color(0xFF0284C7),
              size: 48,
            ),
          ),
        ],
      ),
    );
  }

  // ── Illustration 2 ─────────────────────────────────────────────────────────
  Widget _buildReportIllustration() {
    return Center(
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFFDE68A).withValues(alpha: 0.5),
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFD97706).withValues(alpha: 0.2),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Icon(
              Icons.add_a_photo_rounded,
              color: Color(0xFFD97706),
              size: 46,
            ),
          ),
        ],
      ),
    );
  }

  // ── Illustration 3 ─────────────────────────────────────────────────────────
  Widget _buildCallIllustration() {
    return Center(
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFDDD6FE).withValues(alpha: 0.5),
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF7C3AED).withValues(alpha: 0.2),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Icon(
              Icons.ring_volume_rounded,
              color: Color(0xFF7C3AED),
              size: 46,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Reusable Slide Layout ────────────────────────────────────────────────────
class _SlideLayout extends StatelessWidget {
  final Color blobColor;
  final Widget illustration;
  final String title;
  final String description;
  final Widget? extraWidget;
  final bool checkboxValue;
  final String checkboxLabel;
  final ValueChanged<bool?> onCheckboxChanged;

  const _SlideLayout({
    required this.blobColor,
    required this.illustration,
    required this.title,
    required this.description,
    this.extraWidget,
    required this.checkboxValue,
    required this.checkboxLabel,
    required this.onCheckboxChanged,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Illustration Container (organic soft shape matching img 1)
          Container(
            width: double.infinity,
            height: 175,
            decoration: BoxDecoration(
              color: blobColor,
              borderRadius: BorderRadius.circular(24),
            ),
            child: illustration,
          ),
          const SizedBox(height: 18),

          // Title
          Text(
            title,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Color(0xFF0F172A),
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 8),

          // Description
          Text(
            description,
            style: TextStyle(
              fontSize: 13,
              color: Colors.grey.shade700,
              height: 1.4,
            ),
          ),
          if (extraWidget != null) ...[
            const SizedBox(height: 12),
            extraWidget!,
          ],
          const SizedBox(height: 14),

          // Checkbox container
          Container(
            decoration: BoxDecoration(
              color: checkboxValue
                  ? const Color(0xFFF0FDF4)
                  : const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: checkboxValue
                    ? const Color(0xFF22C55E)
                    : const Color(0xFFCBD5E1),
                width: checkboxValue ? 1.5 : 1,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(6, 4, 10, 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Checkbox(
                        value: checkboxValue,
                        activeColor: const Color(0xFF1B4F72),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(4),
                        ),
                        onChanged: onCheckboxChanged,
                      ),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(top: 10.0),
                          child: GestureDetector(
                            onTap: () => onCheckboxChanged(!checkboxValue),
                            child: Text(
                              checkboxLabel,
                              style: const TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF1E293B),
                                height: 1.35,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  // Clickable Links for Terms and Conditions & Privacy Policy
                  Padding(
                    padding: const EdgeInsets.only(left: 48.0, bottom: 4.0),
                    child: Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 4,
                      children: [
                        const Text(
                          'Review our',
                          style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                        ),
                        InkWell(
                          onTap: () => LegalDialogs.showTermsAndConditions(context),
                          child: const Text(
                            'Terms and Conditions',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF1B4F72),
                              decoration: TextDecoration.underline,
                            ),
                          ),
                        ),
                        const Text(
                          'and',
                          style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                        ),
                        InkWell(
                          onTap: () => LegalDialogs.showPrivacyPolicy(context),
                          child: const Text(
                            'Privacy Policy',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF0D9488),
                              decoration: TextDecoration.underline,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
