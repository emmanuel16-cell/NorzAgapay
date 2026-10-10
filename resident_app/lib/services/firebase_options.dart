import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Firebase's Android client settings for the Norz-Agapay resident app.
/// These values match the resident Android client registered in Firebase.
class DefaultFirebaseOptions {
  static FirebaseOptions? get currentPlatform {
    if (defaultTargetPlatform != TargetPlatform.android) return null;

    return const FirebaseOptions(
      apiKey: 'AIzaSyAK7wmNos-JZPiYa5zTl9VxFT-tcr0yg3s',
      appId: '1:726287539777:android:eeb1500e5f67a1e079b0c0',
      messagingSenderId: '726287539777',
      projectId: 'norzagapay',
      storageBucket: 'norzagapay.firebasestorage.app',
    );
  }
}
