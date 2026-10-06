import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../mdrrmo/providers/demo_mode_provider.dart';

class DemoDataSwitchCard extends StatelessWidget {
  const DemoDataSwitchCard({super.key, this.margin = const EdgeInsets.all(12)});

  final EdgeInsetsGeometry margin;

  @override
  Widget build(BuildContext context) {
    final demoMode = context.watch<DemoModeProvider>();
    return Container(
      margin: margin,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: SwitchListTile.adaptive(
        secondary: const Icon(Icons.dataset_outlined, color: Color(0xFF0D9488)),
        title: const Text(
          'Show demo data',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: const Text(
          'Preview sample incidents. Demo reports are read-only.',
          style: TextStyle(fontSize: 12),
        ),
        value: demoMode.showDemoData,
        onChanged: demoMode.setShowDemoData,
        activeTrackColor: const Color(0xFF0D9488),
      ),
    );
  }
}
