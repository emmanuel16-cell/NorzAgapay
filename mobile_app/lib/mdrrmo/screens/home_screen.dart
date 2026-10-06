import 'package:flutter/material.dart';

import 'mdrrmo_evacuation_screen.dart';
import 'mdrrmo_home_screen.dart';
import 'mdrrmo_hotline_screen.dart';
import 'mdrrmo_profile_screen.dart';
import 'mdrrmo_reports_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      body: IndexedStack(
        index: _currentIndex,
        children: const [
          MdrrmoHomeScreen(),
          MdrrmoEvacuationScreen(),
          MdrrmoReportsScreen(),
          MdrrmoHotlineScreen(),
          MdrrmoProfileScreen(),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: const Border(top: BorderSide(color: Color(0xFF64D2B4), width: 1.5)),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 10, offset: const Offset(0, -3)),
          ],
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _navItem(0, Icons.home_rounded, 'Home'),
                _navItem(1, Icons.location_on_rounded, 'Evac Station'),
                _navItem(2, Icons.assignment_rounded, 'Reports'),
                _navItem(3, Icons.phone_in_talk_rounded, 'Hotline'),
                _navItem(4, Icons.person_rounded, 'Profile'),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData icon, String label) {
    final selected = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFE6F6F3) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: selected ? const Color(0xFF0D9488) : const Color(0xFF64748B), size: 24),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                color: selected ? const Color(0xFF0D9488) : const Color(0xFF64748B),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
