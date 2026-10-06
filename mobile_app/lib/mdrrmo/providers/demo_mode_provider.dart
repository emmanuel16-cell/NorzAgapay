import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class DemoModeProvider extends ChangeNotifier {
  static const _preferenceKey = 'show_demo_data';
  bool _showDemoData = false;

  bool get showDemoData => _showDemoData;

  Future<void> load() async {
    final preferences = await SharedPreferences.getInstance();
    _showDemoData = preferences.getBool(_preferenceKey) ?? false;
    notifyListeners();
  }

  Future<void> setShowDemoData(bool enabled) async {
    _showDemoData = enabled;
    notifyListeners();
    final preferences = await SharedPreferences.getInstance();
    await preferences.setBool(_preferenceKey, enabled);
  }
}
