import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Firebase app options are supplied at build time so project identifiers and
/// platform app IDs do not need to be guessed or committed to this repository.
class DefaultFirebaseOptions {
  static const String _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const String _messagingSenderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID',
  );
  static const String _projectId = String.fromEnvironment(
    'FIREBASE_PROJECT_ID',
  );
  static const String _androidAppId = String.fromEnvironment(
    'FIREBASE_ANDROID_APP_ID',
  );
  static FirebaseOptions? get currentPlatform {
    if (_apiKey.isEmpty || _messagingSenderId.isEmpty || _projectId.isEmpty) {
      return null;
    }

    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        if (_androidAppId.isEmpty) return null;
        return FirebaseOptions(
          apiKey: _apiKey,
          appId: _androidAppId,
          messagingSenderId: _messagingSenderId,
          projectId: _projectId,
        );
      default:
        return null;
    }
  }
}
