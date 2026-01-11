# Smoke test for snapshot end-to-end flow
# Tests: predict_wps -> snapshot storage -> verify_race -> snapshot lookup

Write-Host "=== Snapshot End-to-End Smoke Test ===" -ForegroundColor Cyan

$env:ENABLE_PRED_SNAPSHOTS = "true"
Write-Host "ENABLE_PRED_SNAPSHOTS set to: $env:ENABLE_PRED_SNAPSHOTS" -ForegroundColor Yellow

# Test race details
$testTrack = "Tampa Bay Downs"
$testDate = "2026-01-07"
$testRaceNo = "1"

# Build request body with date + raceNo
$body = @{
    track = $testTrack
    date = $testDate
    raceNo = $testRaceNo
    surface = "Dirt"
    distance_input = "1mi 40y"
    horses = @(
        @{name = "Fast Runner"; odds = "2/1"; post = 1}
        @{name = "Swift Wind"; odds = "3/1"; post = 2}
        @{name = "Quick Dash"; odds = "4/1"; post = 3}
        @{name = "Speed Demon"; odds = "5/1"; post = 4}
        @{name = "Rapid Fire"; odds = "6/1"; post = 5}
        @{name = "Lightning Bolt"; odds = "8/1"; post = 6}
    )
    speedFigs = @{
        "Fast Runner" = 92
        "Swift Wind" = 90
        "Quick Dash" = 88
        "Speed Demon" = 86
        "Rapid Fire" = 84
        "Lightning Bolt" = 82
    }
} | ConvertTo-Json -Depth 10

Write-Host "`n=== STEP 1: Call predict_wps ===" -ForegroundColor Cyan
Write-Host "Track: $testTrack, Date: $testDate, RaceNo: $testRaceNo" -ForegroundColor White

