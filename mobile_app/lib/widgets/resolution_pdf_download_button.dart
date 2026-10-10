import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:open_file/open_file.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

class ResolutionPdfDownloadButton extends StatefulWidget {
  final String reportId;
  final Future<Uint8List> Function() loadPdf;

  const ResolutionPdfDownloadButton({
    super.key,
    required this.reportId,
    required this.loadPdf,
  });

  @override
  State<ResolutionPdfDownloadButton> createState() =>
      _ResolutionPdfDownloadButtonState();
}

class _ResolutionPdfDownloadButtonState
    extends State<ResolutionPdfDownloadButton> {
  bool _downloading = false;

  Future<void> _download() async {
    if (_downloading) return;
    setState(() => _downloading = true);
    try {
      final bytes = await widget.loadPdf();
      if (Platform.isAndroid) {
        final permission = await Permission.storage.status;
        if (permission.isDenied) await Permission.storage.request();
      }

      Directory? directory;
      try {
        directory = await getDownloadsDirectory();
      } catch (_) {
        directory = null;
      }
      directory ??= await getApplicationDocumentsDirectory();

      final safeId = widget.reportId.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '');
      final shortId = safeId.length > 8 ? safeId.substring(0, 8) : safeId;
      final file = File('${directory.path}/Norz-Agapay_Incident_$shortId.pdf');
      await file.writeAsBytes(bytes, flush: true);
      if (!mounted) return;

      final result = await OpenFile.open(file.path, type: 'application/pdf');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.type == ResultType.done
                ? 'PDF downloaded and opened.'
                : 'PDF downloaded to ${file.path}. ${result.message}',
          ),
          backgroundColor: result.type == ResultType.done
              ? const Color(0xFF10B981)
              : const Color(0xFF475569),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
    child: SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: _downloading ? null : _download,
        icon: _downloading
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.download_rounded, size: 18),
        label: Text(_downloading ? 'Preparing document…' : 'Download document'),
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFF087FAE),
          side: const BorderSide(color: Color(0xFF38BDF8)),
          padding: const EdgeInsets.symmetric(vertical: 10),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
        ),
      ),
    ),
  );
}
