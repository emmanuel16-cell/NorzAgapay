import 'dart:async';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'screens/onboarding_screen.dart';
import 'screens/main_navigation_screen.dart';
import 'screens/reporting_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/my_reports_screen.dart';
import 'screens/evacuation_map_screen.dart';
import 'screens/hotlines_screen.dart';
import 'services/offline_service.dart';
import 'services/norzagaray_boundary.dart';
import 'services/firebase_options.dart';
import 'services/resident_push_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await OfflineService.init();
  final firebaseOptions = DefaultFirebaseOptions.currentPlatform;
  if (firebaseOptions != null) {
    try {
      await Firebase.initializeApp(options: firebaseOptions);
      await ResidentPushService.instance.initialize();
    } catch (error) {
      debugPrint('Firebase resident notifications are unavailable: $error');
    }
  }
  await NorzagarayBoundary.load();
  unawaited(NorzagarayBoundary.refresh());

  final hasCompletedOnboarding = OfflineService.hasCompletedOnboarding();
  runApp(ResidentApp(hasCompletedOnboarding: hasCompletedOnboarding));
}

class ResidentApp extends StatefulWidget {
  final bool hasCompletedOnboarding;
  const ResidentApp({super.key, required this.hasCompletedOnboarding});

  @override
  State<ResidentApp> createState() => _ResidentAppState();
}

class _ResidentAppState extends State<ResidentApp> {
  late bool _showOnboarding;
  int _initialNavIndex = 0;
  Key _navKey = UniqueKey();

  @override
  void initState() {
    super.initState();
    _showOnboarding = !widget.hasCompletedOnboarding;
  }

  void _onFinishOnboarding({bool openRegistration = false}) {
    setState(() {
      _showOnboarding = false;
      // If open registration requested from onboarding slide 4, profile tab is index 3 (logged out mode)
      _initialNavIndex = openRegistration ? 3 : 0;
      _navKey = UniqueKey();
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Resident NorzApp',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1B4F72),
          primary: const Color(0xFF1B4F72),
          secondary: const Color(0xFF0D9488),
        ),
        useMaterial3: true,
        fontFamily: 'Roboto',
        scaffoldBackgroundColor: const Color(0xFFF8FAFC),
      ),
      home: _showOnboarding
          ? OnboardingScreen(
              onFinish: () => _onFinishOnboarding(openRegistration: false),
              onOpenRegistration: () =>
                  _onFinishOnboarding(openRegistration: true),
            )
          : MainNavigationScreen(key: _navKey, initialIndex: _initialNavIndex),
      routes: {
        '/home': (context) => const MainNavigationScreen(initialIndex: 0),
        '/evacuation-centers': (context) => const EvacuationCentersScreen(),
        '/report': (context) => const ReportingScreen(reportType: 'emergency'),
        '/my-reports': (context) => const MyReportsScreen(),
        '/hotlines': (context) => const HotlinesScreen(),
        '/profile': (context) => const ProfileScreen(),
      },
    );
  }
}
