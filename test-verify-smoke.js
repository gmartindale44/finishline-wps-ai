/**
 * Smoke test for verify_race and verify_backfill endpoints
 * 
 * Usage (Node.js):
 *   node test-verify-smoke.js
 * 
 * Or test manually in browser console:
 *   1. Test verify_race for a known HRN URL:
 *      fetch('/api/verify_race', {
 *        method: 'POST',
 *        headers: { 'Content-Type': 'application/json' },
 *        body: JSON.stringify({
 *          track: 'Laurel Park',
 *          date: '2025-01-15',
 *          raceNo: '8'
 *        })
 *      }).then(r => r.json()).then(console.log);
 * 
 *   2. Test verify_backfill for a single race:
 *      fetch('/api/verify_backfill', {
 *        method: 'POST',
 *        headers: { 'Content-Type': 'application/json' },
 *        body: JSON.stringify({
 *          track: 'Laurel Park',
 *          date: '2025-01-15',
 *          raceNo: '8'
 *        })
 *      }).then(r => r.json()).then(console.log);
 * 
 * Expected behavior:
 *   - verify_race should return HTTP 200 with structured JSON
 *   - If HRN is blocked (403), response should include:
 *     { ok: false, step: "fetch_results", httpStatus: 403, error: "403 from HRN (blocked)", urlAttempted: "..." }
 *   - verify_backfill should always return HTTP 200, even if some races fail
 *   - verify_backfill response should include: { ok: boolean, successes, failures, results: [{ ok, step, httpStatus, error, ... }] }
 */

// If running as Node.js script (requires fetch polyfill or node 18+)
if (typeof fetch === 'undefined') {
  console.log('This script requires fetch API (Node.js 18+ or fetch polyfill)');
  console.log('Alternatively, use the browser console examples above');
  process.exit(0);
}

const BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:3000';

async function testVerifyRace() {
  console.log('\n=== Testing verify_race ===');
  try {
    const response = await fetch(`${BASE_URL}/api/verify_race`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track: 'Laurel Park',
        date: '2025-01-15',
        raceNo: '8'
      })
    });

    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    // Validate response structure
    if (response.status !== 200) {
      console.error('❌ verify_race returned non-200 status:', response.status);
      return false;
    }

    if (!data || typeof data !== 'object') {
      console.error('❌ verify_race response is not an object');
      return false;
    }

    // Check for structured error on HRN block
    if (!data.ok && data.step === 'fetch_results' && data.httpStatus) {
      console.log('✅ verify_race correctly returned structured error for blocked fetch');
      console.log(`   HTTP ${data.httpStatus}: ${data.error}`);
      console.log(`   URL attempted: ${data.urlAttempted || 'N/A'}`);
      return true;
    }

    if (data.ok) {
      console.log('✅ verify_race succeeded');
      return true;
    }

    console.warn('⚠️  verify_race returned ok:false but not a structured fetch error');
    return false;

  } catch (error) {
    console.error('❌ verify_race test failed:', error.message);
    return false;
  }
}

async function testVerifyBackfill() {
  console.log('\n=== Testing verify_backfill ===');
  try {
    const response = await fetch(`${BASE_URL}/api/verify_backfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track: 'Laurel Park',
        date: '2025-01-15',
        raceNo: '8'
      })
    });

    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    // Validate response structure
    if (response.status !== 200) {
      console.error('❌ verify_backfill returned non-200 status (should always return 200):', response.status);
      return false;
    }

    if (!data || typeof data !== 'object') {
      console.error('❌ verify_backfill response is not an object');
      return false;
    }

    if (typeof data.ok !== 'boolean') {
      console.error('❌ verify_backfill missing "ok" boolean field');
      return false;
    }

    if (typeof data.successes !== 'number' || typeof data.failures !== 'number') {
      console.error('❌ verify_backfill missing successes/failures counts');
      return false;
    }

    if (!Array.isArray(data.results)) {
      console.error('❌ verify_backfill missing "results" array');
      return false;
    }

    // Check if first failure details are included
    if (data.failures > 0 && data.results.length > 0) {
      const firstFailure = data.results.find(r => !r.ok);
      if (firstFailure) {
        console.log('✅ verify_backfill includes failure details:', {
          step: firstFailure.step,
          httpStatus: firstFailure.httpStatus,
          error: firstFailure.error || firstFailure.networkError,
        });
      }
    }

    console.log(`✅ verify_backfill structure valid (${data.successes} succeeded, ${data.failures} failed)`);
    return true;

  } catch (error) {
    console.error('❌ verify_backfill test failed:', error.message);
    return false;
  }
}

// Run tests
(async () => {
  console.log('Starting smoke tests for verify_race and verify_backfill...');
  console.log(`Base URL: ${BASE_URL}\n`);

  const test1 = await testVerifyRace();
  const test2 = await testVerifyBackfill();

  console.log('\n=== Summary ===');
  console.log(`verify_race: ${test1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`verify_backfill: ${test2 ? '✅ PASS' : '❌ FAIL'}`);

  if (test1 && test2) {
    console.log('\n✅ All smoke tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
})();
