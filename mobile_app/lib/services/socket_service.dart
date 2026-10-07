import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../models/incident_report.dart';

class SocketService extends ChangeNotifier {
  static const String _socketUrl = 'https://norzagapay-backend.onrender.com';
  IO.Socket? _socket;
  bool _isConnected = false;
  String? _barangayId;

  bool get isConnected => _isConnected;

  void connect(String barangayId, {required String token, required String userId}) {
    _barangayId = barangayId;
    if (_socket != null && _socket!.connected) return;

    _socket = IO.io(
      _socketUrl,
      IO.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .setAuth({'token': token})
          .enableAutoConnect()
          .enableReconnection()
          .setExtraHeaders({'ngrok-skip-browser-warning': 'true'})
          .build(),
    );

    _socket!.onConnect((_) {
      _isConnected = true;
      debugPrint('Barangay socket connected: ${_socket!.id}');
      _socket!.emit('join:user', userId);
      _socket!.emit('join:coordination', barangayId);
      joinBarangayRoom();
      notifyListeners();
    });

    _socket!.onDisconnect((_) {
      _isConnected = false;
      debugPrint('Barangay socket disconnected');
      notifyListeners();
    });

    _socket!.onConnectError((error) {
      debugPrint('Barangay socket connection error: $error');
    });
  }

  void ensureConnected() {
    if (_socket != null && !_socket!.connected) {
      _socket!.connect();
    }
  }

  void onNewReport(Function(IncidentReport report) callback) {
    void handle(dynamic data) {
      if (data != null) {
        try {
          final map = data is Map ? Map<String, dynamic>.from(data) : null;
          if (map != null) {
            final report = IncidentReport.fromJson(map);
            callback(report);
          }
        } catch (e) {
          debugPrint('Error parsing report from socket: $e');
        }
      }
    }
    _socket?.off('barangay:report_received');
    _socket?.off('incident_report:new');
    _socket?.on('barangay:report_received', handle);
    _socket?.on('incident_report:new', handle);
  }

  void onTeamMemberAdded(Function(dynamic data) callback) {
    _socket?.on('team:member_added', (data) {
      if (data != null) {
        callback(data);
      }
    });
  }

  void onAssistanceRequest(Function(dynamic data) callback) {
    _socket?.on('assistance:new_request', (data) {
      callback(data);
    });
  }

  void onAssistanceDecision(Function(dynamic data) callback) {
    _socket?.on('assistance:decision', (data) {
      callback(data);
    });
  }

  void onAssistanceTeamAction(Function(dynamic data) callback) {
    _socket?.on('assistance:team_action', (data) {
      callback(data);
    });
  }

  void onMdrrmoResponding(Function(dynamic data) callback) {
    _socket?.on('incident_report:mdrrmo_responding', (data) {
      callback(data);
    });
  }

  void onDispatcherVerified(Function(dynamic data) callback) {
    _socket?.on('dispatcher:verified', (data) {
      joinBarangayRoom();
      callback(data);
    });
  }

  void onDispatcherRejected(Function(dynamic data) callback) {
    _socket?.on('dispatcher:rejected', (data) {
      callback(data);
    });
  }

  void onDispatcherCorrection(Function(dynamic data) callback) {
    _socket?.on('dispatcher:correction', (data) {
      callback(data);
    });
  }

  void onCoordinationAccessChanged(Function(bool isVerified) callback) {
    _socket?.off('dispatcher:coordination_access_changed');
    _socket?.off('barangay:account_access_changed');
    _socket?.on('barangay:account_access_changed', (data) {
      if (data is Map) {
        final isVerified = data['coordination_verified'] == true;
        callback(isVerified);
        if (isVerified) joinBarangayRoom();
      }
    });
  }

  void joinBarangayRoom() {
    final barangayId = _barangayId;
    if (barangayId != null) _socket?.emit('join:barangay', barangayId);
  }

  void onReportUpdated(Function(dynamic data) callback) {
    _socket?.on('incident:lifecycle', (data) {
      callback(data);
    });
    _socket?.on('barangay:report_updated', (data) {
      callback(data);
    });
    _socket?.on('incident_report:updated', (data) {
      callback(data);
    });
  }


  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _barangayId = null;
    _isConnected = false;
  }
}
