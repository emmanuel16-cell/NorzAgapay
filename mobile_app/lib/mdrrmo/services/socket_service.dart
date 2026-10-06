import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../core/constants.dart';
import 'package:flutter/foundation.dart';

class SocketService {
  static IO.Socket? _socket;
  static String? _socketToken;
  static String? _connectedUserId;
  static String? _connectedRole;
  static bool _roleJoinListenerBound = false;

  static IO.Socket get socket {
    if (_socket == null) {
      _initSocket();
    }
    return _socket!;
  }

  static void _initSocket([String? token]) {
    // Extract base URL from apiBaseUrl (remove /api)
    final String baseUrl = AppConstants.apiBaseUrl.replaceFirst('/api', '');

    final options = IO.OptionBuilder()
      .setTransports(['websocket']) // Use WebSocket transport
      .disableAutoConnect() // Disable auto-connect to manually connect later
      .setExtraHeaders({'ngrok-skip-browser-warning': 'true'});
    if (token != null) options.setAuth({'token': token});
    _socket = IO.io(baseUrl, options.build());

    _socket!.onConnect((_) => debugPrint('Connected to Socket.io server'));
    _socket!.onDisconnect((_) => debugPrint('Disconnected from Socket.io server'));
    _socket!.onConnectError((err) => debugPrint('Socket connection error: $err'));
  }

  static void connect(String userId, String role, String token) {
    if (_socket == null || _socketToken != token) {
      _socket?.dispose();
      _socket = null;
      _socketToken = token;
      _roleJoinListenerBound = false;
      _initSocket(token);
    }
    _connectedUserId = userId;
    _connectedRole = role;
    if (!_roleJoinListenerBound) {
      _socket!.onConnect((_) {
        final currentUserId = _connectedUserId;
        final currentRole = _connectedRole;
        if (currentUserId == null || currentRole == null) return;
        _socket!.emit('join:role', currentRole);
        _socket!.emit('join:user', currentUserId);
        debugPrint('Socket connected and joined rooms for user: $currentUserId and role: $currentRole');
      });
      _roleJoinListenerBound = true;
    }
    _socket!.connect();
  }

  static void onMdrrmoReportAssigned(void Function(dynamic) callback) {
    socket.on('mdrrmo:report_assigned', callback);
  }

  static void onMdrrmoReportUpdated(void Function(dynamic) callback) {
    socket.on('mdrrmo:report_updated', callback);
    socket.on('incident:lifecycle', callback);
  }

  static void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _socketToken = null;
    _connectedUserId = null;
    _connectedRole = null;
    _roleJoinListenerBound = false;
  }
}
