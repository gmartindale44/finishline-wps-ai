"""
ML Odds Conversion Utilities
Converts various odds formats to decimal and probability formats
"""

def ml_to_fraction(odds_str: str) -> float:
    """
    Convert odds string like '5-2' or '6' into decimal format.
    
    Examples:
    - "5-2" -> 2.5
    - "6" -> 6.0
    - "3-1" -> 3.0
    - "1-1" -> 1.0
    """
    try:
        # Handle fractional odds like "5-2"
        if '-' in odds_str:
            numerator, denominator = odds_str.split('-')
            return float(numerator) / float(denominator)
        
        # Handle decimal odds like "6" or "6.5"
        return float(odds_str)
    
    except (ValueError, ZeroDivisionError):
        # Default to even odds if parsing fails
        return 1.0

def ml_to_prob(odds_str: str) -> float:
    """
    Convert odds into implied probability.
    
    Examples:
    - "5-2" -> 1/(2.5+1) ≈ 0.2857
    - "6" -> 1/(6+1) ≈ 0.1429
    - "1-1" -> 1/(1+1) = 0.5
    """
    try:
        decimal_odds = ml_to_fraction(odds_str)
        # Convert decimal odds to probability
        probability = 1 / (decimal_odds + 1)
        return round(probability, 4)
    
    except (ValueError, ZeroDivisionError):
        # Default to 50% probability if parsing fails
        return 0.5

def prob_to_ml(probability: float) -> str:
    """
    Convert probability back to ML odds format.
    
    Examples:
    - 0.2857 -> "5-2"
    - 0.1429 -> "6-1"
    - 0.5 -> "1-1"
    """
    try:
        if probability <= 0 or probability >= 1:
            return "1-1"
        
        decimal_odds = (1 / probability) - 1
        
        # Convert to fractional format
        if decimal_odds == int(decimal_odds):
            return f"{int(decimal_odds)}-1"
        
        # Find common fractions
        common_fractions = {
            0.5: "1-2",
            1.0: "1-1", 
            1.5: "3-2",
            2.0: "2-1",
            2.5: "5-2",
            3.0: "3-1",
            4.0: "4-1",
            5.0: "5-1",
            6.0: "6-1",
            8.0: "8-1",
            10.0: "10-1"
        }
        
        # Find closest match
        closest = min(common_fractions.keys(), key=lambda x: abs(x - decimal_odds))
        if abs(closest - decimal_odds) < 0.1:
            return common_fractions[closest]
        
        # Fallback to decimal format
        return f"{decimal_odds:.1f}"
    
    except (ValueError, ZeroDivisionError):
        return "1-1"
