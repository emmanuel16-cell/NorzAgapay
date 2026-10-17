import 'package:flutter/services.dart';

class PhoneNumberUtils {
  static final inputFormatters = <TextInputFormatter>[
    FilteringTextInputFormatter.digitsOnly,
    LengthLimitingTextInputFormatter(12),
  ];

  static bool isValid(String? value) =>
      value != null && RegExp(r'^09\d{9}$').hasMatch(normalize(value));

  static String? validationMessage(String? value) => isValid(value)
      ? null
      : 'Enter an 11-digit mobile number starting with 09';

  static String formatForDisplay(String? value) {
    final digits = normalize(value ?? '');
    if (RegExp(r'^09\d{9}$').hasMatch(digits)) {
      return '${digits.substring(0, 4)}-${digits.substring(4, 7)}-${digits.substring(7)}';
    }
    return value ?? '';
  }

  static String digitsOnly(String? value) =>
      normalize(value ?? '');

  static String normalize(String value) {
    var digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('639') && digits.length == 12) {
      digits = '0' + digits.substring(2);
    } else if (digits.startsWith('9') && digits.length == 10) {
      digits = '0' + digits;
    }
    return digits;
  }
}
