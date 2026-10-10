import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/auth_service.dart';
import '../services/socket_service.dart';

class BarangayAccountRequestScreen extends StatefulWidget {
  const BarangayAccountRequestScreen({super.key});

  @override
  State<BarangayAccountRequestScreen> createState() =>
      _BarangayAccountRequestScreenState();
}

class _BarangayAccountRequestScreenState
    extends State<BarangayAccountRequestScreen> with WidgetsBindingObserver {
  final ImagePicker _picker = ImagePicker();
  final _officialNameController = TextEditingController();
  final _officialPositionController = TextEditingController();
  final _positionDesignationController = TextEditingController();
  XFile? _selectedFile;
  bool _isUploading = false;
  bool _isCheckingStatus = false;
  bool _showReupload = false;
  bool _isDownloadingPdf = false;
  bool _isLoadingRequestDetails = true;
  bool _isSavingRequestDetails = false;
  bool _requestDetailsConfigured = false;
  bool _isEditingRequestDetails = false;
  String? _prefilledPositionDesignation;

  String _positionForDisplay(String? value) {
    final position = value?.trim() ?? '';
    if (position.isEmpty || position.toLowerCase() == 'barangay dispatcher') {
      return 'Not provided';
    }
    return position;
  }

  bool _hasPosition(String? value) {
    final position = value?.trim() ?? '';
    return position.isNotEmpty &&
        position.toLowerCase() != 'not provided' &&
        position.toLowerCase() != 'barangay dispatcher';
  }

  String _positionForDocument(dynamic user) {
    final prefilled = _prefilledPositionDesignation;
    return _positionForDisplay(
      _hasPosition(prefilled) ? prefilled : user?.positionDesignation?.toString(),
    );
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Connect socket and check status on load
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthService>(context, listen: false);
      final socket = Provider.of<SocketService>(context, listen: false);
      if (auth.currentUser != null && auth.token != null) {
        socket.connect(
          auth.currentUser!.barangayId,
          token: auth.token!,
          userId: auth.currentUser!.id,
        );
        socket.onCoordinationAccessChanged(auth.onCoordinationAccessUpdate);
        socket.onDispatcherVerified((data) {
          if (data is! Map || data['userId']?.toString() != auth.currentUser?.id) return;
          auth.onRealtimeVerificationUpdate('verified');
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('🎉 Your account has been approved by MDRRMO! Welcome.'),
                backgroundColor: Color(0xFF10B981),
              ),
            );
            // AuthGate will detect isVerified == true and navigate to HomeScreen.
          }
        });
        socket.onDispatcherRejected((data) {
          if (data is! Map || data['userId']?.toString() != auth.currentUser?.id) return;
          auth.onRealtimeVerificationUpdate(
            data['status']?.toString() ?? 'rejected',
            reason: data['reason']?.toString(),
          );
        });
        socket.onDispatcherCorrection((data) {
          if (data is! Map || data['userId']?.toString() != auth.currentUser?.id) return;
          auth.onRealtimeVerificationUpdate('needs_correction', reason: data['reason']);
        });
      }
      _checkStatus();
      if (auth.currentUser?.isBarangayAdmin == true) {
        _loadCoordinationRequest();
      } else if (mounted) {
        setState(() => _isLoadingRequestDetails = false);
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) _checkStatus();
  }

  Future<void> _handleLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Sign Out', style: TextStyle(fontWeight: FontWeight.bold)),
        content: const Text('Are you sure you want to sign out of your barangay account?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF64748B))),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              elevation: 0,
            ),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;
    Provider.of<SocketService>(context, listen: false).disconnect();
    await Provider.of<AuthService>(context, listen: false).logout();
  }

  Future<void> _loadPrefilledPositionDesignation() async {
    try {
      final auth = Provider.of<AuthService>(context, listen: false);
      final data = await auth.fetchCertificationData();
      if (!mounted) return;
      setState(() {
        _prefilledPositionDesignation = data['position_designation']?.toString();
      });
    } catch (error) {
      debugPrint('Could not load dispatcher position for the document: $error');
    }
  }

  Future<void> _loadCoordinationRequest() async {
    try {
      final auth = Provider.of<AuthService>(context, listen: false);
      _positionDesignationController.text = auth.currentUser?.positionDesignation ?? '';
      final data = await auth.loadCoordinationRequest();
      final verification = data['verification'];
      if (!mounted) return;
      setState(() {
        _requestDetailsConfigured = data['configured'] == true;
        if (verification is Map) {
          _officialNameController.text = verification['punong_barangay_name']?.toString() ?? '';
          _officialPositionController.text = verification['punong_barangay_position']?.toString() ?? '';
          _positionDesignationController.text = verification['position_designation']?.toString() ?? _positionDesignationController.text;
          _prefilledPositionDesignation = verification['position_designation']?.toString();
        }
        _isLoadingRequestDetails = false;
      });
      if (data['configured'] == true) {
        _loadPrefilledPositionDesignation();
      }
    } catch (error) {
      if (mounted) setState(() => _isLoadingRequestDetails = false);
      debugPrint('Could not load Barangay Account Request details: $error');
    }
  }

  Future<void> _saveCoordinationRequestDetails() async {
    final officialName = _officialNameController.text.trim();
    final officialPosition = _officialPositionController.text.trim();
    final positionDesignation = _positionDesignationController.text.trim();
    if (officialName.length < 2 || officialPosition.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter the authorizing official’s name and position.')));
      return;
    }
    setState(() => _isSavingRequestDetails = true);
    try {
      final auth = Provider.of<AuthService>(context, listen: false);
      await auth.saveCoordinationRequest(
        officialName: officialName,
        officialPosition: officialPosition,
        positionDesignation: positionDesignation,
      );
      if (mounted) {
        setState(() {
          _requestDetailsConfigured = true;
          _isEditingRequestDetails = false;
          _showReupload = false;
          _selectedFile = null;
        });
        _loadPrefilledPositionDesignation();
      }
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save the Barangay Account Request: $error')));
    } finally {
      if (mounted) setState(() => _isSavingRequestDetails = false);
    }
  }

  Future<void> _checkStatus() async {
    if (!mounted) return;
    setState(() => _isCheckingStatus = true);
    final auth = Provider.of<AuthService>(context, listen: false);
    await auth.checkVerificationStatus();
    if (mounted) {
      setState(() => _isCheckingStatus = false);
      // AuthGate will detect isVerified == true and navigate to HomeScreen automatically.
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final XFile? file = await _picker.pickImage(
        source: source,
        imageQuality: 85,
      );
      if (file != null) {
        setState(() => _selectedFile = file);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to select file: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _submitDocument() async {
    if (_selectedFile == null) return;
    setState(() => _isUploading = true);

    final auth = Provider.of<AuthService>(context, listen: false);

    try {
      final success = await auth.submitCertificationFile(
        filePath: _selectedFile!.path,
        fileName: _selectedFile!.name,
      );

      if (success && mounted) {
        setState(() => _selectedFile = null);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Barangay Account Request submitted to MDRRMO!'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Submission failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  Future<void> _downloadCertification() async {
    setState(() => _isDownloadingPdf = true);
    final auth = Provider.of<AuthService>(context, listen: false);

    try {
      final file = await auth.downloadAuthorizationPdf();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Certification PDF downloaded!\nSaved to: ${file.path}',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
            backgroundColor: const Color(0xFF10B981),
            duration: const Duration(seconds: 8),
            action: SnackBarAction(
              label: 'OPEN',
              textColor: Colors.white,
              onPressed: () async {
                try {
                  await auth.openPdfFile(file.path);
                } catch (openErr) {
                  // Fallback: open via browser
                  try {
                    await launchUrl(
                      Uri.parse(auth.getAuthorizationPdfUrl(download: false)),
                      mode: LaunchMode.externalApplication,
                    );
                  } catch (_) {}
                }
              },
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        // Show the actual error from the server
        final errMsg = e.toString().replaceAll('Exception: ', '');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.white, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text('Download failed: $errMsg')),
              ],
            ),
            backgroundColor: Colors.red.shade700,
            duration: const Duration(seconds: 8),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isDownloadingPdf = false);
    }
  }

  Future<void> _viewCertification() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;

    // Show loading while retrieving certification data
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(
        child: CircularProgressIndicator(color: Color(0xFF0087C7)),
      ),
    );

    final certData = await auth.fetchCertificationData();
    if (mounted) Navigator.of(context).pop(); // Dismiss loading

    if (!mounted) return;

    setState(() {
      _prefilledPositionDesignation = certData['position_designation']?.toString();
    });

    final title = certData['title'] ?? 'BARANGAY ACCOUNT REQUEST';
    final dateStr = certData['date'] ?? DateFormat('MMMM d, yyyy').format(DateTime.now());
    final fullName = certData['full_name'] ?? user?.fullName ?? 'Barangay Administrator';
    final serverPosition = certData['position_designation']?.toString();
    final position = _positionForDisplay(
      _hasPosition(serverPosition) ? serverPosition : user?.positionDesignation,
    );
    final barangay = certData['barangay'] ?? user?.barangayName ?? 'Barangay';
    final officialName = certData['official_name'] ?? user?.punongBarangayName ?? '[NAME OF PUNONG BARANGAY / AUTHORIZED OFFICIAL]';
    final officialPosition = certData['official_position'] ?? user?.punongBarangayPosition ?? 'Authorized Barangay Official';
    final List<dynamic> paragraphs = certData['paragraphs'] ?? [
      position == 'Not provided'
          ? 'This is to certify that $fullName is the barangay administrator and an authorized representative of Barangay $barangay, Municipality of Norzagaray, Bulacan, submitting a Barangay Account Request to the Norz-Agapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay $barangay.'
          : 'This is to certify that $fullName, serving as $position at Barangay $barangay, is the barangay administrator submitting a Barangay Account Request to the Norz-Agapay Emergency Response and Crisis Management Coordination Application. The request seeks MDRRMO verification and activation of access for authorized accounts belonging to Barangay $barangay.',
      'The barangay administrator is responsible for managing authorized team accounts and ensuring they are used only for official emergency preparedness, incident reporting, and response coordination.',
      'All accounts belonging to the barangay will remain restricted until the MDRRMO verifies and activates this request. MDRRMO may deactivate barangay access at any time; the administrator may then submit a request to restore access.',
    ];

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFFF3F5F9),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return DraggableScrollableSheet(
          initialChildSize: 0.9,
          maxChildSize: 0.95,
          minChildSize: 0.5,
          expand: false,
          builder: (_, scrollController) {
            return Column(
              children: [
                // Modal Top Bar
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.description, color: Color(0xFF0087C7), size: 22),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Barangay Account Request Preview',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF111827),
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Color(0xFF64748B)),
                        onPressed: () => Navigator.of(sheetContext).pop(),
                      ),
                    ],
                  ),
                ),

                // Scrollable Document View
                Expanded(
                  child: SingleChildScrollView(
                    controller: scrollController,
                    padding: const EdgeInsets.all(16),
                    child: Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 600),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(4),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.4),
                              blurRadius: 16,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 40),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const SizedBox(height: 10),
                            // Centered Bold Title
                            Text(
                              title,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontFamily: 'serif',
                                fontSize: 13,
                                fontWeight: FontWeight.bold,
                                color: Colors.black,
                                letterSpacing: 0.8,
                              ),
                            ),
                            const SizedBox(height: 32),

                            // Date: [automatically generated current date] - aligned left bold
                            Text(
                              'Date: $dateStr',
                              style: const TextStyle(
                                fontFamily: 'serif',
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: Colors.black,
                              ),
                            ),
                            const SizedBox(height: 20),

                            // 3 Paragraphs: Times New Roman 12pt, justified
                            ...paragraphs.map(
                              (p) => Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: Text(
                                  p.toString(),
                                  textAlign: TextAlign.justify,
                                  style: const TextStyle(
                                    fontFamily: 'serif',
                                    fontSize: 12,
                                    height: 1.5,
                                    color: Colors.black,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 24),

                            // CERTIFIED AND AUTHORIZED BY: - aligned left bold
                            const Text(
                              'CERTIFIED AND AUTHORIZED BY:',
                              style: TextStyle(
                                fontFamily: 'serif',
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: Colors.black,
                              ),
                            ),
                            const SizedBox(height: 48),

                            // Official signature line & centered name/position
                            Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  officialName,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontFamily: 'serif',
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.black,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                const Text(
                                  '_______________________________________',
                                  style: TextStyle(
                                    fontFamily: 'serif',
                                    fontSize: 12,
                                    color: Colors.black,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  officialPosition,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontFamily: 'serif',
                                    fontSize: 11,
                                    color: Colors.black87,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 48),

                            Text(
                              'Reference No: ${certData['reference_no'] ?? user?.verificationRefNo ?? ''}',
                              style: TextStyle(
                                fontFamily: 'serif',
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: Colors.black,
                              ),
                            ),
                            const SizedBox(height: 16),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),

                // Modal Bottom Action Bar
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    border: Border(top: BorderSide(color: Color(0xFFDCE4EF))),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => Navigator.of(sheetContext).pop(),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFF475569),
                            side: const BorderSide(color: Color(0xFF475569)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          child: const Text('CLOSE'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.of(sheetContext).pop();
                            _downloadCertification();
                          },
                          icon: const Icon(Icons.download, size: 18),
                          label: const Text(
                            'DOWNLOAD PDF',
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF10B981),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _resubmit() async {
    final auth = Provider.of<AuthService>(context, listen: false);
    try {
      await auth.resubmitCertification();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('You can now upload the corrected Barangay Account Request.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  String _formatDate(String? iso) {
    if (iso == null || iso.isEmpty) {
      return DateFormat('MMMM d, yyyy').format(DateTime.now());
    }
    try {
      final dt = DateTime.parse(iso);
      return DateFormat('MMMM d, yyyy').format(dt);
    } catch (_) {
      return iso;
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);
    final user = auth.currentUser;

    final refNo = user?.verificationRefNo ?? 'MDRRMO-VREF-PENDING';
    final status = user?.verificationStatus ?? 'pending_document';
    final submittedDate = _formatDate(user?.submittedAt);

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5F9),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF0C243B), Color(0xFF133E68), Color(0xFF0F5B78)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
        title: const Text(
          'Barangay Account Request',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout_outlined, color: Colors.white),
            tooltip: 'Sign Out',
            onPressed: _handleLogout,
          ),
          IconButton(
            icon: _isCheckingStatus
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFBDE8FF)),
                  )
                : const Icon(Icons.refresh, color: Colors.white),
            tooltip: 'Check Status',
            onPressed: _isCheckingStatus ? null : _checkStatus,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 580),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_isLoadingRequestDetails)
                  const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
                else if (!_requestDetailsConfigured && user?.isBarangayAdmin == true)
                  _buildCoordinationRequestForm()
                else if (!_requestDetailsConfigured)
                  _buildAdminRequiredCard()
                else ...[
                // Top Status Card
                _buildStatusHeader(status, user),
                const SizedBox(height: 18),

                if (_isEditingRequestDetails)
                  _buildCoordinationRequestForm(isEditing: true)
                else
                  _buildAuthorizationDetailsCard(user),
                const SizedBox(height: 18),

                // Reference Number Banner
                _buildReferenceBanner(refNo),
                const SizedBox(height: 20),

                if (status == 'activation_pending') ...[
                  _buildActivationPendingCard(submittedDate),
                  const SizedBox(height: 20),
                ] else if (status == 'verified' && user?.coordinationVerified != true && user?.isBarangayAdmin == true) ...[
                  _buildRequestActivationCard(),
                  const SizedBox(height: 20),
                ],

                // Rejected / Needs Correction Banner
                if (user?.isRejected == true || user?.isNeedsCorrection == true) ...[
                  _buildRejectionBanner(user),
                  const SizedBox(height: 20),
                ],

                // Under Review Banner (Requirement 3)
                if (user?.isUnderReview == true) ...[
                  _buildUnderReviewCard(submittedDate, user?.documentUrl),
                  const SizedBox(height: 20),
                ],

                if (status != 'activation_pending' && !(status == 'verified' && user?.coordinationVerified != true)) ...[
                  // Step 1: Download & Print Prefilled Barangay Account Request
                  _buildStepOneCard(user, refNo),
                  const SizedBox(height: 20),

                  // Step 2: Submit Signed & Sealed Request
                  _buildStepTwoCard(user),
                  const SizedBox(height: 20),
                ],

                // Verification History & Audit Log
                _buildVerificationHistoryCard(user),
                const SizedBox(height: 20),

                // Refresh Status Button
                OutlinedButton.icon(
                  onPressed: _isCheckingStatus ? null : _checkStatus,
                  icon: const Icon(Icons.sync, color: Color(0xFF0087C7)),
                  label: Text(
                    _isCheckingStatus ? 'Refreshing request status...' : 'Refresh Barangay Account Request Status',
                    style: const TextStyle(color: Color(0xFF0087C7), fontWeight: FontWeight.bold),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF0087C7)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 12),

                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _requestActivation() async {
    setState(() => _isSavingRequestDetails = true);
    try {
      final auth = Provider.of<AuthService>(context, listen: false);
      await auth.requestBarangayActivation();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Activation request sent to MDRRMO.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not request activation: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSavingRequestDetails = false);
    }
  }

  Widget _buildRequestActivationCard() {
    final rejectionReason = Provider.of<AuthService>(context, listen: false)
        .currentUser?.rejectionReason?.trim();
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF59E0B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Barangay access deactivated', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF92400E))),
          const SizedBox(height: 8),
          const Text('MDRRMO deactivated access for all accounts in this barangay. Request activation to restore access. MDRRMO must approve the request.', style: TextStyle(color: Color(0xFF78350F), height: 1.4)),
          if (rejectionReason != null && rejectionReason.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('Previous activation request: $rejectionReason', style: const TextStyle(color: Color(0xFF78350F), height: 1.4)),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _isSavingRequestDetails ? null : _requestActivation,
              icon: _isSavingRequestDetails ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.lock_open_rounded),
              label: Text(_isSavingRequestDetails ? 'Sending request…' : 'Request Activation'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActivationPendingCard(String submittedDate) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF0284C7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Activation request under review', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF111827))),
          const SizedBox(height: 8),
          const Text('The administrator asked MDRRMO to restore access for the barangay. All accounts remain restricted until the request is approved.', style: TextStyle(color: Color(0xFF475569), height: 1.4)),
          const SizedBox(height: 10),
          Text('Requested: $submittedDate', style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildAdminRequiredCard() {
    final user = Provider.of<AuthService>(context, listen: false).currentUser;
    final isAdmin = user?.isBarangayAdmin == true;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFDCE4EF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isAdmin ? 'Barangay Account Request required' : 'Barangay access is inactive',
            style: TextStyle(color: Color(0xFF111827), fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          Text(
            isAdmin
                ? 'Complete the Barangay Account Request below. All barangay accounts stay restricted until MDRRMO approves and activates it.'
                : 'All barangay functions are unavailable until the Barangay Account Request is approved and active. Please contact your barangay administrator.',
            style: TextStyle(color: Color(0xFF475569), height: 1.45),
          ),
        ],
      ),
    );
  }

  Widget _buildCoordinationRequestForm({bool isEditing = false}) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFDCE4EF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            isEditing ? 'Edit authorizing official' : 'Start Barangay Account Request',
            style: const TextStyle(color: Color(0xFF111827), fontSize: 19, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 10),
          Text(
            isEditing
                ? 'Update your position/designation or the official who will sign. Changing these details invalidates the current signed request, so print, sign, seal, and submit an updated copy.'
                : 'Enter your position/designation and the official who will sign the request. Print the prefilled document, obtain the official signature and dry seal, then upload it for MDRRMO review.',
            style: TextStyle(color: Color(0xFF475569), height: 1.45),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: _positionDesignationController,
            textCapitalization: TextCapitalization.words,
            style: const TextStyle(color: Color(0xFF111827)),
            decoration: const InputDecoration(labelText: 'Your position / designation', hintText: 'For example, Barangay Administrator', filled: true, fillColor: Color(0xFFF8FAFC)),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _officialNameController,
            textCapitalization: TextCapitalization.words,
            style: const TextStyle(color: Color(0xFF111827)),
            decoration: const InputDecoration(labelText: 'Authorized official name', filled: true, fillColor: Color(0xFFF8FAFC)),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _officialPositionController,
            textCapitalization: TextCapitalization.words,
            style: const TextStyle(color: Color(0xFF111827)),
            decoration: const InputDecoration(labelText: 'Official position', filled: true, fillColor: Color(0xFFF8FAFC)),
          ),
          const SizedBox(height: 18),
          SizedBox(
            height: 48,
            child: FilledButton.icon(
              onPressed: _isSavingRequestDetails ? null : _saveCoordinationRequestDetails,
              icon: _isSavingRequestDetails
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Icon(isEditing ? Icons.save_outlined : Icons.arrow_forward_rounded),
              label: Text(_isSavingRequestDetails
                  ? 'Saving request…'
                  : (isEditing ? 'Save official details' : 'Continue to request')),
            ),
          ),
          if (isEditing) ...[
            const SizedBox(height: 6),
            TextButton(
              onPressed: _isSavingRequestDetails
                  ? null
                  : () => setState(() => _isEditingRequestDetails = false),
              child: const Text('Cancel'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildAuthorizationDetailsCard(dynamic user) {
    final officialName = user?.punongBarangayName?.toString().trim() ?? '';
    final officialPosition = user?.punongBarangayPosition?.toString().trim() ?? '';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFDCE4EF)),
      ),
      child: Row(
        children: [
          const CircleAvatar(
            radius: 20,
            backgroundColor: Color(0xFFEAF6FC),
            child: Icon(Icons.draw_outlined, color: Color(0xFF0087C7), size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Authorizing official', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                const SizedBox(height: 3),
                Text(
                  officialName.isNotEmpty ? officialName : 'Not provided',
                  style: const TextStyle(color: Color(0xFF111827), fontSize: 14, fontWeight: FontWeight.w700),
                ),
                Text(
                  officialPosition.isNotEmpty ? officialPosition : 'Position not provided',
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                ),
              ],
            ),
          ),
          TextButton.icon(
            onPressed: _isSavingRequestDetails
                ? null
                : () => setState(() => _isEditingRequestDetails = true),
            icon: const Icon(Icons.edit_outlined, size: 16),
            label: const Text('Edit'),
            style: TextButton.styleFrom(foregroundColor: const Color(0xFF0087C7)),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _officialNameController.dispose();
    _officialPositionController.dispose();
    _positionDesignationController.dispose();
    super.dispose();
  }

  // Header status banner
  Widget _buildStatusHeader(String status, dynamic user) {
    Color badgeColor = const Color(0xFFF59E0B);
    String label = 'Pending';
    IconData icon = Icons.pending_actions;

    if (status == 'verified') {
      if (user?.coordinationVerified == true) {
        badgeColor = const Color(0xFF10B981);
        label = 'Active';
        icon = Icons.check_circle;
      } else {
        badgeColor = const Color(0xFFF59E0B);
        label = 'Deactivated';
        icon = Icons.pause_circle;
      }
    } else if (status == 'activation_pending') {
      badgeColor = const Color(0xFF0087C7);
      label = 'Activation';
      icon = Icons.hourglass_top;
    } else if (status == 'under_review') {
      badgeColor = const Color(0xFF0087C7);
      label = 'Review';
      icon = Icons.hourglass_top;
    } else if (status == 'rejected') {
      badgeColor = const Color(0xFFEF4444);
      label = 'Rejected';
      icon = Icons.cancel;
    } else if (status == 'needs_correction') {
      badgeColor = const Color(0xFFA855F7);
      label = 'Correction';
      icon = Icons.edit_note;
    }

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: badgeColor.withValues(alpha:0.5), width: 1.5),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundColor: badgeColor.withValues(alpha:0.2),
            child: Icon(icon, color: badgeColor, size: 26),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  user?.fullName ?? 'Barangay Administrator',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF111827),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${_positionForDocument(user)} • ${user?.barangayName ?? 'Barangay'}',
                  style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: badgeColor.withValues(alpha:0.2),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: badgeColor),
            ),
            child: Text(
              label,
              style: TextStyle(
                color: badgeColor,
                fontWeight: FontWeight.bold,
                fontSize: 11,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // Reference number banner
  Widget _buildReferenceBanner(String refNo) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFBFDBFE)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Reference No:',
                style: TextStyle(color: Color(0xFF64748B), fontSize: 11, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 2),
              Text(
                refNo,
                style: const TextStyle(
                  color: Color(0xFF0087C7),
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.copy, size: 18, color: Color(0xFF64748B)),
            tooltip: 'Copy Reference No.',
            onPressed: () {
              Clipboard.setData(ClipboardData(text: refNo));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Reference No. copied to clipboard')),
              );
            },
          ),
        ],
      ),
    );
  }

  // Rejection banner with Resubmit button (Requirement 6)
  Widget _buildRejectionBanner(dynamic user) {
    final isCorrection = user?.isNeedsCorrection == true;
    final color = isCorrection ? const Color(0xFFA855F7) : const Color(0xFFEF4444);
    final reason = user?.rejectionReason ?? 'The submitted Barangay Account Request could not be verified.';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isCorrection ? const Color(0xFFFAF5FF) : const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(isCorrection ? Icons.edit_note : Icons.error_outline, color: color, size: 22),
              const SizedBox(width: 8),
              Text(
                isCorrection ? 'Correction Requested' : 'Verification Rejected',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${isCorrection ? 'Correction requested' : 'Reason'}: $reason',
            style: TextStyle(fontSize: 13, color: isCorrection ? const Color(0xFF6B21A8) : const Color(0xFF991B1B), height: 1.4),
          ),
          const SizedBox(height: 14),
          ElevatedButton.icon(
            onPressed: _resubmit,
            icon: const Icon(Icons.refresh, size: 18),
            label: Text(isCorrection ? 'Submit Corrected Documents' : 'Resubmit Documents', style: const TextStyle(fontWeight: FontWeight.bold)),
            style: ElevatedButton.styleFrom(
              backgroundColor: color,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
        ],
      ),
    );
  }

  // Under Review card (Requirement 3)
  Widget _buildUnderReviewCard(String submittedDate, String? docUrl) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF0284C7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.mark_email_read, color: Color(0xFF0087C7), size: 24),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Barangay Account Request Submitted',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF111827)),
                    ),
                    Text(
                      'Awaiting MDRRMO verification',
                      style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFFBFDBFE), height: 28),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Submitted:', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                  const SizedBox(height: 2),
                  Text(submittedDate, style: const TextStyle(color: Color(0xFF111827), fontSize: 13, fontWeight: FontWeight.bold)),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Status:', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                  const SizedBox(height: 2),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF59E0B).withValues(alpha:0.2),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFF59E0B)),
                    ),
                    child: const Text('Under Review', style: TextStyle(color: Color(0xFFF59E0B), fontSize: 11, fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Text(
            'Your Barangay Account Request has been sent to the MDRRMO Command Center. Once approved, access will be activated for all barangay accounts.',
            style: TextStyle(color: Color(0xFF64748B), fontSize: 12, height: 1.4),
          ),
        ],
      ),
    );
  }

  // Step 1: Download & Print Prefilled PDF Certificate
  Widget _buildStepOneCard(dynamic user, String refNo) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFDCE4EF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF0284C7).withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'STEP 1',
                  style: TextStyle(color: Color(0xFF0087C7), fontWeight: FontWeight.bold, fontSize: 11),
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Barangay Account Request',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF111827)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'View or download the prefilled Barangay Account Request. Print it and obtain the signature and official dry seal of the authorized barangay official.',
            style: TextStyle(fontSize: 13, color: Color(0xFF64748B), height: 1.4),
          ),
          const SizedBox(height: 16),

          // View and Download Certification Action Buttons
          Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: _viewCertification,
                      icon: const Icon(Icons.visibility, color: Colors.white, size: 18),
                      label: const Text(
                        'VIEW REQUEST',
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, letterSpacing: 0.5),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0284C7),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.link, color: Color(0xFF0087C7)),
                    tooltip: 'Copy PDF Download URL',
                    onPressed: () {
                      final auth = Provider.of<AuthService>(context, listen: false);
                      Clipboard.setData(ClipboardData(text: auth.getAuthorizationPdfUrl(download: true)));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('PDF Download URL copied to clipboard')),
                      );
                    },
                  ),
                ],
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isDownloadingPdf ? null : _downloadCertification,
                  icon: _isDownloadingPdf
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.download, color: Colors.white, size: 18),
                  label: Text(
                    _isDownloadingPdf ? 'DOWNLOADING REQUEST...' : 'DOWNLOAD REQUEST PDF',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, letterSpacing: 0.5),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF10B981),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),
          // Collapsible preview of prefilled data
          Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text(
                'View Prefilled Document Information',
                style: TextStyle(color: Color(0xFF0087C7), fontSize: 12, fontWeight: FontWeight.w600),
              ),
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFFDCE4EF)),
                  ),
                  child: Column(
                    children: [
                      _infoRow('Document Title', 'BARANGAY ACCOUNT REQUEST'),
                      _infoRow('Date', DateFormat('MMMM d, yyyy').format(DateTime.now())),
                      _infoRow('Barangay Administrator', user?.fullName ?? '-'),
                      _infoRow('Position/Designation', _positionForDocument(user)),
                      _infoRow('Barangay', user?.barangayName ?? 'Barangay'),
                      _infoRow('Authorized Official', user?.punongBarangayName ?? 'Punong Barangay'),
                      _infoRow('Official Position', user?.punongBarangayPosition ?? 'Punong Barangay'),
                      _infoRow('Reference No:', refNo),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Step 2: Upload Document Card
  Widget _buildStepTwoCard(dynamic user) {
    if (user?.verificationStatus == 'verified') {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.5)),
        ),
        child: const Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.check_circle, color: Color(0xFF10B981), size: 22),
            SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Barangay Account Request approved',
                    style: TextStyle(color: Color(0xFF111827), fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'MDRRMO has activated access for the barangay. Edit the authorized official above if the request details change.',
                    style: TextStyle(color: Color(0xFF64748B), fontSize: 12, height: 1.4),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    final isUnderReview = user?.isUnderReview == true;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFDCE4EF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'STEP 2',
                  style: TextStyle(color: Color(0xFF059669), fontWeight: FontWeight.bold, fontSize: 11),
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Submit Signed & Sealed Request',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF111827)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'Upload a clear photo or scanned copy of the signed request showing the official signature and dry seal.',
            style: TextStyle(fontSize: 13, color: Color(0xFF64748B), height: 1.4),
          ),
          const SizedBox(height: 16),

          // If already under review, provide option to view current or submit replacement
          if (isUnderReview && !_showReupload) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FC),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF0284C7).withValues(alpha: 0.5)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, color: Color(0xFF0087C7), size: 20),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'The Barangay Account Request has been submitted and is being reviewed by MDRRMO.',
                      style: TextStyle(color: Color(0xFF475569), fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: () => setState(() => _showReupload = true),
              icon: const Icon(Icons.cloud_upload_outlined, size: 18),
              label: const Text('Submit Replacement / Updated Certificate'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF0087C7),
                side: const BorderSide(color: Color(0xFF0087C7)),
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ] else ...[
            if (isUnderReview && _showReupload) ...[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Submitting Updated Certificate:',
                    style: TextStyle(color: Color(0xFF0087C7), fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                  TextButton(
                    onPressed: () => setState(() {
                      _showReupload = false;
                      _selectedFile = null;
                    }),
                    child: const Text('Cancel', style: TextStyle(color: Color(0xFF64748B), fontSize: 12)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
            ],

            // File selection options
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickImage(ImageSource.camera),
                    icon: const Icon(Icons.camera_alt, size: 18),
                    label: const Text('Take Photo'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF1B4F72),
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickImage(ImageSource.gallery),
                    icon: const Icon(Icons.photo_library, size: 18),
                    label: const Text('Choose File'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF1B4F72),
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
              ],
            ),

            // Selected file preview
            if (_selectedFile != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFF10B981)),
                ),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: Image.file(
                        File(_selectedFile!.path),
                        width: 50,
                        height: 50,
                        fit: BoxFit.cover,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _selectedFile!.name,
                            style: const TextStyle(color: Color(0xFF111827), fontWeight: FontWeight.bold, fontSize: 13),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          const Text(
                            'Ready to submit',
                            style: TextStyle(color: Color(0xFF059669), fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Color(0xFFEF4444), size: 20),
                      onPressed: () => setState(() => _selectedFile = null),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton.icon(
                  onPressed: _isUploading ? null : _submitDocument,
                  icon: _isUploading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.cloud_upload),
                  label: Text(
                    _isUploading ? 'Submitting Request...' : 'Submit Barangay Account Request',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF10B981),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  // Verification History & Audit Log Card
  Widget _buildVerificationHistoryCard(dynamic user) {
    final List<dynamic> history = user?.verificationHistory ?? [];

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFDCE4EF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: const Color(0xFF0087C7).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.history, color: Color(0xFF0087C7), size: 18),
              ),
              const SizedBox(width: 10),
          const Text(
                'Verification History & Audit Log',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF111827)),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (history.isEmpty)
            _buildHistoryItem(
              action: 'Barangay Account Request Started',
              timestamp: _formatDateTime(user?.submittedAt),
              actor: user?.fullName ?? 'Barangay Administrator',
              note: 'The barangay administrator started a Barangay Account Request. MDRRMO verification is pending.',
              isLast: true,
              color: const Color(0xFF0087C7),
              icon: Icons.how_to_reg,
            )
          else
            ...List.generate(history.length, (index) {
              // Show in reverse chronological order (newest first)
              final item = history[history.length - 1 - index];
              final action = item['action'] as String? ?? 'Status Update';
              final rawNote = item['note'] as String?;
              final isLegacyRegistration = action == 'Account Registered' && rawNote ==
                  'Dispatcher account created. Pending authorization certification.';
              final historyAction = isLegacyRegistration ? 'Barangay Account Request Started' : action;
              final historyNote = isLegacyRegistration
                  ? 'The barangay administrator started a Barangay Account Request. MDRRMO verification is pending.'
                  : rawNote;
              final timestamp = _formatDateTime(item['timestamp'] as String?);
              final actor = item['actor'] as String?;
              final note = historyNote;
              final isLast = index == history.length - 1;

              Color itemColor = const Color(0xFF0087C7);
              IconData itemIcon = Icons.info_outline;

              if (historyAction.contains('Approved') || historyAction.contains('Verified') || historyAction.contains('Activated')) {
                itemColor = const Color(0xFF10B981);
                itemIcon = Icons.check_circle;
              } else if (historyAction.contains('Rejected')) {
                itemColor = const Color(0xFFEF4444);
                itemIcon = Icons.cancel;
              } else if (historyAction.contains('Correction')) {
                itemColor = const Color(0xFFA855F7);
                itemIcon = Icons.edit_note;
              } else if (historyAction.contains('Submitted') || historyAction.contains('Uploaded')) {
                itemColor = const Color(0xFF0087C7);
                itemIcon = Icons.cloud_done;
              } else if (historyAction.contains('Request') || historyAction.contains('Registered') || historyAction.contains('Created')) {
                itemColor = const Color(0xFF64748B);
                itemIcon = Icons.how_to_reg;
              }

              return _buildHistoryItem(
                action: historyAction,
                timestamp: timestamp,
                actor: actor,
                note: note,
                isLast: isLast,
                color: itemColor,
                icon: itemIcon,
              );
            }),
        ],
      ),
    );
  }

  Widget _buildHistoryItem({
    required String action,
    required String timestamp,
    String? actor,
    String? note,
    required bool isLast,
    required Color color,
    required IconData icon,
  }) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Timeline indicator column
          Column(
            children: [
              Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                  border: Border.all(color: color, width: 1.5),
                ),
                child: Icon(icon, size: 14, color: color),
              ),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 2,
                    color: const Color(0xFFDCE4EF),
                    margin: const EdgeInsets.symmetric(vertical: 4),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 12),
          // Content column
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 4 : 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        action,
                        style: const TextStyle(color: Color(0xFF111827), fontSize: 13, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        timestamp,
                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                      ),
                    ],
                  ),
                  if (actor != null && actor.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      'By: $actor',
                      style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                    ),
                  ],
                  if (note != null && note.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(6),
                        border: Border(left: BorderSide(color: color, width: 2.5)),
                      ),
                      child: Text(
                        note,
                        style: const TextStyle(color: Color(0xFF475569), fontSize: 12, height: 1.3),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatDateTime(String? iso) {
    if (iso == null || iso.isEmpty) {
      return DateFormat('MMMM d, yyyy • h:mm a').format(DateTime.now());
    }
    try {
      final dt = DateTime.parse(iso).toLocal();
      return DateFormat('MMMM d, yyyy • h:mm a').format(dt);
    } catch (_) {
      return iso;
    }
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(color: Color(0xFF111827), fontSize: 11, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}
