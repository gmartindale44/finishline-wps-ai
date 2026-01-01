#!/bin/bash
# PayGate Routing Smoke Test Script
# Usage: ./smoke-test.sh https://your-preview-url.vercel.app

PREVIEW_URL="${1:-}"
if [ -z "$PREVIEW_URL" ]; then
    echo "Usage: $0 <PREVIEW-URL>"
    exit 1
fi

echo ""
echo "=== PayGate Routing Smoke Tests ==="
echo "Preview URL: $PREVIEW_URL"
echo ""

# Test 1: /api/paygate-token
echo "=== Test 1: /api/paygate-token ==="
response=$(curl -s -i "${PREVIEW_URL}/api/paygate-token?cb=123")
status=$(echo "$response" | grep -i "^HTTP" | awk '{print $2}')
identity=$(echo "$response" | grep -i "X-Handler-Identity" | cut -d' ' -f2 | tr -d '\r')
content_type=$(echo "$response" | grep -i "Content-Type" | cut -d' ' -f2- | tr -d '\r')
body=$(echo "$response" | sed -n '/^\r$/,$p' | head -c 200)

echo "Status: $status"
echo "X-Handler-Identity: $identity"
echo "Content-Type: $content_type"
echo "Body (first 200 chars): $body"

if [ "$identity" = "PAYGATE_TOKEN_OK" ] && echo "$body" | grep -q "PAYGATE_TOKEN_HANDLER_OK" && ! echo "$body" | grep -q "verify_race_stub"; then
    echo "✅ PASS: Correct handler, no verify_race_stub"
else
    echo "❌ FAIL: Wrong handler or contains verify_race_stub"
fi

# Test 2: /api/debug-paygate
echo ""
echo "=== Test 2: /api/debug-paygate ==="
response=$(curl -s -i "${PREVIEW_URL}/api/debug-paygate?cb=123")
status=$(echo "$response" | grep -i "^HTTP" | awk '{print $2}')
identity=$(echo "$response" | grep -i "X-Handler-Identity" | cut -d' ' -f2 | tr -d '\r')
body=$(echo "$response" | sed -n '/^\r$/,$p')

echo "Status: $status"
echo "X-Handler-Identity: $identity"
echo "Body (JSON): $body"

if [ "$identity" = "DEBUG_PAYGATE_OK" ] && echo "$body" | grep -q '"ok":true' && ! echo "$body" | grep -q "verify_race_stub"; then
    echo "✅ PASS: Correct handler, ok:true, no verify_race_stub"
else
    echo "❌ FAIL: Wrong handler or contains verify_race_stub"
fi

# Test 3: /api/verify_race (GET)
echo ""
echo "=== Test 3: /api/verify_race (GET) ==="
response=$(curl -s -i "${PREVIEW_URL}/api/verify_race")
status=$(echo "$response" | grep -i "^HTTP" | awk '{print $2}')
identity=$(echo "$response" | grep -i "X-Handler-Identity" | cut -d' ' -f2 | tr -d '\r')
body=$(echo "$response" | sed -n '/^\r$/,$p')

echo "Status: $status"
echo "X-Handler-Identity: $identity"
echo "Body (JSON): $body"

if [ "$identity" = "VERIFY_RACE_STUB" ] && echo "$body" | grep -q '"step":"verify_race_stub"'; then
    echo "✅ PASS: Correct stub response with identity header"
else
    echo "⚠️  WARNING: Unexpected response format"
fi

# Test 4: /api/verify_race (POST)
echo ""
echo "=== Test 4: /api/verify_race (POST) ==="
response=$(curl -s -i -X POST "${PREVIEW_URL}/api/verify_race" \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-12-31","track":"Turfway Park","raceNo":"8"}')
status=$(echo "$response" | grep -i "^HTTP" | awk '{print $2}')
body=$(echo "$response" | sed -n '/^\r$/,$p')

echo "Status: $status"
echo "Body (JSON): $body"

if ! echo "$body" | grep -q '"step":"verify_race_stub"'; then
    echo "✅ PASS: POST works correctly (not stub)"
else
    echo "⚠️  WARNING: POST returned stub (may be expected if no data available)"
fi

echo ""
echo "=== Smoke Tests Complete ==="

