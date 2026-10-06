import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

class IncidentSocketService {
  IO.Socket? _socket;
  String? _token;
  String? _userId;
  VoidCallback? _onLifecycleChange;

  bool get isConnected => _socket?.connected ?? false;

  void connect({
    required String url,
    required String token,
    required String userId,
    required VoidCallback onConnected,
    required ValueChanged<String> onReportLifecycle,
  }) {
    _onLifecycleChange = onConnected;
    if (_socket != null && _token == token && _userId == userId) {
      if (!_socket!.connected) _socket!.connect();
      return;
    }

    disconnect();
    _token = token;
    _userId = userId;
    _socket = IO.io(
      url,
      IO.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableAutoConnect()
          .setExtraHeaders({'ngrok-skip-browser-warning': 'true'})
          .build(),
    );

    _socket!.onConnect((_) {
      _socket?.emit('join:user', userId);
      // The snapshot fetch is also the catch-up path after any offline period.
      _onLifecycleChange?.call();
    });
    _socket!.on('incident:lifecycle', (data) {
      if (data is Map && data['report_id'] is String) {
        onReportLifecycle(data['report_id'].toString());
      }
    });
    _socket!.onConnectError((error) {
      debugPrint('Resident incident socket connection error: $error');
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _token = null;
    _userId = null;
  }
}
