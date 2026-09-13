import { dispatcherVerificationService } from './services/dispatcherVerificationService';
import fs from 'fs';
import path from 'path';

async function runTest() {
  console.log('=== RUNNING DISPATCHER VERIFICATION E2E SERVICE TEST ===');

  // Test 1: PDF Generation
  console.log('\n[Test 1] Generating Prefilled PDF...');
  const testData = {
    dispatcherName: 'Juan Dela Cruz',
    position: 'Chief Barangay Tanod / Dispatcher',
    barangay: 'Poblacion',
    officialName: 'Hon. Maria Santos',
    officialPosition: 'Punong Barangay',
    verificationRefNo: 'MDRRMO-VREF-20260914-9988',
    date: 'September 14, 2026',
  };

  const pdfBuffer = await dispatcherVerificationService.generateAuthorizationPdf(testData);
  console.log('✓ PDF generated successfully, size:', pdfBuffer.length, 'bytes');
  if (!pdfBuffer.slice(0, 5).toString().startsWith('%PDF-')) {
    throw new Error('Generated file is not a valid PDF');
  }
  console.log('✓ PDF magic header confirmed: %PDF-');

  // Test 2: Verification Record Creation
  console.log('\n[Test 2] Creating Verification Record...');
  const testUserId = 'test-dispatcher-' + Date.now();
  const record = await dispatcherVerificationService.createVerification({
    userId: testUserId,
    dispatcherName: 'Juan Dela Cruz',
    position: 'Barangay Dispatcher',
    barangay: 'Poblacion',
    officialName: 'Hon. Maria Santos',
    officialPosition: 'Punong Barangay',
    contactNumber: '09123456789',
    email: `juan_${Date.now()}@example.com`,
  });

  console.log('✓ Verification record created:');
  console.log('  ID:', record.id);
  console.log('  Status:', record.status);
  console.log('  Reference No:', record.verification_ref_no);
  if (record.status !== 'pending_documents') {
    throw new Error(`Expected pending_documents, got ${record.status}`);
  }

  // Test 3: Document Submission
  console.log('\n[Test 3] Submitting Signed Certification Document...');
  const updatedRecord = await dispatcherVerificationService.submitCertification(
    testUserId,
    '/uploads/certifications/test-juan.pdf'
  );
  console.log('✓ Document submitted, new status:', updatedRecord.status);
  console.log('  Document URL:', updatedRecord.submitted_document_url);
  console.log('  Submitted At:', updatedRecord.submitted_at);
  if (updatedRecord.status !== 'under_review') {
    throw new Error(`Expected under_review, got ${updatedRecord.status}`);
  }

  // Test 4: MDRRMO Pending Queue Query
  console.log('\n[Test 4] Querying MDRRMO Pending Queue...');
  const pendingList = await dispatcherVerificationService.getPendingVerifications();
  const found = pendingList.find(p => p.user_id === testUserId);
  if (!found) {
    throw new Error('Newly submitted verification not found in pending list');
  }
  console.log(`✓ Found applicant in pending queue! (Total pending: ${pendingList.length})`);
  console.log('  Applicant:', found.dispatcher_name, 'Barangay:', found.barangay);

  // Test 5: MDRRMO Rejection with Reason
  console.log('\n[Test 5] Testing MDRRMO Rejection Flow...');
  const rejectedRecord = await dispatcherVerificationService.rejectVerification(
    found.id,
    'Submitted certification could not be verified. Missing official barangay dry seal.',
    'mdrrmo-admin-1'
  );
  console.log('✓ Verification rejected, status:', rejectedRecord.status);
  console.log('  Rejection reason:', rejectedRecord.rejection_reason);
  if (rejectedRecord.status !== 'rejected') {
    throw new Error(`Expected rejected status, got ${rejectedRecord.status}`);
  }

  // Test 6: Dispatcher Resubmission
  console.log('\n[Test 6] Testing Dispatcher Resubmit Documents Flow...');
  const resubmitted = await dispatcherVerificationService.allowResubmission(
    testUserId,
    '/uploads/certifications/test-juan-sealed.pdf'
  );
  console.log('✓ Resubmitted document, status is back to:', resubmitted.status);
  if (resubmitted.status !== 'under_review') {
    throw new Error(`Expected under_review after resubmit, got ${resubmitted.status}`);
  }

  // Test 7: MDRRMO Final Approval
  console.log('\n[Test 7] Testing MDRRMO Approval Flow...');
  const approvedRecord = await dispatcherVerificationService.approveVerification(
    resubmitted.id,
    'mdrrmo-admin-1'
  );
  console.log('✓ Verification approved, status:', approvedRecord.status);
  console.log('  Reviewed by:', approvedRecord.reviewed_by);
  console.log('  Reviewed at:', approvedRecord.reviewed_at);
  if (approvedRecord.status !== 'approved') {
    throw new Error(`Expected approved status, got ${approvedRecord.status}`);
  }

  console.log('\n ALL TESTS PASSED SUCCESSFULLY! FULL DISPATCHER VERIFICATION LIFECYCLE VERIFIED.');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
