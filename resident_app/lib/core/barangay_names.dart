const norzagarayBarangayNames = <String>[
  'Bangkal',
  'Baraka',
  'Bigte',
  'Bitungol',
  'FVR',
  'Matictic',
  'Minuyan',
  'Partida',
  'Pinagtulayan',
  'Poblacion',
  'San Lorenzo',
  'San Mateo',
  'Tigbe',
];

String barangayDisplayLabel(dynamic value) {
  final name = (value?.toString() ?? '')
      .trim()
      .replaceAll(RegExp(r'\s+'), ' ');
  if (name.isEmpty) return '';

  final unprefixedName = name
      .replaceFirst(
        RegExp(r'^(barangay|bdrrmc)\s+', caseSensitive: false),
        '',
      )
      .trim();
  final isPoblacion = unprefixedName.toLowerCase() == 'poblacion' ||
      RegExp(
        r'^norzagaray\s*\(\s*poblacion\s*\)$',
        caseSensitive: false,
      ).hasMatch(unprefixedName);

  return isPoblacion ? 'Poblacion' : 'Barangay $unprefixedName';
}