try {
    $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/predict_wps' -Method POST -ContentType 'application/json' -Body $body
    Write-Host "[OK] Prediction completed" -ForegroundColor Green
    
    # Extract meta fields
    $asOf = $response.meta.asOf
    $raceId = $response.meta.raceId
    
    Write-Host "`nResponse meta:" -ForegroundColor Yellow
    Write-Host "  meta.asOf: $asOf"
    Write-Host "  meta.raceId: $raceId"
    
    if (-not $raceId) {
        Write-Host "[ERROR] meta.raceId is null!" -ForegroundColor Red
        exit 1
    }
    
    # Wait for async snapshot write
    Write-Host "`nWaiting 3 seconds for async snapshot write..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    
    Write-Host "`n=== STEP 2: Check Upstash for snapshot keys ===" -ForegroundColor Cyan
    
    # Expected raceId format: 2026-01-07|tampa bay downs|1
    $expectedPattern = "fl:predsnap:${raceId}:*"
    Write-Host "Looking for keys matching: $expectedPattern" -ForegroundColor White
    
    # Use node script to check Redis
    $checkScript = @"
import { keys, get } from './lib/redis.js';

const pattern = '$expectedPattern';
try {
  const snapshotKeys = await keys(pattern);
  console.log(JSON.stringify({
    count: snapshotKeys.length,
    keys: snapshotKeys
  }));
  
  if (snapshotKeys.length > 0) {
    const newestKey = snapshotKeys.sort().reverse()[0];
    const rawValue = await get(newestKey);
    if (rawValue) {
      const snapshot = JSON.parse(rawValue);
      console.log(JSON.stringify({
        key: newestKey,
        snapshotLength: JSON.stringify(snapshot).length,
        hasMeta: !!snapshot.meta,
        hasPicks: !!snapshot.picks,
        snapshot_asOf: snapshot.snapshot_asOf,
        snapshot_raceId: snapshot.snapshot_raceId
      }));
    }
  }
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
"@
    
    $checkScript | Out-File -FilePath "tmp_check_redis_keys.mjs" -Encoding utf8 -NoNewline
    
    $redisResult = node tmp_check_redis_keys.mjs 2>&1
    $redisData = $redisResult | ConvertFrom-Json -ErrorAction SilentlyContinue
    
    if ($redisData.count -gt 0) {
        Write-Host "[OK] Found $($redisData.count) snapshot key(s)" -ForegroundColor Green
        Write-Host "Keys:" -ForegroundColor Yellow
        $redisData.keys | ForEach-Object { Write-Host "  $_" }
        
        if ($redisData.key) {
            Write-Host "`nNewest snapshot:" -ForegroundColor Yellow
            Write-Host "  Key: $($redisData.key)"
            Write-Host "  JSON length: $($redisData.snapshotLength) bytes"
            Write-Host "  snapshot_asOf: $($redisData.snapshot_asOf)"
            Write-Host "  snapshot_raceId: $($redisData.snapshot_raceId)"
        }
    } else {
        Write-Host "[WARNING] No snapshot keys found!" -ForegroundColor Yellow
        Write-Host "Raw output: $redisResult" -ForegroundColor Gray
    }
    
    Write-Host "`n=== STEP 3: Call verify_race ===" -ForegroundColor Cyan
    
    $verifyBody = @{
        track = $testTrack
        date = $testDate
        raceNo = $testRaceNo
        mode = "manual"
        outcome = @{
            win = "Fast Runner"
            place = "Swift Wind"
            show = "Quick Dash"
        }
    } | ConvertTo-Json -Depth 10
    
    $verifyResponse = Invoke-RestMethod -Uri 'http://localhost:3000/api/verify_race' -Method POST -ContentType 'application/json' -Body $verifyBody
    Write-Host "[OK] Verify completed" -ForegroundColor Green
    
    Write-Host "`n=== STEP 4: Check verify log for predsnap_asOf ===" -ForegroundColor Cyan
    
    # Expected verify log key: fl:verify:2026-01-07|tampa bay downs|1
    $verifyLogPattern = "fl:verify:$raceId"
    Write-Host "Looking for verify log: $verifyLogPattern" -ForegroundColor White
    
    $logCheckScript = @"
import { get } from './lib/redis.js';

const verifyKey = '$verifyLogPattern';
try {
  const rawValue = await get(verifyKey);
  if (rawValue) {
    const verifyLog = JSON.parse(rawValue);
    console.log(JSON.stringify({
      found: true,
      predsnap_asOf: verifyLog.predsnap_asOf || null,
      hasPredmeta: !!verifyLog.predmeta,
      debug: verifyLog.debug || null
    }, null, 2));
  } else {
    console.log(JSON.stringify({ found: false }));
  }
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
"@
    
    $logCheckScript | Out-File -FilePath "tmp_check_verify_log.mjs" -Encoding utf8 -NoNewline
    
    Start-Sleep -Seconds 2  # Wait for verify log write
    
    $logResult = node tmp_check_verify_log.mjs 2>&1
    $logData = $logResult | ConvertFrom-Json -ErrorAction SilentlyContinue
    
    if ($logData.found) {
        Write-Host "[OK] Verify log found" -ForegroundColor Green
        Write-Host "`nVerify log excerpt:" -ForegroundColor Yellow
        Write-Host ($logData | ConvertTo-Json -Depth 5)
        
        if ($logData.predsnap_asOf) {
            Write-Host "`n[SUCCESS] predsnap_asOf found: $($logData.predsnap_asOf)" -ForegroundColor Green
        } else {
            Write-Host "`n[WARNING] predsnap_asOf NOT found in verify log" -ForegroundColor Yellow
            if ($logData.debug) {
                Write-Host "Debug info:" -ForegroundColor Yellow
                Write-Host ($logData.debug | ConvertTo-Json -Depth 5)
            }
        }
    } else {
        Write-Host "[WARNING] Verify log not found!" -ForegroundColor Yellow
        Write-Host "Raw output: $logResult" -ForegroundColor Gray
    }
    
    Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
    Write-Host "meta.asOf: $asOf"
    Write-Host "meta.raceId: $raceId"
    Write-Host "Snapshot keys found: $($redisData.count)"
    Write-Host "predsnap_asOf in verify log: $(if ($logData.predsnap_asOf) { 'YES' } else { 'NO' })"
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.Exception.StackTrace -ForegroundColor Gray
    exit 1
}

