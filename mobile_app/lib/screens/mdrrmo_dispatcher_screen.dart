import 'package:flutter/material.dart';
import '../mdrrmo/screens/mdrrmo_reports_screen.dart';

/// Compatibility entry point for older navigation references.
class MdrrmoDispatcherScreen extends StatelessWidget {
  const MdrrmoDispatcherScreen({super.key});

  @override
  Widget build(BuildContext context) => const MdrrmoReportsScreen();
}