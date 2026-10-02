import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import 'add_evac_center_screen.dart';

class EvacCentersScreen extends StatelessWidget {
  const EvacCentersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final canAdd = context.select<AuthService, bool>(
      (auth) => auth.currentUser?.canAddEvacuationCenter ?? false,
    );
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0C243B),
        foregroundColor: Colors.white,
        title: const Text('Add Evacuation Station', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Card(
              color: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: Color(0xFFE2E8F0))),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircleAvatar(radius: 30, backgroundColor: Color(0xFFE0F2FE), child: Icon(Icons.add_location_alt_rounded, color: Color(0xFF0284C7), size: 30)),
                    const SizedBox(height: 16),
                    const Text('Register a station', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                    const SizedBox(height: 8),
                    const Text('Add its name, address, and map pin so residents can find the nearest evacuation station.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF64748B), height: 1.4)),
                    const SizedBox(height: 20),
                    if (canAdd)
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AddEvacCenterScreen())),
                          icon: const Icon(Icons.add_location_alt_rounded),
                          label: const Text('Add station'),
                          style: FilledButton.styleFrom(backgroundColor: const Color(0xFF0D9488), padding: const EdgeInsets.symmetric(vertical: 14)),
                        ),
                      )
                    else
                      const Text('Your role can view station information but cannot add stations.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF64748B))),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
