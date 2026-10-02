import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';

class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  bool _loading = true;
  String? _error;
  int _posts = 0;
  int _stations = 0;
  int _teamMembers = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final auth = context.read<AuthService>();
    if (auth.token == null || auth.currentUser == null) return;
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        ApiService.getBroadcasts(auth.token!),
        ApiService.getEvacuationCenters(auth.token!, barangayId: auth.currentUser!.barangayId),
        ApiService.getTeam(auth.token!),
      ]);
      if (!mounted) return;
      setState(() {
        _posts = (results[0] as List).length;
        _stations = (results[1] as List).length;
        _teamMembers = (results[2] as List).length;
        _loading = false;
      });
    } catch (error) {
      if (mounted) setState(() { _error = error.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F6FA),
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          foregroundColor: Colors.white,
          flexibleSpace: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
          ),
          title: const Text('Barangay Analytics'),
          actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded))],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Text('Unable to load analytics: $_error'))
                : ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      const Text('Barangay overview', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 14),
                      _metric('Published posts', _posts, Icons.campaign_rounded, const Color(0xFF0284C7)),
                      _metric('Evacuation stations', _stations, Icons.location_city_rounded, const Color(0xFF0D9488)),
                      _metric('Barangay team accounts', _teamMembers, Icons.groups_rounded, const Color(0xFF7C3AED)),
                    ],
                  ),
      );

  Widget _metric(String title, int value, IconData icon, Color color) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: ListTile(
          leading: CircleAvatar(backgroundColor: color.withValues(alpha: .12), child: Icon(icon, color: color)),
          title: Text(title),
          trailing: Text('$value', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        ),
      );
}
