import {
  DispatcherVerificationService,
  generateReferenceNo,
} from './services/dispatcherVerificationService';

async function runTest() {
  console.log('=== RUNNING DISPATCHER VERIFICATION E2E SERVICE TEST ===');

  // Test 1: PDF Generation
  console.log('\n[Test 1] Generating Prefilled PDF...');
  const pdfBuffer = await DispatcherVerificationService.generateAuthorizationPDF({
    dispatcherName: 'Juan Dela Cruz',
    positionDesignation: 'Chief Barangay Tanod / Dispatcher',
    barangayName: 'Poblacion',
    officialName: 'Hon. Maria Santos',
    officialPosition: 'Punong Barangay',
    referenceNo: 'MDRRMO-VREF-20260914-9988',
    dateStr: 'September 14, 2026',
  });
  console.log('✓ PDF generated successfully, size:', pdfBuffer.length, 'bytes');
  if (!pdfBuffer.slice(0, 5).toString().startsWith('%PDF-')) {
    throw new Error('Generated file is not a valid PDF');
  }
  console.log('✓ PDF magic header confirmed: %PDF-');

  // Test 2: Reference Number Generation
  console.log('\n[Test 2] Generating Reference Number...');
  const refNo = generateReferenceNo();
  console.log('✓ Reference No:', refNo);
  if (!refNo.startsWith('MDRRMO-VREF-')) {
    throw new Error('Invalid reference number format: ' + refNo);
  }

  // Test 3: Verification Record Creation (local fallback)
  console.log('\n[Test 3] Creating Verification Record (local fallback)...');
  const testUserId = 'test-dispatcher-' + Date.now();
  const record = await DispatcherVerificationService.createVerification({
    userId: testUserId,
    barangayId: 'barangay-poblacion-001',
    barangayName: 'Poblacion',
    fullName: 'Juan Dela Cruz',
    email: `juan_${Date.now()}@example.com`,
    phone: '09123456789',
    positionDesignation: 'Barangay Dispatcher',
    punongBarangayName: 'Hon. Maria Santos',
    punongBarangayPosition: 'Punong Barangay',
  });

  console.log('✓ Verification record created:');
  console.log('  ID:', record.id);
  console.log('  Status:', record.status);
  console.log('  Reference No:', record.reference_no);
  if (record.status !== 'pending_document') {
    throw new Error(`Expected pending_document, got ${record.status}`);
  }

  // Test 4: Document Submission
  console.log('\n[Test 4] Submitting Signed Certification Document...');
  const updatedRecord = await DispatcherVerificationService.submitCertification(
    testUserId,
    '/uploads/certifications/test-juan.pdf'
  );
  console.log('✓ Document submitted, new status:', updatedRecord.status);
  console.log('  Document URL:', updatedRecord.document_url);
  console.log('  Submitted At:', updatedRecord.submitted_at);
  if (updatedRecord.status !== 'under_review') {
    throw new Error(`Expected under_review, got ${updatedRecord.status}`);
  }

  // Test 5: MDRRMO Pending Queue Query
  console.log('\n[Test 5] Querying MDRRMO Pending Queue...');
  const pendingList = await DispatcherVerificationService.getPending();
  const found = pendingList.find((p) => p.user_id === testUserId);
  if (!found) {
    throw new Error('Newly submitted verification not found in pending list');
  }
  console.log(`✓ Found applicant in pending queue! (Total pending: ${pendingList.length})`);
  console.log('  Applicant:', found.full_name, '| Barangay:', found.barangay_name || found.barangay_id);

  // Test 6: MDRRMO Rejection with Reason
  console.log('\n[Test 6] Testing MDRRMO Rejection Flow...');
  const rejectedRecord = await DispatcherVerificationService.reject(
    found.id,
    'mdrrmo-admin-1',
    'Submitted certification could not be verified. Missing official barangay dry seal.'
  );
  console.log('✓ Verification rejected, status:', rejectedRecord.status);
  console.log('  Rejection reason:', rejectedRecord.rejection_reason);
  if (rejectedRecord.status !== 'rejected') {
    throw new Error(`Expected rejected status, got ${rejectedRecord.status}`);
  }

  // Test 7: Dispatcher Resubmission (reset to pending_document)
  console.log('\n[Test 7] Testing Dispatcher Resubmit Documents Flow...');
  const allowedResubmit = await DispatcherVerificationService.allowResubmission(testUserId);
  console.log('✓ Resubmission enabled, status is back to:', allowedResubmit.status);
  if (allowedResubmit.status !== 'pending_document') {
    throw new Error(`Expected pending_document after allowResubmission, got ${allowedResubmit.status}`);
  }

  // Test 8: Submit new document (resubmit flow)
  const resubmitted = await DispatcherVerificationService.submitCertification(
    testUserId,
    '/uploads/certifications/test-juan-sealed.pdf'
  );
  console.log('✓ Resubmitted document, status:', resubmitted.status);
  if (resubmitted.status !== 'under_review') {
    throw new Error(`Expected under_review after resubmit, got ${resubmitted.status}`);
  }

  // Test 9: MDRRMO Final Approval
  console.log('\n[Test 9] Testing MDRRMO Approval Flow...');
  const approvedRecord = await DispatcherVerificationService.approve(
    resubmitted.id,
    'mdrrmo-admin-1',
    'Authorization document verified. Seal and signature confirmed.'
  );
  console.log('✓ Verification approved, status:', approvedRecord.status);
  console.log('  Reviewed by:', approvedRecord.reviewed_by);
  console.log('  Reviewed at:', approvedRecord.reviewed_at);
  if (approvedRecord.status !== 'verified') {
    throw new Error(`Expected verified status, got ${approvedRecord.status}`);
  }

  // Test 10: Verify history timeline
  console.log('\n[Test 10] Verification History Timeline...');
  const history = approvedRecord.verification_history;
  console.log(`✓ History has ${history.length} entries:`);
  history.forEach((h, i) => console.log(`  ${i + 1}. [${h.action}] ${h.timestamp}`));

  console.log('\n✅ ALL TESTS PASSED! FULL DISPATCHER VERIFICATION LIFECYCLE VERIFIED.');
}

runTest().catch((err: Error) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
