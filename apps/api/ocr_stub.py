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
        List of extracted horse data dictionaries with trainer/jockey
    """
    try:
        # Simulate processing delay
        import time
        time.sleep(0.5)
        
        # Static horse data for simulation with trainer/jockey
        horse_pool = [
            {"name": "Flyin Ryan", "trainer": "Kathy Jarvis", "jockey": "Jose Ramos Gutierrez", "ml_odds": "8/1"},
            {"name": "Improbable", "trainer": "Bob Baffert", "jockey": "Irad Ortiz Jr", "ml_odds": "5-2"},
            {"name": "Silver Blaze", "trainer": "John Kimmel", "jockey": "Joel Rosario", "ml_odds": "3-1"},
            {"name": "Midnight Arrow", "trainer": "Steve Asmussen", "jockey": "Ricardo Santana Jr", "ml_odds": "6-1"},
            {"name": "Crimson Dash", "trainer": "Brad Cox", "jockey": "Florent Geroux", "ml_odds": "8-1"},
            {"name": "Golden Thunder", "trainer": "Chad Brown", "jockey": "Jose Ortiz", "ml_odds": "4-1"},
            {"name": "Storm Chaser", "trainer": "Todd Pletcher", "jockey": "John Velazquez", "ml_odds": "7-2"},
            {"name": "Lightning Bolt", "trainer": "Mark Casse", "jockey": "Tyler Gaffalione", "ml_odds": "9-2"},
        ]
        
        # Return subset based on number of files
        num_files = len(files)
        if num_files == 0:
            # Return at least one horse even if no files (for testing)
            return [horse_pool[0]]
        
        # Limit to reasonable number of horses
        num_horses = min(max(num_files, 2), 6)  # At least 2, max 6
        
        # Randomly select horses (simulating OCR extraction)
        selected_horses = random.sample(horse_pool, min(num_horses, len(horse_pool)))
        
        return selected_horses
    
    except Exception as e:
        # Return fallback data if simulation fails - always return at least one row
        return [
            {"name": "Flyin Ryan", "trainer": "Kathy Jarvis", "jockey": "Jose Ramos Gutierrez", "ml_odds": "8/1"},
            {"name": "Improbable", "trainer": "Bob Baffert", "jockey": "Irad Ortiz Jr", "ml_odds": "5-2"},
            {"name": "Silver Blaze", "trainer": "John Kimmel", "jockey": "Joel Rosario", "ml_odds": "3-1"},
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
