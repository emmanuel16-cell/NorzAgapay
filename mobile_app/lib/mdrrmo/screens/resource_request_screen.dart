import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/constants.dart';
import '../providers/auth_provider.dart';

class ResourceRequestScreen extends StatefulWidget {
  const ResourceRequestScreen({super.key});

  @override
  State<ResourceRequestScreen> createState() => _ResourceRequestScreenState();
}

class _ResourceRequestScreenState extends State<ResourceRequestScreen> {
  final _reasonController = TextEditingController();
  String _requestType = 'responders';
  String _subType = 'general_labor';
  bool _isLoading = false;

  Future<void> _submit() async {
    if (_reasonController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please provide justification details')));
      return;
    }

    setState(() => _isLoading = true);
    final auth = Provider.of<AuthProvider>(context, listen: false);

    try {
      await auth.submitResourceRequest(
        requestType: _requestType,
        subType: _subType,
        details: _reasonController.text.trim(),
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Request sent to Command Center'), backgroundColor: Color(AppColors.success)));
        _reasonController.clear();
        setState(() {
          _requestType = 'responders';
          _subType = 'general_labor';
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: const Color(AppColors.accent)));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('What do you need?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'responders', label: Text('Responders'), icon: Icon(Icons.people)),
              ButtonSegment(value: 'goods', label: Text('Relief Goods'), icon: Icon(Icons.inventory)),
            ],
            selected: {_requestType},
            onSelectionChanged: (val) => setState(() => _requestType = val.first),
          ),
          const SizedBox(height: 24),
          if (_requestType == 'responders') ...[
            const Text('Responder Type', style: TextStyle(fontWeight: FontWeight.bold)),
            RadioListTile(title: const Text('General Responder'), value: 'general_labor', groupValue: _subType, onChanged: (v) => setState(() => _subType = v!)),
            RadioListTile(title: const Text('Certified Specialist'), value: 'specialist', groupValue: _subType, onChanged: (v) => setState(() => _subType = v!)),
          ],
          const SizedBox(height: 24),
          const Text('Justification / Details', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          TextField(
            controller: _reasonController,
            maxLines: 4,
            decoration: const InputDecoration(hintText: 'e.g. Need 5 more people for sandbagging...', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 40),
          ElevatedButton(
            onPressed: _isLoading ? null : _submit,
            style: ElevatedButton.styleFrom(backgroundColor: const Color(AppColors.primary), foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 16)),
            child: _isLoading 
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
              : const Text('Submit Request'),
          ),
        ],
      ),
    );
  }
}
