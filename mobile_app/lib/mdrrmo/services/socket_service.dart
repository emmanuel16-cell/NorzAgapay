import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../core/constants.dart';
import 'package:flutter/foundation.dart';

class SocketService {
  static IO.Socket? _socket;

  static IO.Socket get socket {
    if (_socket == null) {
      _initSocket();
    }
    return _socket!;
  }

  static void _initSocket() {
    // Extract base URL from apiBaseUrl (remove /api)
    final String baseUrl = AppConstants.apiBaseUrl.replaceFirst('/api', '');

    _socket = IO.io(baseUrl, IO.OptionBuilder()
      .setTransports(['websocket']) // Use WebSocket transport
      .disableAutoConnect() // Disable auto-connect to manually connect later
      .setExtraHeaders({
        'ngrok-skip-browser-warning': 'true',
      })
      .build());

    _socket!.onConnect((_) => debugPrint('Connected to Socket.io server'));
    _socket!.onDisconnect((_) => debugPrint('Disconnected from Socket.io server'));
    _socket!.onConnectError((err) => debugPrint('Socket connection error: $err'));
  }

  static void connect(String userId, String role) {
    if (_socket == null) _initSocket();
    
    _socket!.connect();
    
    _socket!.onConnect((_) {
      // Join the private room for this user
      _socket!.emit('join:role', role); // Join the account's role room.
      _socket!.emit('join:user', userId); // Private room
      debugPrint('Socket connected and joined rooms for user: $userId and role: $role');
    });
  }

  static void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }
}
