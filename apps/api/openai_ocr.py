"""
OpenAI Vision OCR for Horse Racing Photos
Extracts structured horse data from race tables/programs using GPT-4 Vision
"""
from typing import List, Dict, Any
from fastapi import UploadFile
import os
import base64
import json

_OPENAI_KEY = os.getenv("FINISHLINE_OPENAI_API_KEY", "").strip()
_OPENAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

def is_available() -> bool:
    """Check if OpenAI Vision OCR is available"""
    return bool(_OPENAI_KEY)

async def extract_horses_from_images(files: List[UploadFile]) -> List[Dict[str, Any]]:
    """
    Extract horse racing data from images using OpenAI Vision API
    
    Args:
        files: List of uploaded image files
    
    Returns:
        List of horse dictionaries with name, trainer, jockey, ml_odds
    """
    if not _OPENAI_KEY:
        raise ValueError("OpenAI API key not configured")
    
    from openai import OpenAI
    
    client = OpenAI(api_key=_OPENAI_KEY)
    
    # Process up to 6 images
    image_data_urls = []
    for file in files[:6]:
        content = await file.read()
        
        # Only process images (skip PDFs for now with Vision API)
        if file.content_type and file.content_type.startswith('image/'):
            b64 = base64.b64encode(content).decode('utf-8')
            mime_type = file.content_type or 'image/jpeg'
            data_url = f"data:{mime_type};base64,{b64}"
            image_data_urls.append(data_url)
        
        # Reset file pointer for potential reuse
        await file.seek(0)
    
    if not image_data_urls:
        return []
    
    # Build messages with images
    messages = [
        {
            "role": "system",
            "content": (
                "You extract horse racing data from race programs/tables. "
                "Return ONLY a JSON array with each horse as an object containing: "
                "name (string), trainer (string, optional), jockey (string, optional), "
                "ml_odds (string like '8/1', '9-2', '5/2', '6', optional). "
                "Extract ALL horses visible. Return valid JSON only, no commentary."
            )
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Extract all horses from these race images. Return JSON array with: name, trainer, jockey, ml_odds"
                }
            ] + [
                {
                    "type": "image_url",
                    "image_url": {"url": url, "detail": "high"}
                }
                for url in image_data_urls
            ]
        }
    ]
    
    try:
        response = client.chat.completions.create(
            model=_OPENAI_MODEL,
            messages=messages,
            temperature=0.1,
            max_tokens=2000,
        )
        
        content = response.choices[0].message.content.strip()
        
        # Extract JSON from markdown code blocks if present
        if '```json' in content:
            content = content.split('```json')[1].split('```')[0].strip()
        elif '```' in content:
            content = content.split('```')[1].split('```')[0].strip()
        
        # Parse JSON
        horses = json.loads(content)
        
        if not isinstance(horses, list):
            horses = []
        
        # Normalize field names
        normalized = []
        for h in horses:
            if isinstance(h, dict) and h.get('name'):
                normalized.append({
                    'name': h.get('name', ''),
                    'trainer': h.get('trainer', ''),
                    'jockey': h.get('jockey', ''),
                    'ml_odds': h.get('ml_odds') or h.get('odds', ''),
                })
        
        return normalized
    
    except Exception as e:
        print(f"[OpenAI OCR] Error: {e}")
        return []

