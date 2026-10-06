import 'package:flutter/material.dart';

/// Shared header treatment for Barangay and MDRRMO incident screens.
class IncidentHeaderGradient extends StatelessWidget {
  final Widget? child;

  const IncidentHeaderGradient({super.key, this.child});

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
    child: child,
  );
}
