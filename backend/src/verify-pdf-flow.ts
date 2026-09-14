import { DispatcherVerificationService } from './services/dispatcherVerificationService';

async function verify() {
  console.log('=== VERIFYING BARANGAY DISPATCHER CERTIFICATION GENERATION ===');

  // Test 1: Generate PDF using registered user data
  console.log('\n[1] Testing generateAuthorizationPDF with prefilled registration data...');
  const pdfBuffer = await DispatcherVerificationService.generateAuthorizationPDF({
    dispatcherName: 'Juan Dela Cruz',
    positionDesignation: 'Barangay Dispatcher',
    barangayName: 'San Lorenzo',
    officialName: '',
    officialPosition: 'Punong Barangay / Authorized Barangay Official',
  });

  console.log('✓ Buffer generated, size:', pdfBuffer.length, 'bytes');

  // Test 2: Verify magic header
  if (!pdfBuffer.slice(0, 5).toString().startsWith('%PDF-')) {
    throw new Error('File does not start with valid PDF magic bytes');
  }
  console.log('✓ Magic bytes verified: %PDF-');

  // Test 3: Inspect raw stream for font declarations and dimensions
  const latin = pdfBuffer.toString('latin1');
  if (!latin.includes('Times-Roman')) {
    throw new Error('Times-Roman font is missing from PDF');
  }
  if (!latin.includes('Times-Bold')) {
    throw new Error('Times-Bold font is missing from PDF');
  }
  console.log('✓ Font verification passed: Times-Roman and Times-Bold embedded');

  // Test 4: Verify A4 media box [0 0 595.28 841.89]
  if (!latin.includes('595.28') || !latin.includes('841.89')) {
    throw new Error('A4 page dimensions (595.28 x 841.89) missing');
  }
  console.log('✓ Page size verification passed: Standard A4 dimensions (595.28 x 841.89)');

  console.log('\n✅ ALL PDF GENERATION AND FORMATTING VERIFICATIONS PASSED SUCCESSFULLY!');
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
