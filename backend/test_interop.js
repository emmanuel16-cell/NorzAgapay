const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const https = require('https');
require('dotenv').config({ path: __dirname + '/.env' });

const API_BASE = 'https://norzagapay-backend.onrender.com/api';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

function httpReq(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const headers = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = https.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('  NORZAGAPAY MULTI-APP INTEROPERABILITY TEST SUITE  ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 1: Evacuation Centers API & Mobile App Parser Validation
  // ─────────────────────────────────────────────────────────────
  console.log('--- TEST 1: Evacuation Centers API & Mobile App Parser Simulation ---');
  try {
    const res = await httpReq('GET', '/evacuation-centers');
    assert(res.status === 200, `Live backend returned status 200 (Got ${res.status})`);
    assert(Array.isArray(res.data), `Backend returned JSON Array (Length: ${res.data.length})`);

    // Simulate our updated mobile_app parser logic:
    // final decoded = json.decode(response.body);
    // final List<dynamic> list = decoded is List ? decoded : (decoded['centers'] ?? decoded['data'] ?? []);
    const decoded = res.data;
    const list = Array.isArray(decoded)
      ? decoded
      : (decoded.centers || decoded.evacuation_centers || decoded.data || []);
    
    assert(list.length > 0, `Mobile app parser parsed ${list.length} evacuation center(s) without type exceptions`);

    const center = list[0];
    const currentOccupants = center.total_persons ?? center.current_occupants ?? 0;
    const capacity = center.max_capacity ?? center.capacity ?? 1;
    const occupancyRate = capacity > 0 ? currentOccupants / capacity : 0;
    
    assert(typeof currentOccupants === 'number', `Current occupants mapped: ${currentOccupants}`);
    assert(typeof capacity === 'number' && capacity > 0, `Capacity mapped: ${capacity}`);
    assert(!isNaN(occupancyRate), `Occupancy rate computed cleanly: ${(occupancyRate * 100).toFixed(0)}%`);
    console.log(`     Sample Center: "${center.name}", Address: "${center.address}", Occupancy: ${currentOccupants}/${capacity}`);
  } catch (err) {
    assert(false, `Evacuation centers test error: ${err.message}`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Multiple Specializations Verification
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Multiple Specializations in Database & Local Logic ---');
  try {
    const { data: officer } = await supabase
      .from('officers')
      .select('id, name, email, specialization')
      .eq('email', 'officer@test.com')
      .maybeSingle();

    assert(officer !== null, 'Found officer@test.com in officers table');
    const specs = (officer?.specialization || '').split(',').map((s) => s.trim()).filter(Boolean);
    assert(specs.length === 3, `Officer has all 3 specializations: ${officer?.specialization}`);

    // Verify multi-specialization fallback logic implemented in backend:
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name, email, role, unit_type')
      .eq('email', 'officer@test.com')
      .single();

    let resolvedUnitType = user.unit_type;
    if (user.role === 'professional_unit') {
      const { data: off } = await supabase
        .from('officers')
        .select('specialization')
        .eq('email', user.email)
        .maybeSingle();
      if (off?.specialization) {
        resolvedUnitType = off.specialization;
      }
    }
    const resolvedSpecs = resolvedUnitType.split(',').map((s) => s.trim());
    assert(resolvedSpecs.length === 3, `Multi-specialization resolver produces: "${resolvedUnitType}" (3 items)`);
    console.log(`     Resolved specializations for ${user.full_name}:`, resolvedSpecs);
  } catch (err) {
    assert(false, `Specialization test error: ${err.message}`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Resident Incident Reporting -> Backend
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Resident App Incident Reporting Workflow ---');
  let testIncidentId = null;
  try {
    const { data: barangays } = await supabase.from('barangays').select('id, name').limit(1);
    assert(barangays && barangays.length > 0, 'Found barangay for reporting test');
    const bgy = barangays[0];

    // Payload matching resident_app reporting_screen.dart
    const reportPayload = {
      type: 'emergency',
      title: 'Emergency Incident',
      specifics: 'Severe Flash Flood',
      description: 'Automated Interoperability Test Incident - Rising water levels near residential area',
      latitude: 14.9042,
      longitude: 121.043,
      proof_type: 'image',
      reporter_type: 'resident',
      first_name: 'Juan',
      last_name: 'Dela Cruz',
      contact_number: '09123456789',
      barangay_id: bgy.id,
    };

    const repRes = await httpReq('POST', '/incident-reports', reportPayload);
    assert(repRes.status === 200 || repRes.status === 201, `Resident submitted report successfully (Status ${repRes.status})`);
    testIncidentId = repRes.data?.report?.id || repRes.data?.id;
    assert(Boolean(testIncidentId), `Received report ID: ${testIncidentId}`);
  } catch (err) {
    assert(false, `Resident report submission error: ${err.message}`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Barangay App Review & Escalation to MDRRMO
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Barangay App Review & Escalation Workflow ---');
  if (testIncidentId) {
    try {
      const { data: rep } = await supabase
        .from('incident_reports')
        .select('id, status, mdrrmo_response_status, barangay_id')
        .eq('id', testIncidentId)
        .single();

      assert(rep !== null, 'Barangay retrieved the incident report from DB');
      assert(rep.status === 'pending', 'Incident initialized with status: pending');

      // Barangay escalates to MDRRMO co-response
      const { error: escError } = await supabase
        .from('incident_reports')
        .update({
          status: 'verified',
          mdrrmo_response_status: 'responding',
          mdrrmo_responder_name: 'MDRRMO Rescue Team Alpha',
          mdrrmo_response_notes: 'Escalated by Barangay Captain - heavy rescue truck requested',
          mdrrmo_responded_at: new Date().toISOString(),
        })
        .eq('id', testIncidentId);

      assert(!escError, 'Barangay updated incident status to verified and requested MDRRMO co-response');

      const { data: updatedRep } = await supabase
        .from('incident_reports')
        .select('id, status, mdrrmo_response_status, mdrrmo_responder_name')
        .eq('id', testIncidentId)
        .single();

      assert(updatedRep.status === 'verified', `Barangay verified incident status: ${updatedRep.status}`);
      assert(updatedRep.mdrrmo_response_status === 'responding', `Co-response status set to: ${updatedRep.mdrrmo_response_status}`);
      console.log(`     Assigned Co-Responder: "${updatedRep.mdrrmo_responder_name}"`);
    } catch (err) {
      assert(false, `Barangay escalation error: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 5: Web Dashboard Command Center Visibility
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 5: Web Dashboard Command Center Sync ---');
  if (testIncidentId) {
    try {
      const { data: ccIncident, error: ccErr } = await supabase
        .from('incident_reports')
        .select(`
          id,
          type,
          title,
          description,
          status,
          mdrrmo_response_status,
          barangays ( id, name )
        `)
        .eq('id', testIncidentId)
        .single();

      assert(!ccErr && ccIncident !== null, 'Web Dashboard Command Center successfully queries incident with relations');
      assert(ccIncident?.barangays?.name !== undefined, `Command center loaded incident barangay: "${ccIncident?.barangays?.name}"`);
      assert(ccIncident.mdrrmo_response_status === 'responding', 'Command Center reflects real-time co-response state: responding');
    } catch (err) {
      assert(false, `Web dashboard query error: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 6: Mobile App Respond Units & Tasks Cleanup
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 6: Mobile App Respond Unit & Officers ---');
  try {
    const { data: officers } = await supabase
      .from('officers')
      .select('id, name, specialization, status')
      .eq('status', 'active');

    assert(officers && officers.length > 0, `Officers available for mobile app dispatch: ${officers?.length}`);
    for (const off of officers) {
      console.log(`     Officer: ${off.name} | Specializations: ${off.specialization}`);
    }

    if (testIncidentId) {
      await supabase.from('incident_reports').delete().eq('id', testIncidentId);
      console.log('     Cleaned up automated test incident report.');
    }
  } catch (err) {
    assert(false, `Mobile app cleanup error: ${err.message}`);
  }

  console.log('\n====================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED  `);
  console.log('====================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
