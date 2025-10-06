#!/usr/bin/env python3
"""
Test script for FinishLine WPS AI API
Tests all endpoints with sample data
"""

import requests
import json
import sys

API_BASE = "http://localhost:8000/api/finishline"

def test_health():
    """Test health endpoint"""
    print("Testing health endpoint...")
    try:
        response = requests.get(f"{API_BASE}/health")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Health check passed: {data}")
            return True
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False

def test_version():
    """Test version endpoint"""
    print("\nTesting version endpoint...")
    try:
        response = requests.get(f"{API_BASE}/version")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Version check passed: {data}")
            return True
        else:
            print(f"❌ Version check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Version check error: {e}")
        return False

def test_predict():
    """Test prediction endpoint"""
    print("\nTesting prediction endpoint...")
    try:
        test_data = {
            "horses": [
                {
                    "name": "Thunderstride",
                    "odds": "5-2",
                    "bankroll": 1000,
                    "kelly_fraction": 0.25
                },
                {
                    "name": "Silver Blaze",
                    "odds": "3-1",
                    "bankroll": 1000,
                    "kelly_fraction": 0.25
                },
                {
                    "name": "Midnight Arrow",
                    "odds": "6-1",
                    "bankroll": 1000,
                    "kelly_fraction": 0.25
                }
            ]
        }
        
        response = requests.post(
            f"{API_BASE}/predict",
            headers={"Content-Type": "application/json"},
            json=test_data
        )
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Prediction test passed:")
            print(f"   WIN: {data['win']['name']} ({data['win']['odds']})")
            print(f"   PLACE: {data['place']['name']} ({data['place']['odds']})")
            print(f"   SHOW: {data['show']['name']} ({data['show']['odds']})")
            return True
        else:
            print(f"❌ Prediction test failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Prediction test error: {e}")
        return False

def main():
    """Run all tests"""
    print("🏇 FinishLine WPS AI - API Test Suite")
    print("=" * 50)
    
    tests = [
        test_health,
        test_version,
        test_predict
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        if test():
            passed += 1
    
    print("\n" + "=" * 50)
    print(f"Test Results: {passed}/{total} passed")
    
    if passed == total:
        print("🎉 All tests passed! API is working correctly.")
        sys.exit(0)
    else:
        print("❌ Some tests failed. Check the API server.")
        sys.exit(1)

if __name__ == "__main__":
    main()
