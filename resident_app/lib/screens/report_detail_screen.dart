import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import '../models/incident_report.dart';
import '../core/constants.dart';
import '../services/norzagaray_boundary.dart';
import '../services/report_updates_service.dart';
import '../widgets/video_proof_player.dart';
import '../widgets/resident_gradient_app_bar.dart';
import '../widgets/municipality_boundary_map_layer.dart';
import 'emergency_camera_screen.dart';

class ReportDetailScreen extends StatefulWidget {
  final IncidentReport report;

  const ReportDetailScreen({super.key, required this.report});

  @override
  State<ReportDetailScreen> createState() => _ReportDetailScreenState();
}

class _ReportDetailScreenState extends State<ReportDetailScreen> {
  late IncidentReport _report;

  @override
  void initState() {
    super.initState();
    _report = widget.report;
    ResidentReportUpdates.reports.addListener(_applyLiveReportUpdate);
  }

  @override
  void dispose() {
    ResidentReportUpdates.reports.removeListener(_applyLiveReportUpdate);
    super.dispose();
  }

  void _applyLiveReportUpdate() {
    final id = _report.id;
    if (id == null) return;
    for (final updated in ResidentReportUpdates.reports.value) {
      if (updated.id != id) continue;
      final hasChanged =
          updated.displayStatus != _report.displayStatus ||
          updated.reviewOutcome != _report.reviewOutcome ||
          updated.reviewReason != _report.reviewReason ||
          updated.incidentOccurredAt != _report.incidentOccurredAt ||
          updated.incidentTimePrecision != _report.incidentTimePrecision ||
          updated.acceptedAt != _report.acceptedAt ||
          updated.arrivedAt != _report.arrivedAt ||
          updated.resolvedAt != _report.resolvedAt ||
          updated.barangayResponderName != _report.barangayResponderName ||
          updated.mdrrmoResponderName != _report.mdrrmoResponderName ||
          updated.expectedArrivalSeconds != _report.expectedArrivalSeconds ||
          updated.expectedResolutionSeconds !=
              _report.expectedResolutionSeconds;
      if (hasChanged && mounted) setState(() => _report = updated);
      return;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  Color get _accentColor => _report.type == 'emergency'
      ? const Color(0xFFE74C3C)
      : const Color(0xFFF39C12);

  String _formatDate(DateTime? dt) {
    if (dt == null) return '—';
    final local = dt.toLocal();
    return '${DateFormat('MMM d, yyyy').format(local)} / ${DateFormat('hh:mm a').format(local)}';
  }

  void _openProofFullscreen(int index) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => _ProofFullscreenPage(
          urls: _report.proofUrls,
          types: _report.proofTypes,
          initialIndex: index,
        ),
      ),
    );
  }

  bool get _isResolved => _report.displayStatus == 'resolved';
  bool get _isReviewClosed =>
      _report.displayStatus == 'inconclusive' ||
      _report.displayStatus == 'false_report';

  void _openEditModal() {
    if (_report.isDemoData || _isResolved || _isReviewClosed) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EditReportModal(
        report: _report,
        accentColor: _accentColor,
        onSaved: (updated) {
          setState(() => _report = updated);
        },
      ),
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: ResidentGradientAppBar(
        colors: _report.type == 'emergency'
            ? ResidentHeaderGradients.emergency
            : ResidentHeaderGradients.community,
        title: Text(
          _report.title,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17),
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_report.isDemoData)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF7E6),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFF3D28B)),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons.science_outlined,
                            size: 17,
                            color: Color(0xFF9A6700),
                          ),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'DEMO · Read-only sample incident',
                              style: TextStyle(
                                color: Color(0xFF7A5100),
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  _buildMapSection(),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 4,
                    ),
                    child: _buildCoordRow(),
                  ),
                  const SizedBox(height: 16),
                  _buildDetailsSection(),
                  const SizedBox(height: 12),
                  _buildIncidentTimeSummary(),
                  if (!_isReviewClosed) ...[
                    const SizedBox(height: 16),
                    _buildResponseProgress(),
                    const SizedBox(height: 16),
                    _buildResponseTimeline(),
                  ],
                  const SizedBox(height: 16),
                  _buildProofSection(),
                  if (_report.responderMedia.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _buildResponderMedia(),
                  ],
                  SizedBox(height: _isResolved || _isReviewClosed ? 24 : 100),
                ],
              ),
            ),
          ),
          if (!_report.isDemoData && !_isResolved && !_isReviewClosed)
            _buildEditButton(),
        ],
      ),
    );
  }

  // ── Map ────────────────────────────────────────────────────────────────────

  Widget _buildMapSection() {
    final reportLocation = LatLng(_report.latitude, _report.longitude);
    final hasMunicipalLocation = NorzagarayBoundary.containsPoint(
      reportLocation,
    );
    final center = hasMunicipalLocation
        ? reportLocation
        : NorzagarayBoundary.townCenter;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
          child: const Text(
            'Incident Location',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1A1A2E),
            ),
          ),
        ),
        if (!hasMunicipalLocation)
          Container(
            height: 120,
            margin: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'This report location is outside Norzagaray and is not shown on the map.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xFF64748B)),
              ),
            ),
          )
        else
          SizedBox(
            height: 200,
            child: FlutterMap(
              options: MapOptions(
                initialCenter: center,
                initialZoom: 15,
                cameraConstraint: NorzagarayBoundary.isEnabled
                    ? CameraConstraint.containCenter(
                        bounds: NorzagarayBoundary.cameraBounds,
                      )
                    : CameraConstraint.unconstrained(),
                interactionOptions: const InteractionOptions(
                  flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
                ),
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.norzagapay.resident',
                ),
                MunicipalityBoundaryMarkerLayer(
                  markers: [
                    Marker(
                      point: center,
                      width: 48,
                      height: 56,
                      child: Column(
                        children: [
                          Container(
                            width: 32,
                            height: 32,
                            decoration: BoxDecoration(
                              color: _accentColor,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: Colors.white,
                                width: 2.5,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: _accentColor.withValues(alpha: 0.4),
                                  blurRadius: 8,
                                  offset: const Offset(0, 3),
                                ),
                              ],
                            ),
                            child: const Icon(
                              Icons.location_on,
                              color: Colors.white,
                              size: 18,
                            ),
                          ),
                          Container(width: 2, height: 14, color: _accentColor),
                        ],
                      ),
                    ),
                  ],
                ),
                const MunicipalityBoundaryMapLayer(outsideColor: Colors.white),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildCoordRow() {
    if (!NorzagarayBoundary.contains(_report.latitude, _report.longitude)) {
      return const Text(
        'Coordinates are outside the municipality and are hidden.',
        style: TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
      );
    }
    final lat = _report.latitude.toStringAsFixed(5);
    final lng = _report.longitude.toStringAsFixed(5);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Coordinates: $lat, $lng',
          style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
        ),
        if (_report.address != null && _report.address!.trim().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              _report.address!,
              style: const TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
            ),
          )
        else
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Text(
              'Unable to get your current location',
              style: TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
            ),
          ),
      ],
    );
  }

  // ── Details ────────────────────────────────────────────────────────────────

  Widget _buildDetailsSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              const Text(
                'Details',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF1A1A2E),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFF3F4F6),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  _formatDate(_report.createdAt),
                  style: const TextStyle(
                    fontSize: 10,
                    color: Color(0xFF6B7280),
                  ),
                ),
              ),
              const Spacer(),
              _buildStatusPill(_report.displayStatus),
            ],
          ),

          if (_isReviewClosed) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _report.displayStatus == 'inconclusive'
                    ? const Color(0xFFFFF7ED)
                    : const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: _report.displayStatus == 'inconclusive'
                      ? const Color(0xFFFDBA74)
                      : const Color(0xFFFCA5A5),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _report.displayStatus == 'inconclusive'
                        ? 'This report is inconclusive'
                        : 'This report was marked false',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F2937),
                    ),
                  ),
                  if (_report.reviewReason?.trim().isNotEmpty == true) ...[
                    const SizedBox(height: 5),
                    Text(
                      _report.reviewReason!,
                      style: const TextStyle(
                        height: 1.4,
                        color: Color(0xFF475569),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],

          const SizedBox(height: 10),

          // Description box
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFF9FAFB),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFE5E7EB)),
            ),
            child: Text(
              (_report.description?.trim().isNotEmpty == true)
                  ? _report.description!
                  : '—  No details provided',
              style: TextStyle(
                fontSize: 14,
                color: (_report.description?.trim().isNotEmpty == true)
                    ? const Color(0xFF374151)
                    : const Color(0xFFBDC3CE),
                height: 1.6,
              ),
            ),
          ),

          // Specifics chip
          if (_report.specifics?.trim().isNotEmpty == true) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                Chip(
                  label: Text(
                    _report.specifics!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF374151),
                    ),
                  ),
                  backgroundColor: const Color(0xFFF3F4F6),
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildStatusPill(String status) {
    Color color;
    String label;
    switch (status) {
      case 'resolved':
        color = const Color(0xFF27AE60);
        label = 'RESOLVED';
        break;
      case 'responding':
        color = const Color(0xFF1E88E5);
        label = 'RESPONDING';
        break;
      case 'inconclusive':
        color = const Color(0xFFF97316);
        label = 'INCONCLUSIVE';
        break;
      case 'false_report':
        color = const Color(0xFFDC2626);
        label = 'FALSE REPORT';
        break;
      case 'pending':
      default:
        color = const Color(0xFFF39C12);
        label = 'PENDING';
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 1),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Widget _buildResponseProgress() {
    final status = _report.displayStatus;
    final responderName = _report.activeResponderName;
    final assignedResponder = responderName == null ? '' : ' $responderName';
    final expectedResponse = _formatExpected(_report.expectedResponseSeconds);
    final expectedArrival = _formatExpected(_report.expectedArrivalSeconds);
    final expectedResolution = _formatExpected(
      _report.expectedResolutionSeconds,
    );
    final steps = <(String, String, bool)>[
      (
        'Report received',
        'Your report was received by ${_report.sendTo == 'mdrrmo' ? 'MDRRMO' : (_report.barangayName == null ? 'the barangay response team' : 'Barangay ${_report.barangayName}')}.',
        true,
      ),
      (
        'Dispatcher review and responder acceptance',
        status == 'pending' && _report.dispatchedAt == null
            ? 'Your report is being reviewed by ${_report.handlingUnitName}.${expectedResponse == null ? '' : ' Expected response and acceptance time: about $expectedResponse.'}'
            : (_report.barangayResponseNotes?.trim().isNotEmpty == true
                      ? _report.barangayResponseNotes!.replaceFirst(
                          RegExp(r'^\[ASSIGNED:[^\]]+\]\s*'),
                          '',
                        )
                      : 'A response team$assignedResponder is handling the incident.') +
                  (expectedArrival == null
                      ? ''
                      : ' Expected arrival time: about $expectedArrival.'),
        _report.dispatchedAt != null || status != 'pending',
      ),
      (
        'MDRRMO coordination',
        _report.mdrrmoCoordinationNotes?.trim().isNotEmpty == true
            ? _report.mdrrmoCoordinationNotes!
            : 'No MDRRMO escalation recorded.',
        _report.mdrrmoResponseStatus?.toLowerCase() == 'responding' ||
            _report.mdrrmoCoordinationNotes?.trim().isNotEmpty == true,
      ),
      (
        'Incident resolution',
        _report.resolvedNotes?.trim().isNotEmpty == true
            ? _report.resolvedNotes!
            : (_report.arrivedAt != null && status != 'resolved'
                  ? 'Responder$assignedResponder arrived in the incident area and is resolving your report.${expectedResolution == null ? '' : ' Expected resolution time: about $expectedResolution.'}'
                  : (status == 'resolved'
                        ? 'Marked as resolved.'
                        : 'The response team has not closed this incident.')),
        status == 'resolved',
      ),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Response Progress',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1A1A2E),
              ),
            ),
            const SizedBox(height: 10),
            for (var i = 0; i < steps.length; i++) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    steps[i].$3
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    size: 18,
                    color: steps[i].$3
                        ? const Color(0xFF0F9D83)
                        : const Color(0xFF9CA3AF),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          steps[i].$1,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF243247),
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          steps[i].$2,
                          style: const TextStyle(
                            fontSize: 12,
                            height: 1.4,
                            color: Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (i < steps.length - 1)
                const Padding(
                  padding: EdgeInsets.only(left: 8, top: 3, bottom: 3),
                  child: SizedBox(
                    height: 8,
                    child: VerticalDivider(
                      width: 1,
                      thickness: 1,
                      color: Color(0xFFCBD5E1),
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  String? _formatExpected(double? seconds) {
    if (seconds == null || seconds < 0) return null;
    final roundedSeconds = seconds.round();
    final hours = roundedSeconds ~/ 3600;
    final minutes = (roundedSeconds % 3600) ~/ 60;
    final remainder = roundedSeconds % 60;
    if (hours > 0) return '${hours}h ${minutes}m';
    if (minutes > 0) return '${minutes}m';
    return '${remainder}s';
  }

  String _formatElapsed(DateTime? start, DateTime? end) {
    if (start == null || end == null) return '—';
    final seconds = end.difference(start).inSeconds;
    if (seconds < 0) return '—';
    final hours = seconds ~/ 3600;
    final minutes = (seconds % 3600) ~/ 60;
    final remainder = seconds % 60;
    if (hours > 0) return '${hours}h ${minutes}m';
    if (minutes > 0) return '${minutes}m ${remainder}s';
    return '${remainder}s';
  }

  String _formatDistance(double distanceM) => distanceM >= 1000
      ? '${(distanceM / 1000).toStringAsFixed(distanceM >= 10000 ? 1 : 2)} km'
      : '${distanceM.round()} m';

  Widget _buildResponseTimeline() {
    final rows = <(String, DateTime?, String)>[
      if (_report.clientSubmittedAt != null)
        ('First submit attempt (device time)', _report.clientSubmittedAt, ''),
      ('Report received', _report.createdAt, ''),
      ('Dispatcher reviewed', _report.dispatcherReviewedAt, ''),
      ('Responder dispatched', _report.dispatchedAt, ''),
      (
        'Responder accepted',
        _report.acceptedAt,
        'Response to acceptance: ${_formatElapsed(_report.createdAt, _report.acceptedAt)}',
      ),
      (
        'Arrived at incident area',
        _report.arrivedAt,
        'Travel to arrival: ${_formatElapsed(_report.acceptedAt, _report.arrivedAt)}',
      ),
      (
        'Incident resolved',
        _report.resolvedAt,
        'Time to resolve: ${_formatElapsed(_report.arrivedAt, _report.resolvedAt)}',
      ),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Response Times',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1A1A2E),
              ),
            ),
            const SizedBox(height: 10),
            ...rows.map(
              (row) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.circle, size: 7, color: Color(0xFF1E88E5)),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            row.$1,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF243247),
                            ),
                          ),
                          Text(
                            _formatDate(row.$2),
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF64748B),
                            ),
                          ),
                          if (row.$3.isNotEmpty)
                            Text(
                              row.$3,
                              style: const TextStyle(
                                fontSize: 11,
                                color: Color(0xFF0369A1),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_report.travelDistanceM != null)
              Padding(
                padding: const EdgeInsets.only(top: 4, left: 16),
                child: Text(
                  'Responder distance at acceptance: ${_formatDistance(_report.travelDistanceM!)} from incident${_report.travelDistanceAccuracyM == null ? '' : ' · GPS accuracy ±${_report.travelDistanceAccuracyM!.round()} m'}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xFF0369A1),
                  ),
                ),
              ),
            if (_report.arrivedAt != null)
              Text(
                'Arrival recorded ${_report.arrivalMethod == 'gps' ? 'by GPS' : 'manually'}${_report.arrivalDistanceM == null ? '' : ' · ${_report.arrivalDistanceM!.round()} m from incident'}',
                style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildIncidentTimeSummary() {
    final occurredAt = _report.incidentOccurredAt;
    final incidentTime =
        occurredAt == null || _report.incidentTimePrecision == 'unknown'
        ? 'Incident time unknown'
        : '${_formatDate(occurredAt)} (${_report.incidentTimePrecision})';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Incident Time',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: Color(0xFF1A1A2E),
              ),
            ),
            const SizedBox(height: 8),
            Text('Incident occurred: $incidentTime'),
            const SizedBox(height: 4),
            Text('Report received: ${_formatDate(_report.createdAt)}'),
          ],
        ),
      ),
    );
  }

  Widget _buildResponderMedia() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Field documentation (${_report.responderMedia.length})',
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1A1A2E),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 92,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _report.responderMedia.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final item = _report.responderMedia[index];
                final url = item['url']?.toString() ?? '';
                final type = item['type']?.toString() ?? 'image';
                final video = type == 'video' || _isVideo(type, url);
                return GestureDetector(
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => _ProofFullscreenPage(
                        urls: [url],
                        types: [type],
                        initialIndex: 0,
                      ),
                    ),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(9),
                    child: SizedBox(
                      width: 112,
                      child: video
                          ? Container(
                              color: const Color(0xFFE2E8F0),
                              child: const Center(
                                child: Icon(
                                  Icons.play_circle_fill,
                                  size: 32,
                                  color: Color(0xFF1E5678),
                                ),
                              ),
                            )
                          : Image.network(
                              url,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => const ColoredBox(
                                color: Color(0xFFF3F4F6),
                                child: Center(
                                  child: Icon(Icons.broken_image_outlined),
                                ),
                              ),
                            ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  // ── Proof Gallery ──────────────────────────────────────────────────────────

  Widget _buildProofSection() {
    final urls = _report.proofUrls;
    final types = _report.proofTypes;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Proof of Incident',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1A1A2E),
            ),
          ),
          const SizedBox(height: 12),

          if (urls.isEmpty)
            Container(
              height: 120,
              decoration: BoxDecoration(
                color: const Color(0xFFF9FAFB),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.image_not_supported_outlined,
                      color: Colors.grey,
                      size: 36,
                    ),
                    SizedBox(height: 8),
                    Text(
                      'No proof attached',
                      style: TextStyle(color: Colors.grey, fontSize: 13),
                    ),
                  ],
                ),
              ),
            )
          else
            SizedBox(
              height: 68,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: urls.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  return GestureDetector(
                    onTap: () => _openProofFullscreen(index),
                    child: Container(
                      width: 68,
                      height: 68,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(7),
                        child:
                            _isVideo(
                              types.length > index ? types[index] : 'image',
                              urls[index],
                            )
                            ? Stack(
                                fit: StackFit.expand,
                                children: [
                                  Container(color: Colors.black87),
                                  const Center(
                                    child: Icon(
                                      Icons.play_circle_outline,
                                      color: Colors.white,
                                      size: 28,
                                    ),
                                  ),
                                ],
                              )
                            : Image.network(
                                urls[index],
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, e) => Container(
                                  color: const Color(0xFFF3F4F6),
                                  child: const Center(
                                    child: Icon(
                                      Icons.broken_image,
                                      color: Colors.grey,
                                      size: 24,
                                    ),
                                  ),
                                ),
                              ),
                      ),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  bool _isVideo(String type, String url) {
    if (type == 'video') return true;
    final lower = url.toLowerCase().split('?').first;
    return lower.endsWith('.mp4') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.webm') ||
        lower.endsWith('.3gp') ||
        lower.endsWith('.mkv') ||
        lower.endsWith('.avi');
  }

  // ── Edit Button ────────────────────────────────────────────────────────────

  Widget _buildEditButton() {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 16,
            offset: Offset(0, -4),
          ),
        ],
      ),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      child: SizedBox(
        width: double.infinity,
        height: 50,
        child: OutlinedButton.icon(
          onPressed: _openEditModal,
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: const Text(
            'Edit / Add',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
          style: OutlinedButton.styleFrom(
            foregroundColor: _accentColor,
            side: BorderSide(color: _accentColor, width: 1.5),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Fullscreen Viewer
// ─────────────────────────────────────────────────────────────────────────────

class _ProofFullscreenPage extends StatelessWidget {
  final List<String> urls;
  final List<String> types;
  final int initialIndex;

  const _ProofFullscreenPage({
    required this.urls,
    required this.types,
    required this.initialIndex,
  });

  bool _isVideo(String type, String url) {
    if (type == 'video') return true;
    final lower = url.toLowerCase().split('?').first;
    return lower.endsWith('.mp4') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.webm') ||
        lower.endsWith('.3gp') ||
        lower.endsWith('.mkv') ||
        lower.endsWith('.avi');
  }

  @override
  Widget build(BuildContext context) {
    final controller = PageController(initialPage: initialIndex);
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: ResidentGradientAppBar(
        title: Text(
          'Proof ${initialIndex + 1} of ${urls.length}',
          style: const TextStyle(fontSize: 14, color: Colors.white70),
        ),
      ),
      body: PageView.builder(
        controller: controller,
        itemCount: urls.length,
        itemBuilder: (context, index) {
          final type = types.length > index ? types[index] : 'image';
          if (_isVideo(type, urls[index])) {
            return Center(
              child: VideoProofPlayer(
                url: urls[index],
                proofType: type,
                // Let the video use the full available viewer height while
                // keeping its native aspect ratio.
                height: MediaQuery.sizeOf(context).height,
              ),
            );
          }
          return InteractiveViewer(
            child: Center(
              child: Image.network(
                urls[index],
                fit: BoxFit.contain,
                errorBuilder: (_, _, e) => const Icon(
                  Icons.broken_image,
                  color: Colors.grey,
                  size: 80,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit / Add Modal Bottom Sheet
// ─────────────────────────────────────────────────────────────────────────────

class _EditReportModal extends StatefulWidget {
  final IncidentReport report;
  final Color accentColor;
  final ValueChanged<IncidentReport> onSaved;

  const _EditReportModal({
    required this.report,
    required this.accentColor,
    required this.onSaved,
  });

  @override
  State<_EditReportModal> createState() => _EditReportModalState();
}

class _EditReportModalState extends State<_EditReportModal> {
  late TextEditingController _descController;
  late List<_ProofItem> _proofItems;
  bool _isSaving = false;
  String? _detailsError;
  String? _proofError;

  /// Whether the original description was non-empty (cannot be blanked out)
  late final bool _hadDescription;

  @override
  void initState() {
    super.initState();
    final desc = widget.report.description?.trim() ?? '';
    _descController = TextEditingController(text: desc);
    _hadDescription = desc.isNotEmpty;

    // Build proof item list from existing URLs
    _proofItems = List.generate(
      widget.report.proofUrls.length,
      (i) => _ProofItem.network(
        url: widget.report.proofUrls[i],
        type: widget.report.proofTypes.length > i
            ? widget.report.proofTypes[i]
            : 'image',
      ),
    );
  }

  @override
  void dispose() {
    _descController.dispose();
    super.dispose();
  }

  // ── Validation ────────────────────────────────────────────────────────────

  bool _validate() {
    bool ok = true;
    setState(() {
      _detailsError = null;
      _proofError = null;
    });

    final desc = _descController.text.trim();
    if (_hadDescription && desc.isEmpty) {
      setState(() => _detailsError = 'Details cannot be empty.');
      ok = false;
    }

    if (_proofItems.isEmpty) {
      setState(
        () => _proofError = 'At least one proof image or video is required.',
      );
      ok = false;
    }

    return ok;
  }

  // ── Pick new proof ────────────────────────────────────────────────────────

  void _showMediaPickerSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Add Visual Proof',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                  color: Color(0xFF1E293B),
                ),
              ),
              const SizedBox(height: 10),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF0284C7),
                  child: Icon(Icons.camera_alt, color: Colors.white, size: 20),
                ),
                title: const Text(
                  'Take Photo / Video (Emergency Camera)',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: const Text(
                  'Live capture with timestamp',
                  style: TextStyle(fontSize: 12),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _openEmergencyCamera();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openEmergencyCamera() async {
    final proofs = await Navigator.push<List<EmergencyProof>>(
      context,
      MaterialPageRoute(builder: (_) => const EmergencyCameraScreen()),
    );

    if (proofs != null && proofs.isNotEmpty && mounted) {
      setState(() {
        _proofItems.addAll(
          proofs.map(
            (proof) => _ProofItem.local(file: proof.file, type: proof.type),
          ),
        );
        _proofError = null;
      });
    }
  }

  void _addProof() {
    _showMediaPickerSheet();
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  Future<void> _save() async {
    if (!_validate()) return;

    setState(() => _isSaving = true);

    try {
      final id = widget.report.id;

      // Build the updated lists for the local model
      final newUrls = <String>[];
      final newTypes = <String>[];

      // Separate kept network items from new local files
      final networkItems = _proofItems.where((p) => !p.isLocal).toList();
      final localItems = _proofItems.where((p) => p.isLocal).toList();

      for (final item in networkItems) {
        newUrls.add(item.url!);
        newTypes.add(item.type);
      }

      if (id != null) {
        // Build multipart request to PATCH the report
        final uri = Uri.parse(
          '${AppConstants.apiBaseUrl}/incident-reports/$id',
        );
        final request = http.MultipartRequest('PATCH', uri);
        request.headers['ngrok-skip-browser-warning'] = 'true';
        request.fields['description'] = _descController.text.trim();

        // Kept proof URLs as JSON array to prevent Dart map overwriting
        request.fields['kept_proof_urls'] = jsonEncode(newUrls);

        // New local proof files
        for (final item in localItems) {
          final multiFile = await http.MultipartFile.fromPath(
            'new_proofs',
            item.file!.path,
          );
          request.files.add(multiFile);
        }

        final streamed = await request.send().timeout(
          const Duration(seconds: 30),
        );
        final resp = await http.Response.fromStream(streamed);

        if (resp.statusCode == 200 || resp.statusCode == 201) {
          // Server returned updated report
          try {
            final body = jsonDecode(resp.body) as Map<String, dynamic>;
            final updated = IncidentReport.fromJson(body);
            if (mounted) {
              widget.onSaved(updated);
              Navigator.pop(context);
              _showSuccess();
            }
            return;
          } catch (_) {
            // Fall through to local update
          }
        } else if (resp.statusCode != 404 && resp.statusCode != 405) {
          // Unexpected error
          throw Exception('Server error: ${resp.statusCode}');
        }
      }

      // ── Local-only update (endpoint not implemented yet) ─────────────────
      // Add new local items as fake local-path entries until backend is ready
      for (final item in localItems) {
        newUrls.add(item.file!.path);
        newTypes.add(item.type);
      }

      final updated = widget.report.copyWith(
        description: _descController.text.trim(),
        proofUrls: newUrls,
        proofTypes: newTypes,
      );

      if (mounted) {
        widget.onSaved(updated);
        Navigator.pop(context);
        _showSuccess();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to save: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _showSuccess() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Report updated successfully'),
        backgroundColor: Color(0xFF27AE60),
        duration: Duration(seconds: 2),
      ),
    );
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: EdgeInsets.only(bottom: bottomPadding),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (_, scrollController) {
          return Column(
            children: [
              // Handle
              Padding(
                padding: const EdgeInsets.only(top: 12, bottom: 8),
                child: Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFDDE0E5),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),

              // Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Edit / Add',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1A1A2E),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close, color: Color(0xFF6B7280)),
                    ),
                  ],
                ),
              ),

              const Divider(height: 1),

              // Scrollable content
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  children: [
                    _buildDetailsEditor(),
                    const SizedBox(height: 24),
                    _buildProofEditor(),
                    const SizedBox(height: 28),
                    _buildSaveButton(),
                    const SizedBox(height: 12),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  // ── Details editor ────────────────────────────────────────────────────────

  Widget _buildDetailsEditor() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Details',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1A1A2E),
          ),
        ),
        const SizedBox(height: 8),
        TextFormField(
          controller: _descController,
          maxLines: 5,
          onChanged: (_) {
            if (_detailsError != null) {
              setState(() => _detailsError = null);
            }
          },
          style: const TextStyle(fontSize: 14, color: Color(0xFF374151)),
          decoration: InputDecoration(
            hintText: _hadDescription
                ? 'Details cannot be empty'
                : 'Add details (optional)',
            hintStyle: const TextStyle(fontSize: 13, color: Color(0xFFBDC3CE)),
            filled: true,
            fillColor: const Color(0xFFF9FAFB),
            contentPadding: const EdgeInsets.all(14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(
                color: _detailsError != null
                    ? Colors.redAccent
                    : const Color(0xFFE5E7EB),
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(
                color: _detailsError != null
                    ? Colors.redAccent
                    : const Color(0xFFE5E7EB),
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(
                color: _detailsError != null
                    ? Colors.redAccent
                    : widget.accentColor,
                width: 1.5,
              ),
            ),
          ),
        ),
        if (_detailsError != null) ...[
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(
                Icons.error_outline,
                color: Colors.redAccent,
                size: 14,
              ),
              const SizedBox(width: 4),
              Text(
                _detailsError!,
                style: const TextStyle(color: Colors.redAccent, fontSize: 12),
              ),
            ],
          ),
        ],
      ],
    );
  }

  // ── Proof editor ──────────────────────────────────────────────────────────

  Widget _buildProofEditor() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Proof of Incident',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1A1A2E),
          ),
        ),
        const SizedBox(height: 10),

        SizedBox(
          height: 90,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _proofItems.length + 1, // +1 for the add button
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (context, index) {
              if (index == _proofItems.length) {
                // Add button
                return GestureDetector(
                  onTap: _addProof,
                  child: Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: const Color(0xFFF9FAFB),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: _proofError != null
                            ? Colors.redAccent
                            : widget.accentColor.withValues(alpha: 0.5),
                        width: 1.5,
                      ),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.add, color: widget.accentColor, size: 28),
                        const SizedBox(height: 2),
                        Text(
                          'Add',
                          style: TextStyle(
                            color: widget.accentColor,
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }

              final item = _proofItems[index];
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: index == 0
                            ? widget.accentColor
                            : const Color(0xFFE5E7EB),
                        width: index == 0 ? 2 : 1,
                      ),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(9),
                      child: _buildThumbnail(item),
                    ),
                  ),
                  // Remove button
                  Positioned(
                    top: -6,
                    right: -6,
                    child: GestureDetector(
                      onTap: () {
                        setState(() {
                          _proofItems.removeAt(index);
                          _proofError = null;
                        });
                      },
                      child: Container(
                        width: 22,
                        height: 22,
                        decoration: const BoxDecoration(
                          color: Color(0xFFE74C3C),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.close,
                          color: Colors.white,
                          size: 12,
                        ),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),

        if (_proofError != null) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(
                Icons.error_outline,
                color: Colors.redAccent,
                size: 14,
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  _proofError!,
                  style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildThumbnail(_ProofItem item) {
    if (item.isLocal) {
      if (item.type == 'video') {
        return Stack(
          fit: StackFit.expand,
          children: [
            Container(color: Colors.black87),
            const Center(
              child: Icon(
                Icons.play_circle_outline,
                color: Colors.white,
                size: 30,
              ),
            ),
          ],
        );
      }
      return Image.file(item.file!, fit: BoxFit.cover);
    }

    // Network item
    if (item.type == 'video') {
      return Stack(
        fit: StackFit.expand,
        children: [
          Container(color: Colors.black87),
          const Center(
            child: Icon(
              Icons.play_circle_outline,
              color: Colors.white,
              size: 30,
            ),
          ),
        ],
      );
    }

    return Image.network(
      item.url!,
      fit: BoxFit.cover,
      errorBuilder: (_, _, e) => Container(
        color: const Color(0xFFF3F4F6),
        child: const Center(
          child: Icon(Icons.broken_image, color: Colors.grey, size: 24),
        ),
      ),
    );
  }

  // ── Save button ───────────────────────────────────────────────────────────

  Widget _buildSaveButton() {
    return SizedBox(
      width: double.infinity,
      height: 50,
      child: ElevatedButton(
        onPressed: _isSaving ? null : _save,
        style: ElevatedButton.styleFrom(
          backgroundColor: widget.accentColor,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        child: _isSaving
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  color: Colors.white,
                  strokeWidth: 2.5,
                ),
              )
            : const Text(
                'Save Changes',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
              ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal proof item model (network URL or local File)
// ─────────────────────────────────────────────────────────────────────────────

class _ProofItem {
  final String? url;
  final File? file;
  final String type; // 'image' | 'video'

  bool get isLocal => file != null;

  const _ProofItem._({this.url, this.file, required this.type});

  factory _ProofItem.network({required String url, required String type}) =>
      _ProofItem._(url: url, type: type);

  factory _ProofItem.local({required File file, required String type}) =>
      _ProofItem._(file: file, type: type);
}
