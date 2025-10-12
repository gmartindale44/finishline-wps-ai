#!/usr/bin/env python3
"""
Test script to verify all FinishLine API endpoints return proper JSON.
Tests for:
- Valid JSON responses (never HTML)
- Presence of request_id in error responses
- Proper error codes and messages
- No FUNCTION_INVOCATION_FAILED errors
"""

import json
import sys
import asyncio
import httpx
from typing import Dict, Any, Tuple

# Test configuration
BASE_URL = "http://localhost:8000"  # Change for deployed URL
TIMEOUT = 30.0

class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"

def log(msg: str, level: str = "info"):
    """Pretty print log messages"""
    colors = {
        "success": Colors.GREEN,
        "error": Colors.RED,
        "warning": Colors.YELLOW,
        "info": Colors.BLUE
    }
    color = colors.get(level, Colors.RESET)
    symbol = {
        "success": "✓",
        "error": "✗",
        "warning": "⚠",
        "info": "ℹ"
    }.get(level, "•")
    print(f"{color}{symbol} {msg}{Colors.RESET}")

async def test_endpoint(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    json_data: Dict[str, Any] = None,
    expected_status: int = 200,
    should_fail: bool = False
) -> Tuple[bool, str]:
    """
    Test a single endpoint.
    
    Returns:
        (passed, message)
    """
    try:
        url = f"{BASE_URL}{path}"
        
        if method.upper() == "GET":
            response = await client.get(url, timeout=TIMEOUT)
        elif method.upper() == "POST":
            response = await client.post(url, json=json_data, timeout=TIMEOUT)
        else:
            return False, f"Unsupported method: {method}"
        
        # Check for HTML error pages (FUNCTION_INVOCATION_FAILED)
        content_type = response.headers.get("content-type", "")
        if "text/html" in content_type:
            return False, f"Returned HTML instead of JSON (status {response.status_code})"
        
        # Try to parse as JSON
        try:
            data = response.json()
        except json.JSONDecodeError as e:
            return False, f"Invalid JSON response: {e}"
        
        # Check if it's a proper JSON object
        if not isinstance(data, dict):
            return False, f"Response is not a JSON object (got {type(data).__name__})"
        
        # For error responses, check for required fields
        if response.status_code >= 400 or data.get("ok") == False:
            if should_fail:
                # This is expected
                if "request_id" not in data and "reqId" not in data:
                    return False, "Error response missing request_id/reqId"
                if "error" not in data and "message" not in data and "code" not in data:
                    return False, "Error response missing error/message/code"
                return True, f"Expected error returned properly (status {response.status_code})"
            else:
                return False, f"Unexpected error: {data.get('error') or data.get('message')} (status {response.status_code})"
        
        # For success responses
        if not should_fail and response.status_code != expected_status:
            return False, f"Expected status {expected_status}, got {response.status_code}"
        
        return True, f"Valid JSON response (status {response.status_code})"
        
    except httpx.TimeoutException:
        return False, "Request timed out"
    except Exception as e:
        return False, f"Unexpected error: {str(e)}"

async def run_tests():
    """Run all endpoint tests"""
    async with httpx.AsyncClient() as client:
        tests = [
            # Health checks
            {
                "name": "Health check (/api/health)",
                "method": "GET",
                "path": "/api/health",
                "expected_status": 200,
                "should_fail": False
            },
            {
                "name": "Health check (/api/finishline/health)",
                "method": "GET",
                "path": "/api/finishline/health",
                "expected_status": 200,
                "should_fail": False
            },
            
            # Debug/info endpoints
            {
                "name": "Debug info",
                "method": "GET",
                "path": "/api/finishline/debug_info",
                "expected_status": 200,
                "should_fail": False
            },
            
            # OCR endpoint - valid error (no images)
            {
                "name": "OCR without images (expected error)",
                "method": "POST",
                "path": "/api/finishline/photo_extract_openai_b64",
                "json_data": {"images_b64": []},
                "expected_status": 400,
                "should_fail": True
            },
            
            # OCR endpoint - too many images
            {
                "name": "OCR with too many images (expected error)",
                "method": "POST",
                "path": "/api/finishline/photo_extract_openai_b64",
                "json_data": {"images_b64": ["data:image/jpeg;base64,fake"] * 10},
                "expected_status": 400,
                "should_fail": True
            },
            
            # Analyze/Predict - no horses
            {
                "name": "Analyze without horses (expected error)",
                "method": "POST",
                "path": "/api/finishline/research_predict",
                "json_data": {"horses": []},
                "expected_status": 400,
                "should_fail": True
            },
            
            # Predict endpoint - no horses
            {
                "name": "Predict without horses (expected error)",
                "method": "POST",
                "path": "/api/finishline/predict",
                "json_data": {"horses": []},
                "expected_status": 400,
                "should_fail": True
            },
            
            # Analyze with valid stub data
            {
                "name": "Analyze with stub provider",
                "method": "POST",
                "path": "/api/finishline/research_predict",
                "json_data": {
                    "horses": [
                        {"name": "Test Horse 1", "odds": "5/2"},
                        {"name": "Test Horse 2", "odds": "3/1"}
                    ],
                    "provider": "stub",
                    "useResearch": False
                },
                "expected_status": 200,
                "should_fail": False
            }
        ]
        
        passed = 0
        failed = 0
        
        log(f"Running {len(tests)} endpoint tests...\n", "info")
        
        for test_config in tests:
            name = test_config.pop("name")
            success, message = await test_endpoint(client, **test_config)
            
            if success:
                log(f"{name}: {message}", "success")
                passed += 1
            else:
                log(f"{name}: {message}", "error")
                failed += 1
        
        # Summary
        print(f"\n{'='*60}")
        log(f"Tests passed: {passed}/{len(tests)}", "success" if failed == 0 else "info")
        if failed > 0:
            log(f"Tests failed: {failed}/{len(tests)}", "error")
        print(f"{'='*60}\n")
        
        return failed == 0

def main():
    """Main entry point"""
    print(f"\n{'='*60}")
    print(f"FinishLine API Endpoint Tests")
    print(f"Target: {BASE_URL}")
    print(f"{'='*60}\n")
    
    try:
        success = asyncio.run(run_tests())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        log("\nTests interrupted by user", "warning")
        sys.exit(130)
    except Exception as e:
        log(f"Test runner failed: {e}", "error")
        sys.exit(1)

if __name__ == "__main__":
    main()

