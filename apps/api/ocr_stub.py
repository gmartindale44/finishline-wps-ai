"""
OCR Stub for Simulated Image Analysis
Simulates AI image reading with static horse data
"""

from typing import List, Dict, Any
import random

def analyze_photos(files: List[Any]) -> List[Dict[str, Any]]:
    """
    Simulate OCR analysis of horse racing photos.
    
    Args:
        files: List of uploaded image files
    
    Returns:
        List of extracted horse data dictionaries
    """
    try:
        # Simulate processing delay
        import time
        time.sleep(0.5)
        
        # Static horse data for simulation
        horse_pool = [
            {"name": "Thunderstride", "odds": "5-2"},
            {"name": "Silver Blaze", "odds": "3-1"},
            {"name": "Midnight Arrow", "odds": "6-1"},
            {"name": "Crimson Dash", "odds": "8-1"},
            {"name": "Golden Thunder", "odds": "4-1"},
            {"name": "Storm Chaser", "odds": "7-2"},
            {"name": "Lightning Bolt", "odds": "9-2"},
            {"name": "Wind Runner", "odds": "5-1"},
            {"name": "Fire Storm", "odds": "10-1"},
            {"name": "Ice Princess", "odds": "12-1"},
            {"name": "Desert Wind", "odds": "15-1"},
            {"name": "Ocean Wave", "odds": "20-1"},
        ]
        
        # Return subset based on number of files
        num_files = len(files)
        if num_files == 0:
            return []
        
        # Limit to reasonable number of horses
        num_horses = min(num_files, 6)
        
        # Randomly select horses (simulating OCR extraction)
        selected_horses = random.sample(horse_pool, num_horses)
        
        # Add default bankroll and kelly fraction
        result = []
        for horse in selected_horses:
            result.append({
                "name": horse["name"],
                "odds": horse["odds"],
                "bankroll": 1000,
                "kelly_fraction": 0.25
            })
        
        return result
    
    except Exception as e:
        # Return fallback data if simulation fails
        return [
            {"name": "Thunderstride", "odds": "5-2", "bankroll": 1000, "kelly_fraction": 0.25},
            {"name": "Silver Blaze", "odds": "3-1", "bankroll": 1000, "kelly_fraction": 0.25},
            {"name": "Midnight Arrow", "odds": "6-1", "bankroll": 1000, "kelly_fraction": 0.25},
        ]

def simulate_ocr_confidence(file_name: str) -> float:
    """
    Simulate OCR confidence score for a file.
    
    Args:
        file_name: Name of the uploaded file
    
    Returns:
        Confidence score between 0.0 and 1.0
    """
    try:
        # Simulate confidence based on file characteristics
        confidence = 0.7  # Base confidence
        
        # Adjust based on file extension
        if file_name.lower().endswith(('.jpg', '.jpeg')):
            confidence += 0.1
        elif file_name.lower().endswith('.png'):
            confidence += 0.05
        elif file_name.lower().endswith('.webp'):
            confidence += 0.02
        
        # Add some randomness
        confidence += random.uniform(-0.1, 0.1)
        
        # Ensure bounds
        confidence = max(0.0, min(1.0, confidence))
        
        return round(confidence, 3)
    
    except Exception:
        return 0.5

def extract_horse_data_from_image(image_data: bytes) -> Dict[str, Any]:
    """
    Simulate extracting horse data from a single image.
    
    Args:
        image_data: Raw image bytes
    
    Returns:
        Dictionary with extracted horse information
    """
    try:
        # Simulate OCR processing
        horse_pool = [
            {"name": "Thunderstride", "odds": "5-2"},
            {"name": "Silver Blaze", "odds": "3-1"},
            {"name": "Midnight Arrow", "odds": "6-1"},
            {"name": "Crimson Dash", "odds": "8-1"},
        ]
        
        # Randomly select a horse
        selected = random.choice(horse_pool)
        
        return {
            "name": selected["name"],
            "odds": selected["odds"],
            "confidence": simulate_ocr_confidence("image.jpg"),
            "extracted_text": f"Horse: {selected['name']}, Odds: {selected['odds']}",
            "processing_time": random.uniform(0.1, 0.5)
        }
    
    except Exception:
        return {
            "name": "Unknown",
            "odds": "1-1",
            "confidence": 0.0,
            "extracted_text": "OCR failed",
            "processing_time": 0.0
        }
