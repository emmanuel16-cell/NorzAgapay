import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum ResidentNotificationSound {
  review,
  dispatch,
  arrival,
  resolved,
}

class NotificationSoundService {
  NotificationSoundService._();

  static const MethodChannel _channel = MethodChannel(
    'ph.gov.mdrrmo.norzagapay/notification_sounds',
  );

  static Future<void> play(ResidentNotificationSound sound) async {
    if (kIsWeb) return;
    if (defaultTargetPlatform != TargetPlatform.android) {
      await SystemSound.play(SystemSoundType.click);
      return;
    }
    try {
      await _channel.invokeMethod<void>('play', {'sound': sound.name});
    } on MissingPluginException {
      await SystemSound.play(SystemSoundType.click);
    } catch (error) {
      debugPrint('Could not play report update sound: $error');
    }
  }
}
