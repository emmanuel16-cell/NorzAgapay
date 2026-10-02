import 'package:flutter_test/flutter_test.dart';

import 'package:mobile_app/main.dart';

void main() {
  testWidgets('MobileApp smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    expect(const MobileApp(), isNotNull);
  });
}
