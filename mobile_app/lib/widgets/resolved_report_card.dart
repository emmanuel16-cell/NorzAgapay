import 'package:flutter/material.dart';
import 'dart:typed_data';
import '../core/incident_time_format.dart';
import 'resolution_pdf_download_button.dart';

class ResolvedReportCard extends StatelessWidget {
  final String reportId;
  final String reportType;
  final String title;
  final String? reporterName;
  final String? reporterEmail;
  final String? reporterPhone;
  final String? classification;
  final DateTime? receivedAt;
  final DateTime? incidentOccurredAt;
  final DateTime? resolvedAt;
  final String incidentTimePrecision;
  final VoidCallback onTap;
  final Future<Uint8List> Function() loadPdf;
  final Widget? footer;

  const ResolvedReportCard({
    super.key,
    required this.reportId,
    required this.reportType,
    required this.title,
    required this.onTap,
    required this.loadPdf,
    this.reporterName,
    this.reporterEmail,
    this.reporterPhone,
    this.classification,
    this.receivedAt,
    this.incidentOccurredAt,
    this.resolvedAt,
    this.incidentTimePrecision = 'unknown',
    this.footer,
  });

  @override
  Widget build(BuildContext context) {
    final typeColor = reportType.toLowerCase().contains('emergency')
        ? const Color(0xFFEF4444)
        : const Color(0xFFF59E0B);
    final emailOrPhone = (reporterEmail ?? '').trim().isNotEmpty
        ? reporterEmail!.trim()
        : (reporterPhone ?? '').trim();
    final details = (classification ?? '').trim();

    return Card(
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onTap,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      _badge(reportType.toUpperCase(), typeColor),
                      _badge('RESOLVED', const Color(0xFF10B981)),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    title,
                    style: const TextStyle(
                      color: Color(0xFF0F172A),
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if ((reporterName ?? '').trim().isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Reported by ${reporterName!.trim()}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF475569),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                  if (details.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      details,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 11,
                      ),
                    ),
                  ],
                  if (emailOrPhone.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    _detailLine(Icons.email_outlined, emailOrPhone),
                  ],
                  if (receivedAt != null) ...[
                    const SizedBox(height: 4),
                    _detailLine(
                      Icons.access_time_rounded,
                      'Report received: ${formatIncidentDateTime(receivedAt!)}',
                    ),
                  ],
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(
                        Icons.history_rounded,
                        size: 14,
                        color: Color(0xFF64748B),
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: IncidentOccurrenceText(
                          occurredAt: incidentOccurredAt,
                          receivedAt: receivedAt,
                          resolvedAt: resolvedAt,
                          precision: incidentTimePrecision,
                          isResolved: true,
                          style: const TextStyle(
                            color: Color(0xFF64748B),
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          ResolutionPdfDownloadButton(reportId: reportId, loadPdf: loadPdf),
          ?footer,
        ],
      ),
    );
  }

  Widget _badge(String label, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .14),
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: color.withValues(alpha: .45)),
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.bold),
    ),
  );

  Widget _detailLine(IconData icon, String text) => Row(
    children: [
      Icon(icon, size: 14, color: const Color(0xFF1B4F72)),
      const SizedBox(width: 4),
      Expanded(
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
        ),
      ),
    ],
  );
}
