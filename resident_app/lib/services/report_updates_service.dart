import 'package:flutter/foundation.dart';
import '../models/incident_report.dart';

class ResidentReportUpdates {
  static final ValueNotifier<List<IncidentReport>> reports =
      ValueNotifier<List<IncidentReport>>(const []);

  static void publish(List<IncidentReport> value) {
    reports.value = List<IncidentReport>.unmodifiable(value);
  }
}
