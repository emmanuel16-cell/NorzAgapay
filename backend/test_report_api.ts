import fs from 'fs';
import path from 'path';

async function testReporting() {
  const API_URL = 'http://localhost:3001/api/incident-reports';
  
  console.log('🚀 Starting Incident Reporting API Test...');

  // Create a dummy file for testing
  const dummyFilePath = path.join(process.cwd(), 'test_image.jpg');
  fs.writeFileSync(dummyFilePath, 'dummy image content');

  const formData = new FormData();
  formData.append('type', 'emergency');
  formData.append('title', 'Natural Disasters');
  formData.append('specifics', 'Flood Incident');
  formData.append('description', 'Test incident report from automated script');
  formData.append('latitude', '14.8832');
  formData.append('longitude', '121.0153');
  formData.append('reporter_type', 'resident');
  
  // Attach the dummy file
  const fileBuffer = fs.readFileSync(dummyFilePath);
  const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
  formData.append('proof', blob, 'test_image.jpg');

  try {
    console.log(`📤 Sending report to ${API_URL}...`);
    const response = await fetch(API_URL, {
      method: 'POST',
      body: formData,
      // Note: No 'Content-Type' header needed, fetch sets it with boundary for FormData
      headers: {
        'ngrok-skip-browser-warning': 'true'
      }
    });

    const result = await response.json();

    if (response.ok) {
      console.log('✅ Success! Report submitted.');
      console.log('Response:', JSON.stringify(result, null, 2));
    } else {
      console.error('❌ Failed to submit report.');
      console.error('Status:', response.status);
      console.error('Error:', result);
    }
  } catch (error: any) {
    console.error('❌ Error during request:', error?.message || error);
  } finally {
    // Cleanup
    if (fs.existsSync(dummyFilePath)) {
      fs.unlinkSync(dummyFilePath);
    }
  }
}

testReporting();
