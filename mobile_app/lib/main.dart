import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:provider/provider.dart';
import 'services/auth_service.dart';
import 'services/socket_service.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/barangay_account_request_screen.dart';
import 'screens/onboarding_screen.dart';
import 'mdrrmo/providers/auth_provider.dart' as global_auth;
import 'mdrrmo/providers/task_provider.dart' as global_tasks;
import 'mdrrmo/services/gps_service.dart' as global_gps;
import 'mdrrmo/services/offline_service.dart' as global_offline;
import 'mdrrmo/screens/home_screen.dart' as global_home;
import 'mdrrmo/models/user.dart' as global_user;
import 'services/municipality_boundary_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AuthService.init();
  await global_offline.OfflineService.init();
  await MunicipalityBoundaryService.instance.initialize();

  final authService = AuthService();
  await authService.loadSavedAuth();
  final mdrrmoAuth = global_auth.AuthProvider();
  await mdrrmoAuth.tryAutoLogin();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthService>.value(value: authService),
        ChangeNotifierProvider<SocketService>(create: (_) => SocketService()),
        ChangeNotifierProvider<global_auth.AuthProvider>.value(
          value: mdrrmoAuth,
        ),
        ChangeNotifierProvider<global_tasks.TaskProvider>(
          create: (_) => global_tasks.TaskProvider(),
        ),
        ChangeNotifierProvider<global_gps.GpsService>(
          create: (_) => global_gps.GpsService(),
        ),
      ],
      child: const MobileApp(),
    ),
  );
}

class MobileApp extends StatefulWidget {
  const MobileApp({super.key});

  @override
  State<MobileApp> createState() => _MobileAppState();
}

class _MobileAppState extends State<MobileApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(MunicipalityBoundaryService.instance.refresh());
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NorzAgapay Mobile',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.light,
        scaffoldBackgroundColor: const Color(0xFFF5F6FA),
        primaryColor: const Color(0xFF1B4F72),
        colorScheme: const ColorScheme.light(
          primary: Color(0xFF1B4F72),
          secondary: Color(0xFF0D9488),
          surface: Colors.white,
          onSurface: Color(0xFF0F172A),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1B4F72),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
        useMaterial3: true,
        fontFamily: 'Roboto',
      ),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  @override
  Widget build(BuildContext context) {
    final barangayAuth = Provider.of<AuthService>(context);
    final mdrrmoAuth = Provider.of<global_auth.AuthProvider>(context);

    if (mdrrmoAuth.isAuthenticated && mdrrmoAuth.user != null) {
      if (mdrrmoAuth.user!.role == global_user.UserRole.responder) {
        return const global_home.HomeScreen();
      }
      return const LoginScreen();
    }

    if (!barangayAuth.isAuthenticated || barangayAuth.currentUser == null) {
      final introCompleted =
          Hive.box(
            'barangay_settings',
          ).get('barangay_onboarding_completed', defaultValue: false) ==
          true;
      if (!introCompleted) {
        return BarangayOnboardingScreen(onFinish: () => setState(() {}));
      }
      return const LoginScreen();
    }

    final user = barangayAuth.currentUser!;
    if (!user.coordinationVerified) {
      return const BarangayAccountRequestScreen();
    }

    return const HomeScreen();
  }
}
