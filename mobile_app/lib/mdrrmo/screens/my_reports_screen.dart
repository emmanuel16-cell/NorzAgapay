import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../models/incident_report.dart';
import '../core/constants.dart';
import '../widgets/video_proof_player.dart';

class MyReportsScreen extends StatefulWidget {
  const MyReportsScreen({super.key});

  @override
  State<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends State<MyReportsScreen> {
  List<IncidentReport> _reports = [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _fetchReports();
  }

  Future<void> _fetchReports() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final auth = Provider.of<AuthProvider>(context, listen: false);

    try {
      final response = await http.get(
        Uri.parse('${AppConstants.apiBaseUrl}/incident-reports/me'),
        headers: {
          'Authorization': 'Bearer ${auth.token}',
          'ngrok-skip-browser-warning': 'true',
        },
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        setState(() {
          _reports = data.map((json) => IncidentReport.fromJson(json)).toList();
        });
      } else {
        final errorData = json.decode(response.body);
        setState(() {
          _errorMessage = errorData['error'] ?? 'Failed to load reports';
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Error: $e';
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Reports'),
      ),
      body: RefreshIndicator(
        onRefresh: _fetchReports,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _errorMessage != null
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          _errorMessage!,
                          style: const TextStyle(color: Colors.red),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _fetchReports,
                          child: const Text('Try Again'),
                        ),
                      ],
                    ),
                  )
                : _reports.isEmpty
                    ? const Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.report_off, size: 64, color: Colors.grey),
                            SizedBox(height: 16),
                            Text(
                              'No reports submitted yet',
                              style: TextStyle(color: Colors.grey, fontSize: 16),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _reports.length,
                        itemBuilder: (context, index) {
                          final report = _reports[index];
                          return _buildReportCard(report);
                        },
                      ),
      ),
    );
  }

  Widget _buildReportCard(IncidentReport report) {
    Color statusColor;
    String statusText = report.status ?? 'pending';
    switch (statusText) {
      case 'pending':
        statusColor = const Color(AppColors.warning);
        break;
      case 'verified':
        statusColor = const Color(AppColors.success);
        break;
      case 'rejected':
        statusColor = const Color(AppColors.accent);
        break;
      default:
        statusColor = Colors.grey;
    }

    return Card(
      color: const Color(AppColors.bgSecondary),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: report.type == 'emergency'
                        ? const Color(AppColors.accent).withOpacity(0.2)
                        : const Color(AppColors.primary).withOpacity(0.2),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    report.type.toUpperCase(),
                    style: TextStyle(
                      color: report.type == 'emergency'
                          ? const Color(AppColors.accent)
                          : const Color(AppColors.primary),
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    statusText.toUpperCase(),
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              report.title,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            if (report.specifics != null) ...[
              const SizedBox(height: 4),
              Text(
                report.specifics!,
                style: const TextStyle(color: Colors.grey, fontSize: 14),
              ),
            ],
            if (report.description != null) ...[
              const SizedBox(height: 8),
              Text(
                report.description!,
                style: const TextStyle(fontSize: 14),
              ),
            ],
            if (report.address != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.location_on, size: 16, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      report.address!,
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  ),
                ],
              ),
            ],
            if (report.createdAt != null) ...[
              const SizedBox(height: 8),
              Text(
                'Submitted: ${report.createdAt!.toLocal().toString().split('.')[0]}',
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ],
            if (report.proofUrl != null) ...[
              const SizedBox(height: 12),
              VideoProofPlayer(
                url: report.proofUrl!,
                proofType: report.proofType,
                height: 200,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
