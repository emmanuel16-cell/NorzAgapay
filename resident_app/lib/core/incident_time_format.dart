import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

String formatIncidentDateTime(DateTime timestamp, {DateTime? now}) {
  final local = timestamp.toLocal();
  final today = (now ?? DateTime.now()).toLocal();
  final localDay = DateTime(local.year, local.month, local.day);
  final todayDay = DateTime(today.year, today.month, today.day);
  final yesterdayDay = todayDay.subtract(const Duration(days: 1));

  final dateLabel = localDay == todayDay
      ? 'Today'
      : localDay == yesterdayDay
      ? 'Yesterday'
      : DateFormat('MMM d, yyyy').format(local);
  return '$dateLabel · ${DateFormat('h:mm a').format(local)}';
}

String formatIncidentAge(
  DateTime occurredAt,
  DateTime referenceTime, {
  DateTime? now,
}) {
  final duration = referenceTime.difference(occurredAt);
  final totalMinutes = duration.isNegative ? 0 : duration.inMinutes;
  final totalHours = totalMinutes ~/ 60;
  final totalDays = totalHours ~/ 24;
  final remainderHours = totalHours % 24;
  final remainderMinutes = totalMinutes % 60;

  String ageLabel;
  if (totalMinutes == 0) {
    ageLabel = 'less than a minute ago';
  } else if (totalMinutes < 60) {
    ageLabel = '$totalMinutes ${totalMinutes == 1 ? 'minute' : 'minutes'} ago';
  } else if (totalHours < 24) {
    ageLabel = '${totalHours} ${totalHours == 1 ? 'hour' : 'hours'}';
    if (remainderMinutes > 0) {
      ageLabel +=
          ' $remainderMinutes ${remainderMinutes == 1 ? 'minute' : 'minutes'}';
    }
    ageLabel += ' ago';
  } else {
    ageLabel = '$totalDays ${totalDays == 1 ? 'day' : 'days'}';
    if (remainderHours > 0) {
      ageLabel += ' $remainderHours ${remainderHours == 1 ? 'hour' : 'hours'}';
    }
    ageLabel += ' ago';
  }

  final dateLabel = formatIncidentDateTime(
    occurredAt,
    now: now,
  ).split(' · ').first;
  return '$dateLabel · $ageLabel';
}

bool _sameDisplayedMinute(DateTime first, DateTime second) {
  final a = first.toLocal();
  final b = second.toLocal();
  final sameMinute =
      a.year == b.year &&
      a.month == b.month &&
      a.day == b.day &&
      a.hour == b.hour &&
      a.minute == b.minute;
  return sameMinute || first.difference(second).inSeconds.abs() < 60;
}

class IncidentOccurrenceText extends StatefulWidget {
  final DateTime? occurredAt;
  final DateTime? receivedAt;
  final DateTime? resolvedAt;
  final String precision;
  final bool isResolved;
  final TextStyle? style;
  final String prefix;

  const IncidentOccurrenceText({
    super.key,
    required this.occurredAt,
    required this.precision,
    this.receivedAt,
    this.resolvedAt,
    this.isResolved = false,
    this.style,
    this.prefix = 'Incident occurred: ',
  });

  @override
  State<IncidentOccurrenceText> createState() => _IncidentOccurrenceTextState();
}

class _IncidentOccurrenceTextState extends State<IncidentOccurrenceText> {
  DateTime _now = DateTime.now();
  DateTime? _frozenAt;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _syncClock();
  }

  @override
  void didUpdateWidget(covariant IncidentOccurrenceText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.occurredAt != widget.occurredAt ||
        oldWidget.receivedAt != widget.receivedAt ||
        oldWidget.resolvedAt != widget.resolvedAt ||
        oldWidget.isResolved != widget.isResolved) {
      _now = DateTime.now();
      _syncClock();
    }
  }

  void _syncClock() {
    _timer?.cancel();
    _frozenAt = widget.isResolved ? widget.resolvedAt ?? DateTime.now() : null;
    // Refresh date labels across midnight. The elapsed age itself remains
    // frozen at resolvedAt once the incident is resolved.
    _timer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final occurredAt = widget.occurredAt;
    if (occurredAt == null || widget.precision == 'unknown') {
      return Text('Incident time unknown', style: widget.style);
    }

    final receivedAt = widget.receivedAt;
    final incidentLabel =
        receivedAt != null && _sameDisplayedMinute(occurredAt, receivedAt)
        ? formatIncidentDateTime(receivedAt, now: _now)
        : formatIncidentAge(
            occurredAt,
            widget.isResolved ? _frozenAt ?? _now : _now,
            now: _now,
          );
    return Text(
      '${widget.prefix}$incidentLabel (${widget.precision})',
      style: widget.style,
    );
  }
}
