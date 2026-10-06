import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'providers/task_provider.dart';
import 'services/gps_service.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/mdrrmo_reports_screen.dart';
import 'models/user.dart';
import 'core/constants.dart';
import 'services/offline_service.dart';
import 'providers/demo_mode_provider.dart';
import '../services/municipality_boundary_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await OfflineService.init();
  await MunicipalityBoundaryService.instance.initialize();
  final demoMode = DemoModeProvider();
  await demoMode.load();
  runApp(NorzAgapayApp(demoMode: demoMode));
}

class NorzAgapayApp extends StatelessWidget {
  final DemoModeProvider demoMode;
  const NorzAgapayApp({super.key, required this.demoMode});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => TaskProvider()),
        ChangeNotifierProvider(create: (_) => GpsService()),
        ChangeNotifierProvider<DemoModeProvider>.value(value: demoMode),
      ],
      child: MaterialApp(
        title: AppConstants.appName,
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          primaryColor: const Color(AppColors.primary),
          scaffoldBackgroundColor: const Color(AppColors.bgPrimary),
          colorScheme: ColorScheme.dark(
            primary: const Color(AppColors.primary),
            secondary: const Color(AppColors.accent),
            surface: const Color(AppColors.bgSecondary),
          ),
          fontFamily: 'Inter',
          useMaterial3: true,
        ),
        home: const AuthWrapper(),
        routes: {
          '/login': (context) => const LoginScreen(),
          '/home': (context) => const HomeScreen(),
        },
      ),
    );
  }
}

class AuthWrapper extends StatefulWidget {
  const AuthWrapper({super.key});

  @override
  State<AuthWrapper> createState() => _AuthWrapperState();
}

class _AuthWrapperState extends State<AuthWrapper> {
  @override
  void initState() {
    super.initState();
    Provider.of<AuthProvider>(context, listen: false).tryAutoLogin();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (auth.isLoading && !auth.isAuthenticated) {
          return const SplashScreen();
        }
        if (!auth.isAuthenticated || auth.user == null)
          return const LoginScreen();
        if (auth.user!.role == UserRole.dispatcher)
          return const MdrrmoReportsScreen();
        if (auth.user!.role == UserRole.responder) return const HomeScreen();
        return const LoginScreen();
      },
    );
  }
}
