"""
Provider Factory
Returns the configured data provider based on environment variables
"""
import os
from typing import Any

def get_provider() -> Any:
    """
    Factory function to return the configured data provider.
    
    Environment Variables:
        FINISHLINE_DATA_PROVIDER: Provider type ('custom', 'stub', etc.)
    
    Returns:
        Provider instance with enrich_horses() method
    """
    provider_name = os.getenv("FINISHLINE_DATA_PROVIDER", "stub").lower()
    
    if provider_name == "custom":
        from .provider_custom import CustomProvider
        return CustomProvider()
    
    # Default/stub provider (pass-through)
    class StubProvider:
        def enrich_horses(self, horses, **kwargs):
            return horses
        
        async def fetch_race_context(self, **kwargs):
            return {}
    
    return StubProvider()

