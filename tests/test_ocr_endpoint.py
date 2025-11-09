"""
Unit tests for OCR endpoint.
Tests validation, error handling, and success cases.
"""
import pytest
import json
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock


@pytest.fixture
def client():
    """Create test client."""
    # Import here to avoid issues if module not yet created
    from apps.api.api_main import app
    return TestClient(app)


def test_empty_body_returns_error(client):
    """Test that empty body returns 400 ApiErr."""
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        json={}
    )
    
    assert response.status_code == 400
    data = response.json()
    assert data["ok"] is False
    assert "error" in data
    assert data["error"]["code"] in ["invalid_request", "no_images"]
    assert "requestId" in data


def test_empty_images_array_returns_error(client):
    """Test that empty images array returns 400 ApiErr."""
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        json={"images": []}
    )
    
    assert response.status_code == 400
    data = response.json()
    assert data["ok"] is False
    assert data["error"]["code"] in ["invalid_request", "no_images"]


def test_too_many_images_returns_error(client):
    """Test that >6 images returns 400 ApiErr."""
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        json={"images": ["data:image/jpeg;base64,fake"] * 10}
    )
    
    assert response.status_code == 400
    data = response.json()
    assert data["ok"] is False
    assert "error" in data


def test_oversized_image_returns_413(client):
    """Test that oversized image returns 413 ApiErr with payload_too_large code."""
    # Create a fake large base64 string (~4MB decoded = ~5.3MB base64)
    large_b64 = "A" * (5_300_000)
    
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        json={"images": [f"data:image/jpeg;base64,{large_b64}"]}
    )
    
    assert response.status_code == 413
    data = response.json()
    assert data["ok"] is False
    assert data["error"]["code"] == "payload_too_large"
    assert "requestId" in data


def test_bad_content_type_returns_415(client):
    """Test that non-JSON content-type returns 415 ApiErr."""
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        data="not json",
        headers={"Content-Type": "text/plain"}
    )
    
    assert response.status_code == 415
    data = response.json()
    assert data["ok"] is False
    assert data["error"]["code"] == "bad_content_type"


@patch("apps.api.photo_extract_openai_b64.run_openai_ocr_on_bytes")
@patch("apps.api.photo_extract_openai_b64.decode_data_url_or_b64")
def test_provider_error_returns_502(mock_decode, mock_ocr, client):
    """Test that provider error returns 502 ApiErr with ocr_provider_error code."""
    # Mock decode to return fake bytes
    mock_decode.return_value = b"fake image data"
    
    # Mock OCR to raise an exception
    mock_ocr.side_effect = Exception("OpenAI API error: 502 Bad Gateway")
    
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        json={"images": ["data:image/jpeg;base64,Zm9vYmFy"]}  # "foobar" in base64
    )
    
    assert response.status_code == 502
    data = response.json()
    assert data["ok"] is False
    assert data["error"]["code"] == "ocr_provider_error"
    assert "requestId" in data


@patch("apps.api.photo_extract_openai_b64.run_openai_ocr_on_bytes")
@patch("apps.api.photo_extract_openai_b64.decode_data_url_or_b64")
def test_happy_path_returns_api_ok(mock_decode, mock_ocr, client):
    """Test that successful OCR returns ApiOk with spans."""
    # Mock decode
    mock_decode.return_value = b"fake image data"
    
    # Mock OCR to return fake horses
    async def mock_ocr_impl(*args, **kwargs):
        return {
            "horses": [
                {"name": "Test Horse 1", "odds": "5/2"},
                {"name": "Test Horse 2", "odds": "3/1"}
            ]
        }
    
    mock_ocr.return_value = AsyncMock(return_value={
        "horses": [
            {"name": "Test Horse 1", "odds": "5/2"},
            {"name": "Test Horse 2", "odds": "3/1"}
        ]
    })()
    
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        json={"images": ["data:image/jpeg;base64,Zm9vYmFy"]}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert "data" in data
    assert "spans" in data["data"]
    assert "requestId" in data
    assert len(data["data"]["spans"]) >= 0


def test_response_has_request_id_header(client):
    """Test that all responses include X-Request-Id header."""
    response = client.post(
        "/api/finishline/photo_extract_openai_b64",
        json={"images": []}
    )
    
    assert "x-request-id" in response.headers or "X-Request-Id" in response.headers


def test_response_is_always_json(client):
    """Test that response is always JSON, never HTML."""
    # Try various bad requests
    test_cases = [
        {},
        {"images": []},
        {"images": ["invalid"]},
    ]
    
    for test_input in test_cases:
        response = client.post(
            "/api/finishline/photo_extract_openai_b64",
            json=test_input
        )
        
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type, f"Expected JSON but got {content_type}"
        
        # Should be parseable as JSON
        try:
            data = response.json()
            assert isinstance(data, dict)
            assert "ok" in data
        except json.JSONDecodeError:
            pytest.fail(f"Response is not valid JSON: {response.text[:200]}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

