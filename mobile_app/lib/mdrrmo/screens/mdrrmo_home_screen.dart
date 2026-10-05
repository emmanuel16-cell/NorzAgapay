import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class MdrrmoHomeScreen extends StatefulWidget {
  const MdrrmoHomeScreen({super.key});

  @override
  State<MdrrmoHomeScreen> createState() => _MdrrmoHomeScreenState();
}

class _MdrrmoHomeScreenState extends State<MdrrmoHomeScreen> {
  List<Map<String, dynamic>> _posts = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final token = context.read<AuthProvider>().token;
    if (token == null) return;
    if (mounted) setState(() { _loading = true; _error = null; });
    try {
      final posts = await ApiService.getMdrrmoBroadcasts(token);
      if (mounted) setState(() { _posts = posts; _error = null; });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F6FA),
    appBar: AppBar(
      backgroundColor: const Color(0xFF0C243B),
      foregroundColor: Colors.white,
      title: const Text('MDRRMO Updates', style: TextStyle(fontWeight: FontWeight.bold)),
      actions: [IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh_rounded))],
    ),
    body: _loading && _posts.isEmpty
        ? const Center(child: CircularProgressIndicator(color: Color(0xFF0D9488)))
        : _error != null && _posts.isEmpty
            ? Center(child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.cloud_off_rounded, size: 48, color: Color(0xFF94A3B8)),
                  const SizedBox(height: 12),
                  Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B))),
                  const SizedBox(height: 12),
                  FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded), label: const Text('Try again')),
                ]),
              ))
            : RefreshIndicator(
                onRefresh: _load,
                child: _posts.isEmpty
                    ? ListView(children: const [
                        SizedBox(height: 170),
                        Icon(Icons.campaign_outlined, size: 58, color: Color(0xFF94A3B8)),
                        SizedBox(height: 12),
                        Center(child: Text('No MDRRMO posts yet', style: TextStyle(color: Color(0xFF64748B)))),
                      ])
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _posts.length,
                        itemBuilder: (context, index) => _postCard(_posts[index]),
                      ),
              ),
  );

  Widget _postCard(Map<String, dynamic> post) {
    final createdAt = DateTime.tryParse(post['created_at']?.toString() ?? '')?.toLocal();
    final media = (post['media'] as List? ?? const []).whereType<Map>().toList();
    final content = post['content']?.toString() ?? '';
    final category = (post['category']?.toString() ?? 'safety_advisory').replaceAll('_', ' ').toUpperCase();
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: const [BoxShadow(color: Color(0x080F172A), blurRadius: 12, offset: Offset(0, 4))],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
          child: Row(children: [
            const CircleAvatar(backgroundColor: Color(0xFFE0F2FE), child: Icon(Icons.shield_rounded, color: Color(0xFF0284C7))),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('MDRRMO Norzagaray', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
              Text(createdAt == null ? 'Official update' : '${createdAt.day}/${createdAt.month}/${createdAt.year} · ${createdAt.hour.toString().padLeft(2, '0')}:${createdAt.minute.toString().padLeft(2, '0')}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
            ])),
            if (post['is_pinned'] == true) const Icon(Icons.push_pin_rounded, size: 18, color: Color(0xFF0284C7)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(color: const Color(0xFFE0F2FE), borderRadius: BorderRadius.circular(20)),
            child: Text(category, style: const TextStyle(color: Color(0xFF0369A1), fontSize: 10, fontWeight: FontWeight.w800)),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
          child: Text(content, style: const TextStyle(color: Color(0xFF1E293B), fontSize: 14, height: 1.45)),
        ),
        if (media.isNotEmpty)
          SizedBox(
            height: 190,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
              scrollDirection: Axis.horizontal,
              itemCount: media.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final url = media[index]['url']?.toString() ?? '';
                if (media[index]['type'] == 'video') {
                  return Container(width: 230, decoration: BoxDecoration(color: const Color(0xFFE2E8F0), borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.play_circle_outline_rounded, size: 44, color: Color(0xFF0C243B)));
                }
                return ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(url, width: 230, height: 190, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(width: 230, color: const Color(0xFFE2E8F0), child: const Icon(Icons.broken_image_outlined))),
                );
              },
            ),
          ),
      ]),
    );
  }
}
